# Setup

## Prerequisites

- **Node.js 20+** and **npm**
- **Docker** (for Postgres)
- An **OpenAI** or **Anthropic** API key (for ingestion and query answering)

## Environment variables

Copy `.env` and fill in the values:

```bash
# LLM — provide one or both; Anthropic takes priority if both are set
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o              # optional, default: gpt-4o
OPENAI_ORGANISATION=             # optional
OPENAI_PROJECT_ID=               # optional

# Postgres — the default matches docker-compose.yml, only change if needed
SHERLOCK_DATABASE_URL=postgres://postgres:sherlock@localhost:5432/sherlock
```

## Running locally

### 1. Install dependencies

```bash
npm install
```

### 2. Start Postgres

```bash
docker compose up -d
```

The container restores `data/seed/01-canon.sql` on first boot, so the full canon
is already loaded. Nothing else is needed to browse the tools.

Wait a few seconds for the healthcheck to pass before continuing.

### 3. Start the dev server

```bash
npm run dev
```

The app runs on http://localhost:3000 (or 3001 if 3000 is taken).

### 4. Ingest a story

The app ships with pre-processed JSON for the Sherlock and Anne/Sally stories in `data/processed/`. Skip this step if you just want to explore what is already there.

To run the full pipeline on a new or existing story:

```bash
# By slug (matches data/raw/ filename → data/processed/<slug>/)
npm run ingest -- sherlock
npm run ingest -- anne-sally-simple

# By file path
npm run ingest -- data/raw/my-new-story.txt
```

Options:

```bash
# Stop after lexical segmentation (skip LLM extraction)
npm run ingest -- sherlock --split-only

# Process only the first N sections (useful for testing)
npm run ingest -- sherlock --max-sections=5
```

### 5. Load into Postgres

Only needed if you have ingested something new. After ingest, load the JSON:

```bash
npm run db:load
```

This is idempotent — it clears the story's data and re-imports. Run it after every ingest.

### 6. Verify

Open http://localhost:3000/graph — you should see your story in the dropdown. The graph page, demo page, and SQL display all read from Postgres, so the container must be running.

## Pages

| Route | What it is |
|-------|-----------|
| `/` | Landing page |
| `/graph?story=<slug>` | Knowledge graph viewer with character perspective filter |
| `/demo?story=<slug>` | Character Q&A demo (graph-grounded RAG) |

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run ingest -- <slug>` | Run the full ingest pipeline |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:load` | Load all processed stories into Postgres |
| `npm run db:verify` | Check the load against the expected counts |

## Stopping Postgres

```bash
docker compose down
```

Data persists in the Docker volume between restarts.
