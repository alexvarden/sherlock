# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js App                           │
│                                                          │
│  /graph          Knowledge graph viewer (D3 + filters)  │
│  /demo           Character Q&A demo                     │
│  /read           Perspective-aware reader               │
│  /api/query      POST → LLM answer for a character      │
│  /api/copilotkit POST → streaming character chat        │
│  /api/ingest     POST → trigger re-ingest (dev only)    │
└───────────────────────────┬─────────────────────────────┘
                            │
                            │ SHERLOCK_DATABASE_URL
                            │ node-postgres locally, Neon over HTTP in prod
                            │
┌───────────────────────────▼─────────────────────────────┐
│         Postgres 18 (Docker locally · Neon hosted)      │
│                                                          │
│  nodes   story · id · kind · subkind · name · pos · props│
│  edges   story · from_id · to_id · rel_type              │
│          valid_from_section · valid_to_section · props   │
│                                                          │
│  kind:     story · section · lexical · entity · event   │
│  rel_type: PARTICIPATED_IN · TOLD_TO · SPOKE_IN         │
│            PERFORMED · MENTIONED_IN · IS_INSIDE         │
│            LOCATED_AT · OWNS · CLUE_FOR · MEMBER_OF     │
└───────────────────────────┬─────────────────────────────┘
                            │
                   (write path only)
                            │
