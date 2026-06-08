# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js App                           │
│                                                          │
│  /graph          Knowledge graph viewer (D3 + filters)  │
│  /demo           Character Q&A demo                     │
│  /api/query      POST → LLM answer for a character      │
│  /api/graph/query POST → raw Cypher passthrough         │
│  /api/ingest     POST → trigger re-ingest in browser    │
└───────────────────────────┬─────────────────────────────┘
                            │
                            │ bolt://localhost:7687
                            │
┌───────────────────────────▼─────────────────────────────┐
│               Neo4j 5 (Docker)                           │
│  Story · Section · LexicalNode · Entity · Event         │
│  Relationships: PARTICIPATED_IN · TOLD_TO · SPOKE_IN    │
│                 PERFORMED · IS_INSIDE · LOCATED_AT · OWNS│
└───────────────────────────┬─────────────────────────────┘
                            │
                   (write path only)
                            │
┌───────────────────────────▼─────────────────────────────┐
│            Ingest + Migrate Scripts                      │
│  scripts/ingest.ts         Raw text → JSON              │
│  scripts/migrate-to-neo4j.ts  JSON → Neo4j             │
└─────────────────────────────────────────────────────────┘
```

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

| Label | Description |
|-------|-------------|
| `Story` | Top-level story node, holds slug/name/granularity |
| `Section` | Named chunk of the story with an `index` for ordering |
| `LexicalNode` | Individual sentence/paragraph |
| `Entity:Character` | A person |
| `Entity:Location` | A place |
| `Entity:Object` | A thing |
| `Event` | Something that happened; the primary unit of narrative |

**Relationship types:**

| Relationship | Meaning |
|-------------|---------|
| `PARTICIPATED_IN` | Entity was present at an event (witnesses it) |
| `PERFORMED` | Entity was the agent of the event |
| `SPOKE_IN` | Entity was the speaker in a communicates event |
| `TOLD_TO` | Event communicated content to this entity (recipient) |
| `IS_INSIDE` | Containment state edge (with `validFromIndex`/`validUntilIndex`) |
| `LOCATED_AT` | Location state edge |
| `OWNS` | Ownership state edge |

**State edges carry validity windows:**

```
(marble)-[:IS_INSIDE {validFromIndex: 2, validUntilIndex: 5}]->(red_basket)
(marble)-[:IS_INSIDE {validFromIndex: 5}]->(blue_box)
```

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
  const observed = graph.query(`
    MATCH (c {id: $characterId})-[:PARTICIPATED_IN]->(e:Event)
    WHERE e.sectionIndex <= $cutoff
  `);

  // TOLD: events whose content was communicated to this character
  const told = graph.query(`
    MATCH (e:Event)-[:TOLD_TO]->(c {id: $characterId})
    WHERE e.sectionIndex <= $cutoff
  `);

  return { observations: observed, beliefs: told };
}
```

**Invariants:**
1. No future knowledge — everything filtered to `sectionIndex <= cutoff`.
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
        │     ├─ Neo4j: PARTICIPATED_IN query  → observations
        │     └─ Neo4j: TOLD_TO query          → beliefs
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

Retrieval is pure graph traversal. There is no vector store, no embedding lookup, no cosine similarity.

---

## Knowledge graph viewer (`/graph`)

The graph page (`app/graph/page.tsx`) is a Next.js server component that fetches data from Neo4j on each request, then passes it to the `KnowledgeGraphViewer` client component.

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

**Live Cypher display:**

The Cypher strip above the graph renders the query that would produce the current view. It updates as the character selector and timeline change, making the graph/query relationship explicit.

---

## Neo4j schema (indexes)

Created by `scripts/migrate-to-neo4j.ts` on first run:

```cypher
CREATE INDEX entity_story_id   FOR (n:Entity)     ON (n.story, n.id)
CREATE INDEX event_story_id    FOR (e:Event)      ON (e.story, e.id)
CREATE INDEX event_story_section FOR (e:Event)    ON (e.story, e.sectionIndex)
CREATE INDEX section_story_id  FOR (s:Section)    ON (s.story, s.id)
CREATE INDEX story_slug        FOR (s:Story)      ON (s.slug)
CREATE INDEX lexical_node_story_section FOR (n:LexicalNode) ON (n.story, n.section)
```

---

## File layout

```
sherlock/
├── app/
│   ├── graph/page.tsx          Server component — fetches from Neo4j, renders viewer
│   ├── demo/page.tsx           Server component — lists stories with examples
│   ├── api/
│   │   ├── query/route.ts      POST — character Q&A via LLM
│   │   ├── ingest/route.ts     POST — trigger re-ingest in browser
│   │   └── graph/query/route.ts POST — read-only Cypher passthrough
│   └── layout.tsx / globals.css / page.tsx
│
├── components/
│   ├── KnowledgeGraphViewer.tsx   D3 force graph + timeline + Cypher display
│   ├── DemoExampleRunner.tsx      Individual Q&A example card
│   ├── StorySwitcher.tsx          Story dropdown in graph header
│   └── IngestButton.tsx           Trigger re-ingest from the UI
│
├── lib/
│   ├── types.ts                All shared TypeScript interfaces
│   ├── neo4j.ts                Driver singleton (bolt connection)
│   ├── graph-query.ts          Neo4j queries: story list, story data, character context
│   ├── query.ts                LLM query: builds prompt + calls LLM
│   ├── lexical.ts              Layer 1 builder: segmentation, sentence splitting
│   ├── objective-extract.ts    Layer 2 builder: LLM-driven entity/event extraction
│   └── character-state.ts      Layer 3 client-side helpers (for graph viewer)
│
├── scripts/
│   ├── ingest.ts               CLI: raw text → data/processed/<slug>/
│   └── migrate-to-neo4j.ts     CLI: data/processed/<slug>/ → Neo4j
│
├── data/
│   ├── raw/                    Original story text files
│   └── processed/<slug>/
│       ├── meta.json           { slug, name, sourceFile }
│       ├── lexical.json        LexicalGraph (sections + nodes)
│       ├── objective-graph.json ObjectiveGraph (entities + events + stateEdges)
│       └── examples.json       DemoExample[] (hand-curated Q&A seeds)
│
└── docker-compose.yml          Neo4j 5 service
```
