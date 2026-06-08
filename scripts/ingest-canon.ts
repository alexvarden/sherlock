import * as fs from "fs";
import * as path from "path";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { buildLexicalGraph } from "../lib/lexical";
import { buildObjectiveGraph, validateObjectiveGraph } from "../lib/objective-extract";

// ── Canon ingest: 4 novels + 12 Memoirs stories ──────────────────────────
// Per-story checkpoint resume is inherited from buildObjectiveGraph, and any
// story with a final objective-graph.json is skipped. Safe to re-run.

interface StoryConfig {
  slug: string;
  name: string;
  rawFile: string;
  estimatedWords: number;
}

const CANON: StoryConfig[] = [
  // Novels — sourceSlug enables per-source chapter detection in lib/lexical.ts
  { slug: "a-study-in-scarlet",        name: "A Study in Scarlet",            rawFile: "data/raw/a-study-in-scarlet.txt",        estimatedWords: 44000 },
  { slug: "sign-of-the-four",          name: "The Sign of the Four",          rawFile: "data/raw/sign-of-the-four.txt",          estimatedWords: 44000 },
  { slug: "hound-of-the-baskervilles", name: "The Hound of the Baskervilles", rawFile: "data/raw/hound-of-the-baskervilles.txt", estimatedWords: 59000 },
  { slug: "valley-of-fear",            name: "The Valley of Fear",            rawFile: "data/raw/valley-of-fear.txt",            estimatedWords: 58000 },

  // Memoirs of Sherlock Holmes — 12 short stories. silver-blaze done via pilot.
  { slug: "silver-blaze",        name: "Silver Blaze",              rawFile: "data/raw/memoirs/silver-blaze.txt",        estimatedWords: 9500 },
  { slug: "yellow-face",         name: "The Yellow Face",           rawFile: "data/raw/memoirs/yellow-face.txt",         estimatedWords: 6800 },
  { slug: "cardboard-box",       name: "The Cardboard Box",         rawFile: "data/raw/memoirs/cardboard-box.txt",       estimatedWords: 7000 },
  { slug: "stockbrokers-clerk",  name: "The Stockbroker's Clerk",   rawFile: "data/raw/memoirs/stockbrokers-clerk.txt",  estimatedWords: 7200 },
  { slug: "gloria-scott",        name: "The Gloria Scott",          rawFile: "data/raw/memoirs/gloria-scott.txt",        estimatedWords: 7400 },
  { slug: "musgrave-ritual",     name: "The Musgrave Ritual",       rawFile: "data/raw/memoirs/musgrave-ritual.txt",     estimatedWords: 7600 },
  { slug: "reigate-squires",     name: "The Reigate Squires",       rawFile: "data/raw/memoirs/reigate-squires.txt",     estimatedWords: 7800 },
  { slug: "crooked-man",         name: "The Crooked Man",           rawFile: "data/raw/memoirs/crooked-man.txt",         estimatedWords: 8000 },
  { slug: "resident-patient",    name: "The Resident Patient",      rawFile: "data/raw/memoirs/resident-patient.txt",    estimatedWords: 8200 },
  { slug: "greek-interpreter",   name: "The Greek Interpreter",     rawFile: "data/raw/memoirs/greek-interpreter.txt",   estimatedWords: 8400 },
  { slug: "naval-treaty",        name: "The Naval Treaty",          rawFile: "data/raw/memoirs/naval-treaty.txt",        estimatedWords: 12000 },
  { slug: "final-problem",       name: "The Final Problem",         rawFile: "data/raw/memoirs/final-problem.txt",       estimatedWords: 8600 },

  // The Adventures of Sherlock Holmes (outside Memoirs canon — for model comparison)
  { slug: "a-case-of-identity",  name: "A Case of Identity",        rawFile: "data/raw/a-case-of-identity.txt",        estimatedWords: 5000 },
];

// Chunk-size tradeoff: smaller chunks give weak models more attention per
// sentence and better schema compliance, but break cross-sentence coreference
// across boundaries. Tune per model tier. Override with CHUNK_WORDS env var.
//
// Empirical sizing from A Case of Identity comparison (5,000w story):
//   nano @ 600w  → 311 events, 8 dup cases  (high recall, poor reconciliation)
//   mini @ 600w  → 132 events, 3 canon cases (best balance)
//   mini @ 3000w → 88 events, 2 canon cases (cleanest schema, lowest recall)
// 600w wins for both tiers; mini handles entity reconciliation within the chunk.
function defaultChunkWordsForModel(model: string): number {
  const m = model.toLowerCase();
  // Frontier: long context, strong attention — bigger chunks reduce dedup cost.
  if (m.includes("sonnet") || m.includes("opus") || m.includes("gpt-4.5")) return 3000;
  // gpt-5 (non-mini/nano) — frontier-ish
  if (m.includes("gpt-5") && !m.includes("nano") && !m.includes("mini")) return 3000;
  // Mid-tier: gpt-4o, o3, haiku get balanced chunks.
  if (m.includes("haiku") || m.includes("gpt-4o") || m.includes("o3")) return 1500;
  // gpt-5-mini and nano both win on small chunks (data above).
  if (m.includes("mini") || m.includes("nano")) return 600;
  return 1500;
}