┌───────────────────────────▼─────────────────────────────┐
│              Ingest + Load Scripts                       │
│  scripts/ingest.ts       Raw text → JSON                │
│  scripts/migrate.ts      Apply lib/db/migrations/*.sql  │
│  scripts/load-canon.ts   JSON → Postgres                │
│  scripts/verify-load.ts  Counts + integrity + storage   │
└─────────────────────────────────────────────────────────┘
```

No API endpoint accepts a query. The browser sends filter state — story,
character, section — and the server builds every statement from it with bound
parameters. The SQL shown on `/graph` and `/demo` is rendered for the reader,
never sent back.

---

## Three-layer data model

This is a non-negotiable design constraint. The layers are strictly separated.

### Layer 1 — Lexical graph

Every sentence (or paragraph) in the story, globally ordered. Immutable once written.

```
LexicalNode
  id         "sentence_42"
  section    "section_3"
  position   42           ← global ordering
  text       "Holmes examined the letter carefully."
  entities   ["sherlock_holmes"]
```

Purpose: ground everything in text; enable chronological traversal; provide the readable text in the UI's section panel.

### Layer 2 — Objective graph

What is true in the world. Contains only facts — no beliefs, no character knowledge, no cognitive edges.

**Node types:**

All of these are rows in `nodes`, distinguished by `kind` (and `subkind` for
entities).

| kind / subkind | Description |
|-------|-------------|
| `story` | Top-level story row; slug is the id, granularity in `props` |
| `section` | Named chunk of the story; `pos` is its index |
| `lexical` | Individual sentence/paragraph; `pos` is its global position |
| `entity` / `character` | A person |
| `entity` / `location` | A place |
| `entity` / `object` | A thing |
| `entity` / `case`, `document`, `organisation` | The remaining extracted types |
| `event` | Something that happened; the primary unit of narrative. `pos` is the index of its section |

**Relationship types:**

| Relationship | Meaning |
|-------------|---------|
| `PARTICIPATED_IN` | Entity was present at an event (witnesses it) |
| `PERFORMED` | Entity was the agent of the event |
| `SPOKE_IN` | Entity was the speaker in a communicates event |
| `TOLD_TO` | Event communicated content to this entity (recipient) |
| `MENTIONED_IN` | Entity is named in a section; `props.sentenceIds` cites where |
| `IS_INSIDE` | Containment state edge (carries a validity window) |
| `LOCATED_AT` | Location state edge |
| `OWNS` | Ownership state edge |
| `CLUE_FOR` | Object is evidence for a case |
| `MEMBER_OF` | Character belongs to an organisation |

**State edges carry validity windows:**

```
from_id  to_id        rel_type    valid_from_section  valid_to_section
marble   red_basket   IS_INSIDE   2                   5
marble   blue_box     IS_INSIDE   5                   NULL
```

The window is inclusive at the lower bound and exclusive at the upper; NULL
means "still true at the end of the story". Because both are real integer
columns rather than JSON, "what was true at section N" is an indexed range
predicate.

This is how the graph models objects moving over time without contradiction.

**Speech acts are events:**

A `COMMUNICATES` event ("Anne tells Sally the marble is in the box") is objective — the speech act happened. Whether its content is true is answered by other edges. This is what enables false-belief modelling:
- Layer 2 has `TOLD_TO(marble_in_box_event → Sally)` AND `IS_INSIDE(marble, bucket)` valid at the same time.
- Layer 3 derives: Sally holds a false belief.

### Layer 3 — Character states (runtime)

Never stored. Computed on demand by `getCharacterContext()` in `lib/graph-query.ts`.

```typescript
// Pseudocode — see lib/graph-query.ts for the full implementation
function getCharacterContext(story, characterId, sectionId) {
  const cutoff = sectionIndex(sectionId);

  // OBSERVED: events the character was present at
  const observed = sql(`
    SELECT e.id, e.name, e.pos FROM nodes e
      JOIN edges r ON r.story = e.story AND r.to_id = e.id
                  AND r.rel_type = 'PARTICIPATED_IN'
     WHERE e.kind = 'event' AND r.from_id = $characterId AND e.pos <= $cutoff
  `);

  // TOLD: events whose content was communicated to this character
  const told = sql(`
    SELECT e.id, e.name FROM nodes e
      JOIN edges r ON r.story = e.story AND r.from_id = e.id
                  AND r.rel_type = 'TOLD_TO'
     WHERE e.kind = 'event' AND r.to_id = $characterId AND e.pos <= $cutoff
  `);

  return { observations: observed, beliefs: told };
}
```

**Invariants:**
1. No future knowledge — everything filtered to `pos <= cutoff`.
2. No omniscience — only events where the character was present or a recipient.
3. Beliefs may be false — `TOLD_TO` events carry what was said, not whether it is true.

---

## Query flow (demo / API)

```
POST /api/query
  { slug, characterId, sectionId, question }
        │
        ▼
  answerCharacterQuery()  [lib/query.ts]
        │
        ├─→ getCharacterContext()  [lib/graph-query.ts]
        │     ├─ SQL: join edges on PARTICIPATED_IN → observations
        │     └─ SQL: join edges on TOLD_TO         → beliefs
        │        both bounded by nodes.pos <= the section cutoff
        │
        ├─→ buildSystemPrompt()
        │     "You are ${character} at ${section}.
        │      You witnessed: [events...]
        │      You observed: [facts...]
        │      You were told: [claims...]
        │      Do NOT use information outside this list."
        │
        └─→ LLM.invoke([system, human_question])
              └─→ { answer, context }
```

Retrieval is a pair of indexed joins bounded by a section cutoff. There is no vector store, no embedding lookup, no cosine similarity. The argument was never that a graph engine was required — it was that perspective and time are structure, not similarity, and structure is what a join is for.

---

## Knowledge graph viewer (`/graph`)

The graph page (`app/graph/page.tsx`) is a Next.js server component that fetches data from Postgres on each request, then passes it to the `KnowledgeGraphViewer` client component.

**State in the viewer:**

| State | Effect |
|-------|--------|
| `currentIdx` | Timeline scrubber position; controls which events and entities are visible |
| `selectedCharacterId` | Character perspective filter; restricts visible nodes to that character's subgraph |
| `activeTypes` | Entity type toggles (character / location / object) |
| `showEvents` | Show/hide event diamond nodes |
| `showPastEdges` | Include expired state edges (dashed) |

**Character perspective filtering:**

When a character is selected, `visibleEvents` becomes the union of:
- Events where `characterId ∈ event.participants` (witnessed)
- Events where `characterId ∈ event.communicates.recipients` (told)

`visibleEntities` is then narrowed to entities that co-appear in at least one of those events. This is the same logic as `getCharacterContext()` — the UI filter mirrors the server-side RAG retrieval.

**Live SQL display:**

The SQL strip above the graph renders the query that would produce the current view. It updates as the character selector and timeline change, making the graph/query relationship explicit.

It displays; it never accepts. The string is built in the browser from the viewer's own state and rendered — there is no `fetch` in the viewer, no text input, and no endpoint that takes a query. "See the query" must never become "run my query".

---

## Database schema

Defined in `lib/db/migrations/0001_graph.sql`, applied by `scripts/migrate.ts`.

The model is deliberately generic — two tables, not a normalised set of domain
tables — because it doubles as the exhibit for the article arc: a graph is two
tables. What makes it legible is that the three things the project is actually
about are promoted out of JSONB into real, indexable columns:

| Column | Question it answers |
|---|---|
| `nodes.pos` | **where** — how far into the story this sits |
| `edges.valid_from_section` / `valid_to_section` | **when** — the window a relationship held |
| the edge row itself | **whose perspective** — who saw or was told |

Everything else lives in `props`.

```sql
CREATE TABLE nodes (
  story TEXT, id TEXT, kind TEXT, subkind TEXT, name TEXT, pos INT, props JSONB,
  PRIMARY KEY (story, id)
);

CREATE TABLE edges (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  story TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  rel_type TEXT NOT NULL,
  valid_from_section INT, valid_to_section INT, props JSONB,
  FOREIGN KEY (story, from_id) REFERENCES nodes (story, id) ON DELETE CASCADE,
  FOREIGN KEY (story, to_id)   REFERENCES nodes (story, id) ON DELETE CASCADE
);

CREATE INDEX nodes_story_kind_pos   ON nodes (story, kind, pos);
CREATE INDEX nodes_story_subkind    ON nodes (story, subkind);
CREATE INDEX nodes_story_name       ON nodes (story, name);
CREATE INDEX edges_story_type_from  ON edges (story, rel_type, from_id);
CREATE INDEX edges_story_type_to    ON edges (story, rel_type, to_id);
CREATE INDEX edges_story_valid_from ON edges (story, valid_from_section);
CREATE INDEX edges_story_valid_to   ON edges (story, valid_to_section);
```

`pos` carries the ordinal position in whatever unit the kind implies: section
index for sections, global sentence position for lexical nodes, the index of its
section for events, and NULL for entities, which have no single position.

`(story, kind, pos)` earns its place three times over — as the `(story, kind)`
prefix, as the range scan behind the reader window, and as the ordered cutoff
scan behind "events at or before section N", which is the hottest query in the
perspective model.

---

## File layout

```
sherlock/
├── app/
│   ├── graph/page.tsx          Server component — fetches from Postgres, renders viewer
│   ├── demo/page.tsx           Server component — lists stories with examples
│   ├── api/
│   │   ├── query/route.ts      POST — character Q&A via LLM
│   │   ├── copilotkit/route.ts POST — streaming character chat
│   │   └── ingest/route.ts     POST — trigger re-ingest (development only)
│   └── layout.tsx / globals.css / page.tsx
│
├── components/
│   ├── KnowledgeGraphViewer.tsx   D3 force graph + timeline + live SQL display
│   ├── DemoExampleRunner.tsx      Individual Q&A example card
│   ├── StorySwitcher.tsx          Story dropdown in graph header
│   └── IngestButton.tsx           Trigger re-ingest from the UI
│
├── lib/
│   ├── types.ts                All shared TypeScript interfaces
│   ├── db.ts                   Postgres client — node-postgres locally, Neon in prod
│   ├── db/migrations/          Numbered SQL, applied by scripts/migrate.ts
│   ├── graph-query.ts          SQL queries: story list, story data, character context
│   ├── query.ts                LLM query: builds prompt + calls LLM
│   ├── lexical.ts              Layer 1 builder: segmentation, sentence splitting
│   ├── objective-extract.ts    Layer 2 builder: LLM-driven entity/event extraction
│   └── character-state.ts      Layer 3 client-side helpers (for graph viewer)
│
├── scripts/
│   ├── ingest.ts               CLI: raw text → data/processed/<slug>/
│   ├── migrate.ts              CLI: apply pending lib/db/migrations/*.sql
│   ├── load-canon.ts           CLI: data/processed/<slug>/ → Postgres
│   ├── verify-load.ts          CLI: counts, integrity and storage checks
│   └── compare-parity.ts       CLI: SQL output vs the frozen Neo4j baseline
│
├── data/
│   ├── raw/                    Original story text files
│   └── processed/<slug>/
│       ├── meta.json           { slug, name, sourceFile }
│       ├── lexical.json        LexicalGraph (sections + nodes)
│       ├── objective-graph.json ObjectiveGraph (entities + events + stateEdges)
│       └── examples.json       DemoExample[] (hand-curated Q&A seeds)
│   ├── seed/                   Committed pg_dump, restored on first boot
│   └── parity/                 Frozen Neo4j baseline — see its README
│
└── docker-compose.yml          Postgres 18 service
```
