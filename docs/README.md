# Sherlock — Documentation

A knowledge graph demo that models **theory of mind** inside narrative fiction. Characters answer questions bounded by what they personally witnessed or were told — no omniscience, no vector search, just graph traversal filtered by character and time.

## Documents

| File | What it covers |
|------|---------------|
| [setup.md](setup.md) | Prerequisites, environment variables, running locally |
| [architecture.md](architecture.md) | Three-layer design, the two-table schema, component map |
| [ingest-architecture.md](ingest-architecture.md) | Detailed ingestion pipeline design and constraints |
| [adding-a-story.md](adding-a-story.md) | Step-by-step guide to ingesting a new story |

## The core idea

Every story is processed into three layers:

```
RAW TEXT → LEXICAL GRAPH → OBJECTIVE GRAPH → CHARACTER STATES (runtime)
```

- **Lexical** — every sentence, in order, with entity mentions tagged
- **Objective** — what is true in the world: events, entities, state transitions (no beliefs)
- **Character states** — derived at query time: what a specific character can know at a specific section

Character states are never stored. They are computed on demand by traversing the objective graph filtered to events the character witnessed or was told about. This prevents all hallucination of future knowledge and makes theory-of-mind divergence testable.

## Proof-of-concept story

The primary story is [A Case of Identity](https://en.wikipedia.org/wiki/A_Case_of_Identity) by Arthur Conan Doyle. The Anne/Sally variants are short false-belief test cases used to validate the pipeline works correctly (Watson-like and Sherlock-like divergence, false beliefs, etc).

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React, Tailwind CSS, D3.js |
| Database | Postgres 18 (Docker locally, Neon hosted) |
| LLM | OpenAI (gpt-4o) or Anthropic (claude-sonnet-4-6) via LangChain |
| Ingestion | TypeScript scripts (`tsx`) |
