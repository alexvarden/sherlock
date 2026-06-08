# Adding a story

## 1. Add the raw text

Place the story file in `data/raw/`. Supported formats: `.txt`, `.md`.

```
data/raw/my-new-story.txt
```

The filename becomes the slug after normalisation (spaces/underscores → hyphens, lowercase). For example `My_New_Story.txt` → slug `my-new-story`.

## 2. Run the ingest pipeline

```bash
npm run ingest -- my-new-story
```

The pipeline runs two stages:

**Stage 1 — Lexical graph** (fast, no LLM)

Segments the text into sections and sentences. Output written to `data/processed/my-new-story/lexical.json`.

**Stage 2 — Objective graph** (slow, uses LLM)

Extracts entities, events, and state transitions section by section. Output written to `data/processed/my-new-story/objective-graph.json`.

Each section is checkpointed to `objective-graph.wip.json`. If the process is interrupted, re-running the command resumes from the last checkpoint.

### Ingest options

| Option | Default | Description |
|--------|---------|-------------|
| `--split-only` | off | Skip LLM extraction; write only `lexical.json` |
| `--max-sections=N` | all | Process only the first N sections (useful for testing) |
| `SECTION_GRANULARITY` env | `chunk` | How to split into sections: `chunk`, `heading`, `paragraph` |
| `LEXICAL_GRANULARITY` env | `sentence` | Granularity of lexical nodes: `sentence`, `paragraph` |
| `SEGMENT_WORDS` env | `150` | Target word count per chunk (when using `chunk` granularity) |

Example — test the first 3 sections only:

```bash
npm run ingest -- my-new-story --max-sections=3
```

## 3. Migrate to Neo4j

Make sure Docker is running, then:

```bash
npm run migrate
```

This pushes all stories in `data/processed/` to Neo4j. It is idempotent — run it again after any re-ingest.

## 4. Add demo examples (optional)

Create `data/processed/my-new-story/examples.json` with hand-curated Q&A seeds:

```json
[
  {
    "id": "ex_1",
    "character": "character_id_from_objective_graph",
    "section": "section_id_from_lexical_graph",
    "question": "What do you know about X?",
    "expectedTheme": "Should express uncertainty because they weren't there yet"
  }
]
```

- `character` — must match an entity `id` in `objective-graph.json` (type `character`)
- `section` — must match a section `id` in `lexical.json`
- `expectedTheme` — optional curator note; not shown to users, just used for review

Once the file exists, the story appears on the `/demo` page.

## 5. Verify

```bash
# Open the graph viewer
open http://localhost:3000/graph?story=my-new-story

# Open the demo
open http://localhost:3000/demo?story=my-new-story
```

## Troubleshooting

**Ingest fails mid-way** — rerun the same command; it will resume from the checkpoint.

**Entity/event extraction is poor** — the LLM sometimes struggles with non-linear or heavily metaphorical narratives. Try breaking the story into shorter sections with `SEGMENT_WORDS=100`.

**Characters have wrong IDs in examples.json** — open `data/processed/<slug>/objective-graph.json` and find the entity `id` fields in the `entities` array.

**Story not appearing after migrate** — check `docker compose ps` to confirm Neo4j is running, then re-run `npm run migrate` and hard-refresh the browser.
