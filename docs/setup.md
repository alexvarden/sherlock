# Setup

## Prerequisites

- **Node.js 20+** and **npm**
- **Docker** (for Neo4j)
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

# Neo4j — defaults match docker-compose.yml, only change if needed
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=sherlock
```

## Running locally

### 1. Install dependencies

```bash
npm install
```

### 2. Start Neo4j

```bash
docker compose up -d
```

Neo4j browser is available at http://localhost:7474 (login: `neo4j` / `sherlock`).

Wait ~15 seconds for Neo4j to be healthy before continuing.

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

### 5. Migrate to Neo4j

After ingest, push the JSON to Neo4j:

```bash
npm run migrate
```

This is idempotent — it clears the story's data and re-imports. Run it after every ingest.

### 6. Verify

Open http://localhost:3000/graph — you should see your story in the dropdown. The graph page, demo page, and Cypher display all require Neo4j to be running and migrated.

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
| `npm run migrate` | Push all processed stories to Neo4j |

## Stopping Neo4j

```bash
docker compose down
```

Data persists in the Docker volume between restarts.