const ACTIVE_MODEL = process.env.ANTHROPIC_API_KEY
  ? (process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5")
  : (process.env.OPENAI_MODEL ?? "gpt-4o-mini");
const CHUNK_WORDS = parseInt(process.env.CHUNK_WORDS ?? "", 10) || defaultChunkWordsForModel(ACTIVE_MODEL);

// ── Bounded-concurrency pool ──────────────────────────────────────────────
// Stories are independent — separate entity universes, checkpoints, output
// dirs — so they parallelise safely. (Sections *within* a story stay serial;
// that invariant is enforced inside buildObjectiveGraph.) Cap concurrency to
// stay under provider rate limits; tune with INGEST_CONCURRENCY (default 3).
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runner = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, runner));
  return results;
}

function buildLLM(): BaseChatModel {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      temperature: 0,
      maxTokens: 4096,
    }) as unknown as BaseChatModel;
  }
  if (process.env.OPENAI_API_KEY) {
    const effort = process.env.OPENAI_REASONING_EFFORT as
      | "minimal" | "low" | "medium" | "high" | undefined;
    return new ChatOpenAI({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      ...(effort ? { reasoningEffort: effort } : {}),
      configuration: {
        ...(process.env.OPENAI_ORGANISATION ? { organization: process.env.OPENAI_ORGANISATION } : {}),
        ...(process.env.OPENAI_PROJECT_ID ? { defaultHeaders: { "OpenAI-Project": process.env.OPENAI_PROJECT_ID } } : {}),
      },
    }) as unknown as BaseChatModel;
  }
  throw new Error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
}

interface StoryResult {
  slug: string;
  entities: number;
  events: number;
  stateEdges: number;
  mentions: number;
  clues: number;
  sections: number;
  elapsedSeconds: number;
  skipped?: boolean;
  missing?: boolean;
}

async function ingestStory(config: StoryConfig, llm: BaseChatModel): Promise<StoryResult | null> {
  const rawPath = path.join(process.cwd(), config.rawFile);
  if (!fs.existsSync(rawPath)) {
    console.log(`⏭  ${config.slug.padEnd(28)} raw file missing (${config.rawFile})`);
    return { slug: config.slug, entities: 0, events: 0, stateEdges: 0, mentions: 0, clues: 0, sections: 0, elapsedSeconds: 0, missing: true };
  }

  const processedDir = path.join(process.cwd(), "data/processed", config.slug);
  const finalPath = path.join(processedDir, "objective-graph.json");
  if (fs.existsSync(finalPath)) {
    const obj = JSON.parse(fs.readFileSync(finalPath, "utf-8"));
    console.log(`✓  ${config.slug.padEnd(28)} already done (${obj.entities.length}e ${obj.events.length}ev) — skipping`);
    return { slug: config.slug, entities: obj.entities.length, events: obj.events.length, stateEdges: obj.stateEdges.length, mentions: (obj.mentions ?? []).length, clues: (obj.clues ?? []).length, sections: 0, elapsedSeconds: 0, skipped: true };
  }

  console.log("");
  console.log(`▶ ${config.name} (${config.slug}, ~${config.estimatedWords.toLocaleString()}w)`);

  const text = fs.readFileSync(rawPath, "utf-8");

  // Stage A: lexical graph (per-source chapter detection via sourceSlug)
  const lexical = buildLexicalGraph(text, {
    sectionGranularity: "chunk",
    lexicalGranularity: "sentence",
    chunkWords: CHUNK_WORDS,
    sourceSlug: config.slug,
  });
  console.log(`  ${config.slug.padEnd(26)} lexical  ${lexical.sections.length} sections, ${lexical.nodes.length} sentences`);

  fs.mkdirSync(processedDir, { recursive: true });
  fs.writeFileSync(
    path.join(processedDir, "meta.json"),
    JSON.stringify({ slug: config.slug, name: config.name, sourceFile: config.rawFile }, null, 2)
  );
  fs.writeFileSync(path.join(processedDir, "lexical.json"), JSON.stringify(lexical, null, 2));

  // Stage B: objective graph (resumable via checkpoint)
  const checkpointPath = path.join(processedDir, "objective-graph.wip.json");
  if (fs.existsSync(checkpointPath)) console.log("  resuming from checkpoint");

  const t0 = Date.now();
  const objective = await buildObjectiveGraph(llm, lexical, {
    checkpointPath,
    onProgress: (p) => {
      const pct = String(Math.round((p.index / p.total) * 100)).padStart(3);
      const idx = String(p.index).padStart(String(p.total).length);
      const sec = (p.elapsedMs / 1000).toFixed(1).padStart(5);
      const newE = p.newEntities > 0 ? `+${p.newEntities}e` : "   ";
      process.stdout.write(
        `  ${config.slug.padEnd(26)} [${idx}/${p.total}] ${pct}%  ${p.sectionId.padEnd(22)}` +
        `  ${newE.padEnd(4)}  ${p.sectionEvents}ev  ${p.sectionStates}st` +
        `  (${sec}s)  Σ ${p.totalEntities}e ${p.totalEvents}ev\n`
      );
    },
  });
  const elapsed = (Date.now() - t0) / 1000;

  const errors = validateObjectiveGraph(objective);
  if (errors.length > 0) {
    console.error(`⚠  ${config.slug}: ${errors.length} validation errors (continuing):`);
    for (const e of errors.slice(0, 5)) console.error(`     - ${e}`);
    if (errors.length > 5) console.error(`     (… ${errors.length - 5} more)`);
  }

  fs.writeFileSync(finalPath, JSON.stringify(objective, null, 2));
  if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);

  console.log(
    `✅ ${config.slug.padEnd(28)} ${elapsed.toFixed(1)}s  ` +
    `${objective.entities.length}e ${objective.events.length}ev ` +
    `${objective.stateEdges.length}st ${objective.mentions.length}m ${objective.clues.length}c`
  );

  return {
    slug: config.slug,
    entities: objective.entities.length,
    events: objective.events.length,
    stateEdges: objective.stateEdges.length,
    mentions: objective.mentions.length,
    clues: objective.clues.length,
    sections: lexical.sections.length,
    elapsedSeconds: elapsed,
  };
}

