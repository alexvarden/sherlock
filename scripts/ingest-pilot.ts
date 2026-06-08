import * as fs from "fs";
import * as path from "path";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { buildLexicalGraph, type LexicalGranularity, type SectionGranularity } from "../lib/lexical";
import { buildObjectiveGraph, validateObjectiveGraph } from "../lib/objective-extract";

// ── Pilot ingest: shortest story first for quality review ─────────────────

function buildLLM(): BaseChatModel {
  // Use Haiku 4.5 for pilot as recommended in spec
  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: "claude-haiku-4-5",
      temperature: 0,
      maxTokens: 4096,
    }) as unknown as BaseChatModel;
  }
  if (process.env.OPENAI_API_KEY) {
    return new ChatOpenAI({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      // gpt-5 reasoning models default to medium effort — extraction is a
      // structured-output task, not a reasoning task, so the lowest effort
      // cuts per-section latency hard with little quality cost. gpt-5.4-nano's
      // floor is "none" (no reasoning); "minimal" is not accepted by it.
      // Ignored by non-reasoning models (e.g. gpt-4o-mini).
      reasoning: { effort: "none" },
      configuration: {
        ...(process.env.OPENAI_ORGANISATION ? { organization: process.env.OPENAI_ORGANISATION } : {}),
        ...(process.env.OPENAI_PROJECT_ID ? { defaultHeaders: { "OpenAI-Project": process.env.OPENAI_PROJECT_ID } } : {}),
      },
    }) as unknown as BaseChatModel;
  }
  throw new Error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
}

interface StoryConfig {
  slug: string;
  name: string;
  rawFile: string;
  estimatedWords: number;
}

// Memoirs stories ordered by estimated length (shortest first)
const MEMOIRS_STORIES: StoryConfig[] = [
  { slug: "silver-blaze", name: "Silver Blaze", rawFile: "data/raw/memoirs/silver-blaze.txt", estimatedWords: 6500 },
  { slug: "yellow-face", name: "The Yellow Face", rawFile: "data/raw/memoirs/yellow-face.txt", estimatedWords: 6800 },
  { slug: "cardboard-box", name: "The Cardboard Box", rawFile: "data/raw/memoirs/cardboard-box.txt", estimatedWords: 7000 },
  { slug: "stockbrokers-clerk", name: "The Stockbroker's Clerk", rawFile: "data/raw/memoirs/stockbrokers-clerk.txt", estimatedWords: 7200 },
  { slug: "gloria-scott", name: "The Gloria Scott", rawFile: "data/raw/memoirs/gloria-scott.txt", estimatedWords: 7400 },
  { slug: "musgrave-ritual", name: "The Musgrave Ritual", rawFile: "data/raw/memoirs/musgrave-ritual.txt", estimatedWords: 7600 },
  { slug: "reigate-squires", name: "The Reigate Squires", rawFile: "data/raw/memoirs/reigate-squires.txt", estimatedWords: 7800 },
  { slug: "crooked-man", name: "The Crooked Man", rawFile: "data/raw/memoirs/crooked-man.txt", estimatedWords: 8000 },
  { slug: "resident-patient", name: "The Resident Patient", rawFile: "data/raw/memoirs/resident-patient.txt", estimatedWords: 8200 },
  { slug: "greek-interpreter", name: "The Greek Interpreter", rawFile: "data/raw/memoirs/greek-interpreter.txt", estimatedWords: 8400 },
  { slug: "naval-treaty", name: "The Naval Treaty", rawFile: "data/raw/memoirs/naval-treaty.txt", estimatedWords: 12000 },
  { slug: "final-problem", name: "The Final Problem", rawFile: "data/raw/memoirs/final-problem.txt", estimatedWords: 8600 },
];

