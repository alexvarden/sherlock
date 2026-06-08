import * as fs from "fs";
import * as path from "path";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { buildLexicalGraph, type LexicalGranularity, type SectionGranularity } from "../lib/lexical";
import { buildObjectiveGraph, validateObjectiveGraph } from "../lib/objective-extract";

// ── LLM selection ──────────────────────────────────────────────────────────
function buildLLM(): BaseChatModel {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: "claude-sonnet-4-6",
      temperature: 0,
      maxTokens: 4096,
    }) as unknown as BaseChatModel;
  }
  if (process.env.OPENAI_API_KEY) {
    return new ChatOpenAI({
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      configuration: {
        ...(process.env.OPENAI_ORGANISATION ? { organization: process.env.OPENAI_ORGANISATION } : {}),
        ...(process.env.OPENAI_PROJECT_ID ? { defaultHeaders: { "OpenAI-Project": process.env.OPENAI_PROJECT_ID } } : {}),
      },
    }) as unknown as BaseChatModel;
  }
  throw new Error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
}

// ── Slug helpers ──────────────────────────────────────────────────────────
function slugFromFile(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/, "").replace(/[_\s]+/g, "-").toLowerCase();
}

function resolveStoryFile(arg: string): string {
  if (arg.includes("/") || arg.includes(".")) return arg;
  const metaPath = path.join(process.cwd(), "data/processed", arg, "meta.json");
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { sourceFile: string };
    return meta.sourceFile;
  }
  const rawDir = path.join(process.cwd(), "data/raw");
  const match = fs.readdirSync(rawDir).find(
    (f) => f.replace(/\.[^.]+$/, "").replace(/[_\s]+/g, "-").toLowerCase() === arg.toLowerCase()
  );
  if (match) return path.join("data/raw", match);
  throw new Error(`Unknown story "${arg}". Pass a file path or a slug from data/processed/.`);
}

// ── Env helper: checks uppercase key then lowercase fallback ──────────────
function env(key: string, fallback: string): string {
  return process.env[key] ?? process.env[key.toLowerCase()] ?? fallback;
}