async function main() {
  const llm = buildLLM();
  const model = process.env.ANTHROPIC_API_KEY
    ? (process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5")
    : (process.env.OPENAI_MODEL ?? "gpt-4o-mini");

  // Optional filter via CLI: `npm run ingest:canon -- novels` or a single slug
  const filterArg = process.argv[2];
  const stories = filterArg === "novels"
    ? CANON.filter((c) => !c.rawFile.includes("memoirs/"))
    : filterArg === "memoirs"
    ? CANON.filter((c) => c.rawFile.includes("memoirs/"))
    : filterArg
    ? CANON.filter((c) => c.slug === filterArg)
    : CANON;

  if (filterArg && stories.length === 0) {
    console.error(`No stories match "${filterArg}". Try: novels, memoirs, or a specific slug.`);
    process.exit(1);
  }

  const concurrency = Math.max(1, parseInt(process.env.INGEST_CONCURRENCY ?? "3", 10) || 3);

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  Canon ingest                                                     ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log(`  model         ${model}`);
  if (process.env.OPENAI_REASONING_EFFORT) console.log(`  reasoning     ${process.env.OPENAI_REASONING_EFFORT}`);
  console.log(`  chunkWords    ${CHUNK_WORDS}`);
  console.log(`  concurrency   ${concurrency} ${concurrency === 1 ? "(serial)" : "stories at once"}`);
  console.log(`  stories       ${stories.length}${filterArg ? ` (filter: ${filterArg})` : ""}`);
  console.log("");

  // Stories run in a bounded pool. A failed story doesn't abort the others —
  // its checkpoint is preserved, so it can be re-run independently afterward.
  const failures: Array<{ slug: string; error: string }> = [];
  const results = (
    await runWithConcurrency(stories, concurrency, async (config) => {
      try {
        return await ingestStory(config, llm);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`✗  ${config.slug} failed: ${msg}`);
        console.error(`   Checkpoint preserved — re-run with: npm run ingest:canon -- ${config.slug}`);
        failures.push({ slug: config.slug, error: msg });
        return null;
      }
    })
  ).filter((r): r is StoryResult => r !== null);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n┌──────────────────────────────────────────────────────────────┐");
  console.log("│  Canon ingest complete                                        │");
  console.log("└──────────────────────────────────────────────────────────────┘");
  const fresh = results.filter((r) => !r.skipped && !r.missing);
  console.log(`  ${fresh.length} ingested · ${results.filter((r) => r.skipped).length} skipped (already done) · ${results.filter((r) => r.missing).length} missing source · ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`    ✗ ${f.slug}: ${f.error}`);
  }
  const totals = results.reduce(
    (acc, r) => ({
      entities: acc.entities + r.entities,
      events: acc.events + r.events,
      stateEdges: acc.stateEdges + r.stateEdges,
      mentions: acc.mentions + r.mentions,
      clues: acc.clues + r.clues,
      seconds: acc.seconds + r.elapsedSeconds,
    }),
    { entities: 0, events: 0, stateEdges: 0, mentions: 0, clues: 0, seconds: 0 }
  );
  console.log(`  totals: ${totals.entities} entities · ${totals.events} events · ${totals.stateEdges} state · ${totals.mentions} mentions · ${totals.clues} clues`);
  if (fresh.length > 0) console.log(`  fresh-ingest time: ${(totals.seconds / 60).toFixed(1)} min`);
  console.log("\n  Next: npm run migrate   (loads everything into Neo4j)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