async function ingestStory(config: StoryConfig, llm: BaseChatModel) {
  const rawPath = path.join(process.cwd(), config.rawFile);
  
  if (!fs.existsSync(rawPath)) {
    console.error(`❌ Source file not found: ${rawPath}`);
    console.log(`   Please download and prepare the source text first.`);
    return null;
  }

  const text = fs.readFileSync(rawPath, "utf-8");
  
  console.log("┌─────────────────────────────────────────────┐");
  console.log(`│  Pilot ingest: ${config.name.padEnd(26)} │`);
  console.log("└─────────────────────────────────────────────┘");
  console.log(`  slug         ${config.slug}`);
  console.log(`  source       ${config.rawFile}`);
  console.log(`  est. words   ~${config.estimatedWords}`);
  const modelName = process.env.ANTHROPIC_API_KEY
    ? "claude-haiku-4-5"
    : (process.env.OPENAI_MODEL || "gpt-4o-mini");
  console.log(`  model        ${modelName}`);
  console.log("");

  // ── Stage A: Lexical graph ──────────────────────────────────────────────
  console.log("[1/2] Building lexical graph...");
  const lexical = buildLexicalGraph(text, {
    sectionGranularity: "chunk",
    lexicalGranularity: "sentence",
    chunkWords: 3000,
    sourceSlug: config.slug,
  });
  console.log(`   → ${lexical.sections.length} sections, ${lexical.nodes.length} lexical nodes`);

  const processedDir = path.join(process.cwd(), "data/processed", config.slug);
  fs.mkdirSync(processedDir, { recursive: true });

  fs.writeFileSync(
    path.join(processedDir, "meta.json"),
    JSON.stringify({ slug: config.slug, name: config.name, sourceFile: config.rawFile }, null, 2)
  );
  fs.writeFileSync(path.join(processedDir, "lexical.json"), JSON.stringify(lexical, null, 2));

  // ── Stage B: Objective graph ────────────────────────────────────────────
  const checkpointPath = path.join(processedDir, "objective-graph.wip.json");
  const resuming = fs.existsSync(checkpointPath);
  console.log(`\n[2/2] Extracting objective graph...${resuming ? " (resuming)" : ""}`);
  
  const t0 = Date.now();
  const objective = await buildObjectiveGraph(llm, lexical, {
    checkpointPath,
    onProgress: (p) => {
      const pct = String(Math.round((p.index / p.total) * 100)).padStart(3);
      const idx = String(p.index).padStart(String(p.total).length);
      const sec = (p.elapsedMs / 1000).toFixed(1).padStart(5);
      const newE = p.newEntities > 0 ? `+${p.newEntities}e` : "   ";
      const line = `  [${idx}/${p.total}] ${pct}%  ${p.sectionId.padEnd(20)}` +
        `  ${String(p.nodeCount).padStart(2)} nodes` +
        `  ${newE.padEnd(4)}  ${p.sectionEvents}ev  ${p.sectionStates}st` +
        `  (${sec}s)` +
        `  Σ ${p.totalEntities}e ${p.totalEvents}ev ${p.totalStates}st\n`;
      process.stdout.write(line);
    },
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // ── Validation ──────────────────────────────────────────────────────────
  const errors = validateObjectiveGraph(objective);
  if (errors.length > 0) {
    console.error("\n⚠  Validation errors:");
    for (const e of errors) console.error(`   - ${e}`);
    throw new Error("Validation failed — fix before proceeding");
  }

  fs.writeFileSync(path.join(processedDir, "objective-graph.json"), JSON.stringify(objective, null, 2));
  if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);

  console.log(`\n✅ Done in ${elapsed}s → data/processed/${config.slug}/`);
  console.log(`   ${objective.entities.length} entities · ${objective.events.length} events · ${objective.stateEdges.length} state edges`);
  console.log(`   ${objective.mentions.length} mentions · ${objective.clues.length} clues · ${objective.memberOf.length} memberships`);
  
  return {
    slug: config.slug,
    entities: objective.entities.length,
    events: objective.events.length,
    stateEdges: objective.stateEdges.length,
    sections: lexical.sections.length,
    elapsedSeconds: parseFloat(elapsed),
  };
}

async function main() {
  const llm = buildLLM();
  
  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  Cross-corpus pilot: shortest story first  ║");
  console.log("╚═════════════════════════════════════════════╝");
  console.log("");
  console.log("This script ingests the shortest Memoirs story");
  console.log("for quality review before proceeding with the");
  console.log("full canon ingest.");
  console.log("");
  console.log("─────────────────────────────────────────────");
  console.log("");

  // Ingest shortest story
  const pilot = MEMOIRS_STORIES[0];
  const result = await ingestStory(pilot, llm);

  if (!result) {
    console.error("\n❌ Pilot ingest failed — source file missing");
    console.log("\nNext steps:");
    console.log("1. Download the Memoirs collection from Project Gutenberg (ID 834)");
    console.log("2. Split into individual story files in data/raw/memoirs/");
    console.log("3. Re-run this script");
    process.exit(1);
  }

  console.log("");
  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  🛑 BREAKPOINT: Manual review required      ║");
  console.log("╚═════════════════════════════════════════════╝");
  console.log("");
  console.log("Review the output at:");
  console.log(`  data/processed/${result.slug}/objective-graph.json`);
  console.log("");
  console.log("Quality checks:");
  console.log("  ✓ Forbidden terms validator passed");
  console.log("  □ Spot-check 3 random sections for:");
  console.log("    - Event attribution accuracy");
  console.log("    - No hallucinated events");
  console.log("    - State changes match text");
  console.log("    - source_nodes reference real lexical IDs");
  console.log("  □ Check entity list for:");
  console.log("    - Reasonable entity count (not over-splitting)");
  console.log("    - Proper character/object/location typing");
  console.log("    - No duplicate entities with different IDs");
  console.log("");
  console.log("Extraction stats:");
  console.log(`  Sections:     ${result.sections}`);
  console.log(`  Entities:     ${result.entities}`);
  console.log(`  Events:       ${result.events}`);
  console.log(`  State edges:  ${result.stateEdges}`);
  console.log(`  Time:         ${result.elapsedSeconds}s`);
  console.log(`  Avg per sec:  ${(result.elapsedSeconds / result.sections).toFixed(1)}s`);
  console.log("");
  console.log("If quality is acceptable, proceed with:");
  console.log("  npm run ingest:canon");
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
