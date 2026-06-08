# Ingest Architecture

The ingestion pipeline for this project is a **three-layer system** with strict separation between what objectively happens in a story and what each character knows about it.

## Core Principle (non-negotiable)

> **Store only what happens in the story. Compute what each character knows from that — never store beliefs in the graph.**

Mixing belief into the objective graph produces contradiction bugs, breaks recomputability, and makes the theory-of-mind simulation impossible to validate. The objective graph is reality; character knowledge is a derived view over it.

## Pipeline

```
RAW TEXT
  ↓
[1] LEXICAL GRAPH    — sentence-level, ordered, immutable
  ↓
[2] OBJECTIVE GRAPH  — events, entities, state transitions
  ↓
[3] CHARACTER STATES — derived per (character, section)
```

---

## Layer 1 — Lexical Graph

Ground every claim in text. Enables traceability and chronology.

### Schema

```ts
type LexicalNode = {
  id: string;          // e.g. "sentence_12"
  section: string;     // "section_1"
  position: number;    // global ordering within the story
  text: string;
  entities: string[];  // mentions detected in the text
};
```

### Requirements

- Sentence-level minimum (paragraph-level is a configurable variant for testing).
- Strict global order via `position`.
- Immutable after creation.
- MUST support `getNodesUpTo(section)`.

---

## Layer 2 — Objective Graph

Stores **only what is true in the world** at a given time. No interpretation, no character knowledge, no belief.

### Allowed Node Types

- **Entities**: `character`, `object`, `location`
- **Events** (the primary unit):

```ts
type Event = {
  id: string;
  type: "event";
  label: string;
  section: string;        // section where this event occurs
  source_nodes: string[]; // lexical_node ids supporting this event
};
```

### Allowed Edge Types

- **State**: `IS_INSIDE`, `LOCATED_AT`, `OWNS`
- **Action**: `MOVES`, `PERFORMS`, `COMMUNICATES`
- **Effect**: `AFFECTS`

### State Transitions — use validity windows

State edges MUST carry validity windows tied to the events that caused them. Never duplicate state edges without time bounds.

❌ **Wrong** — two simultaneous truths:
```
marble → IS_INSIDE → red_basket
marble → IS_INSIDE → blue_box
```

✅ **Correct** — time-bounded transitions:
```ts
type StateEdge = {
  from: string;
  to: string;
  type: "IS_INSIDE";
  valid_from?: string;     // event_id that began this state
  valid_until?: string;    // event_id that ended it
  caused_by: string[];     // event_ids
};
```

### Speech acts as objective events

A `COMMUNICATES` event ("X tells Y that Z") is itself objective. The event existed in the world; whether the content `Z` is true is a separate question answered by other Layer 2 edges. This is the mechanism that lets Layer 3 model false beliefs:

- Layer 2 has: `Anne COMMUNICATES "marble in box" to Sally` AND `LOCATED_AT(marble, bucket)` valid in the same window.
- Layer 3 derives: Sally has TOLD knowledge `marble in box`, the world contradicts it → Sally has a false belief.

### Forbidden in Layer 2

- `BELIEVES`, `KNOWS`, `DOES_NOT_KNOW`
- `knownBy` fields
- Any character-specific cognitive edge
- Any duplicated state edges without validity windows

### Layer 2 must answer

> "What is true in the world at time T?"

---

## Layer 3 — Character States (derived)

Compute, do not store.

### Schema

```ts
type CharacterState = {
  character: string;
  section: string;
  observations: KnowledgeItem[];
  beliefs: KnowledgeItem[];
  deductions: KnowledgeItem[];
  emotional_state?: string;
};

type KnowledgeItem = {
  fact_id: string;            // reference, not raw NL
  based_on_events: string[];  // event_ids grounding this knowledge
  modality: "OBSERVED" | "TOLD" | "INFERRED" | "ASSUMED";
  confidence: number;         // 0–1
};
```

### Modalities

| Modality   | Source                          |
|------------|---------------------------------|
| OBSERVED   | character was present at event  |
| TOLD       | learned via a `COMMUNICATES` event the character was a recipient of |
| INFERRED   | derived by reasoning over known events |
| ASSUMED    | held without strong grounding   |

### Hard rules

1. **No future knowledge.** Filter `event.section <= currentSection` before building state.
2. **No omniscience.** Only events the character observed, was told, or can infer from those.
3. **No raw NL statements.** Use `fact_id` references; the resolution to text comes from lexical nodes.
4. **Every item is grounded.** Every `KnowledgeItem` MUST have non-empty `based_on_events`.

---

## Information Flow Model

A character knows a fact via exactly one of:

1. **Observation** — character was present at the event (`character ∈ event.participants`)
2. **Communication** — a `COMMUNICATES` event named the character as recipient
3. **Inference** — reasoning chain over already-known facts/events

Anything else is a violation.

---

## Runtime Query Flow

```ts
function query(character: string, section: string, question: string) {
  const events = getEventsUpTo(section);
  const state = buildCharacterState(character, events);
  return LLM({
    system: `You are ${character} at ${section}`,
    context: { state, events },
    question,
  });
}
```

Retrieval is **graph traversal filtered by character + time**, never vector similarity.

---

## Validation

Objective graph:
- No cognitive edge types anywhere
- Every edge linked to ≥1 event or lexical node
- No duplicated state edges without validity windows

Character states:
- No reference to events with `section > currentSection`
- Every `KnowledgeItem.based_on_events` non-empty
- Different characters at the same section produce diverging states when the story warrants it (validated against Sally-Anne false-belief outcome)

---

## Common Failure Modes

| Symptom                        | Fix                                                  |
|--------------------------------|------------------------------------------------------|
| Belief stored in graph         | Move to Layer 3 derivation                           |
| `knownBy` on edges             | Delete; recompute via observation/communication      |
| Raw NL in `KnowledgeItem`      | Replace with `fact_id` reference                     |
| Duplicated state edges         | Add `valid_from` / `valid_until` and `caused_by`     |
| Per-section character snapshots stored as JSON | Replace with a function over events ≤ section |
| Cosine retrieval               | Replace with graph traversal scoped to character+time |

---

## Design Philosophy

We are not building a static knowledge graph. We are building a **simulation of information flow inside a narrative**.