// ── Main pipeline ─────────────────────────────────────────────────────────
async function main() {
  const arg = process.argv[2];
  const storyFile = env("STORY_FILE", arg ? resolveStoryFile(arg) : "data/raw/Anne_sally-simple.md");
  const rawPath = path.join(process.cwd(), storyFile);
  const text = fs.readFileSync(rawPath, "utf-8");

  const argIsSlug = arg && !arg.includes("/") && !arg.includes(".");
  const slug = env("STORY_SLUG", argIsSlug ? arg! : slugFromFile(storyFile));
  const storyName = env("STORY_NAME", slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

  const sectionGranularity = env("SECTION_GRANULARITY", "chunk") as SectionGranularity;
  const lexicalGranularity = env("LEXICAL_GRANULARITY", "sentence") as LexicalGranularity;
  const chunkWords = parseInt(env("SEGMENT_WORDS", "150"));
  const splitOnly = env("SPLIT_ONLY", "false") === "true" || process.argv.includes("--split-only");

  const maxSectionsArg = process.argv.find((a) => a.startsWith("--max-sections="));
  const maxSectionsRaw = maxSectionsArg?.split("=")[1] ?? env("MAX_SECTIONS", "");
  const maxSections = maxSectionsRaw ? parseInt(maxSectionsRaw, 10) : undefined;
  if (maxSections !== undefined && (!Number.isFinite(maxSections) || maxSections < 1)) {
    throw new Error(`--max-sections must be a positive integer, got "${maxSectionsRaw}"`);
  }

  const llmLabel = process.env.ANTHROPIC_API_KEY
    ? `claude-sonnet-4-6 (Anthropic)`
    : `${env("OPENAI_MODEL", "gpt-4o")} (OpenAI)`;

  console.log("┌─────────────────────────────────────────────┐");
  console.log(`│  Sherlock ingest                            │`);
  console.log("└─────────────────────────────────────────────┘");
  console.log(`  story        ${storyName} (${slug})`);
  console.log(`  source       ${storyFile}`);
  console.log(`  sections     ${sectionGranularity}  chunks=${chunkWords}w`);
  console.log(`  lexical      ${lexicalGranularity}`);
  if (maxSections) console.log(`  max-sections ${maxSections}`);
  if (!splitOnly)  console.log(`  model        ${llmLabel}`);
  console.log("");

  // ── Stage A: Lexical graph ──────────────────────────────────────────────
  console.log("[1/2] Building lexical graph...");
  const fullLexical = buildLexicalGraph(text, { sectionGranularity, lexicalGranularity, chunkWords });
  const lexical = maxSections !== undefined
    ? (() => {
        const keptSections = fullLexical.sections.slice(0, maxSections);
        const keptIds = new Set(keptSections.map((s) => s.id));
        console.log(`   ✂ Truncating to first ${keptSections.length} of ${fullLexical.sections.length} sections (--max-sections)`);
        return {
          ...fullLexical,
          sections: keptSections,
          nodes: fullLexical.nodes.filter((n) => keptIds.has(n.section)),
        };
      })()
    : fullLexical;
  console.log(`   → ${lexical.sections.length} sections, ${lexical.nodes.length} lexical nodes`);

  const processedDir = path.join(process.cwd(), "data/processed", slug);
  fs.mkdirSync(processedDir, { recursive: true });

  fs.writeFileSync(
    path.join(processedDir, "meta.json"),
    JSON.stringify({ slug, name: storyName, sourceFile: storyFile }, null, 2)
  );
  fs.writeFileSync(path.join(processedDir, "lexical.json"), JSON.stringify(lexical, null, 2));

  if (splitOnly) {
    console.log(`\n✅ Lexical graph written → data/processed/${slug}/`);
    return;
  }

  // ── Stage B: Objective graph ────────────────────────────────────────────
  const checkpointPath = path.join(processedDir, "objective-graph.wip.json");
  const resuming = fs.existsSync(checkpointPath);
  console.log(`\n[2/2] Extracting objective graph via LLM...${resuming ? " (resuming from checkpoint)" : ""}`);
  const llm = buildLLM();
  const t0 = Date.now();

  const objective = await buildObjectiveGraph(llm, lexical, {
    checkpointPath,
    onProgress: (p) => {
      const pct  = String(Math.round((p.index / p.total) * 100)).padStart(3);
      const idx  = String(p.index).padStart(String(p.total).length);
      const sec  = (p.elapsedMs / 1000).toFixed(1).padStart(5);
      const newE = p.newEntities > 0 ? `+${p.newEntities}e` : "   ";
      console.log(
        `  [${idx}/${p.total}] ${pct}%  ${p.sectionId.padEnd(12)}` +
        `  ${String(p.nodeCount).padStart(2)} nodes` +
        `  ${newE.padEnd(4)}  ${p.sectionEvents}ev  ${p.sectionStates}st` +
        `  (${sec}s)` +
        `  Σ ${p.totalEntities}e ${p.totalEvents}ev ${p.totalStates}st`
      );
    },
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const errors = validateObjectiveGraph(objective);
  if (errors.length > 0) {
    console.error("\n⚠  Validation errors:");
    for (const e of errors) console.error(`   - ${e}`);
    console.error("   Continuing anyway.");
  }

  fs.writeFileSync(path.join(processedDir, "objective-graph.json"), JSON.stringify(objective, null, 2));
  if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);

  console.log(`\n✅ Done in ${elapsed}s → data/processed/${slug}/`);
  console.log(`   ${objective.entities.length} entities · ${objective.events.length} events · ${objective.stateEdges.length} state edges`);
  console.log(`   meta.json · lexical.json · objective-graph.json`);
  console.log(`   (character states derived at runtime)`);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
