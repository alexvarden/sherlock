import * as fs from "fs";
import * as path from "path";
import type { Entity, ObjectiveGraph } from "../lib/types";

// ── Cross-corpus entity reconciliation ────────────────────────────────────
// Merges entities across multiple per-source objective graphs into a
// canonical entity list. Outputs to data/processed/_canon/.
//
// Strategy:
//   1. Exact label match → merge (same id)
//   2. Normalised match (lowercase, stripped honorifics) → merge
//   3. Fuzzy candidates flagged for manual review

interface CanonicalEntity extends Entity {
  alias_for?: string;         // points to the canonical id if this is a merged alias
  sources: string[];          // slugs where this entity appears
}

interface MergeCandidate {
  canonical: string;
  alias: string;
  canonicalLabel: string;
  aliasLabel: string;
  source: string;
  reason: string;
}

// ── Normalisation helpers ─────────────────────────────────────────────────

const HONORIFICS = /^(mr\.?\s*|mrs\.?\s*|ms\.?\s*|dr\.?\s*|sir\s+|lady\s+|lord\s+|professor\s+|inspector\s+|sergeant\s+|captain\s+|colonel\s+|the\s+)/i;

function normaliseLabel(label: string): string {
  return label
    .replace(HONORIFICS, "")
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ── Load all per-source graphs ────────────────────────────────────────────

function loadSourceGraphs(processedDir: string): Map<string, ObjectiveGraph> {
  const graphs = new Map<string, ObjectiveGraph>();
  const entries = fs.readdirSync(processedDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const graphPath = path.join(processedDir, entry.name, "objective-graph.json");
    if (!fs.existsSync(graphPath)) continue;

    const graph = JSON.parse(fs.readFileSync(graphPath, "utf-8")) as ObjectiveGraph;
    graphs.set(entry.name, graph);
  }

  return graphs;
}

// ── Merge pass ────────────────────────────────────────────────────────────

function reconcile(graphs: Map<string, ObjectiveGraph>) {
  // Build a map of normalised label → first canonical entity
  const canonByNorm = new Map<string, CanonicalEntity>();
  const allCanonical: CanonicalEntity[] = [];
  const candidates: MergeCandidate[] = [];

  for (const [slug, graph] of graphs) {
    for (const entity of graph.entities) {
      const norm = normaliseLabel(entity.label);

      const existing = canonByNorm.get(norm);
      if (existing) {
        // Exact normalised match → merge
        if (!existing.sources.includes(slug)) {
          existing.sources.push(slug);
        }
        // Track the alias if ids differ
        if (existing.id !== entity.id) {
          candidates.push({
            canonical: existing.id,
            alias: entity.id,
            canonicalLabel: existing.label,
            aliasLabel: entity.label,
            source: slug,
            reason: "normalised_match",
          });
        }
      } else {
        const canon: CanonicalEntity = { ...entity, sources: [slug] };
        canonByNorm.set(norm, canon);
        allCanonical.push(canon);
      }
    }
  }

  // Second pass: fuzzy matching for near-misses
  // Check if one normalised label is a suffix of another (e.g. "holmes" vs "sherlock holmes")
  const norms = Array.from(canonByNorm.keys());
  for (let i = 0; i < norms.length; i++) {
    for (let j = i + 1; j < norms.length; j++) {
      const a = norms[i];
      const b = norms[j];
      const entA = canonByNorm.get(a)!;
      const entB = canonByNorm.get(b)!;

      // Skip if different types
      if (entA.type !== entB.type) continue;

      // Check suffix match (shorter is suffix of longer)
      const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
      const [shorterEnt, longerEnt] = a.length <= b.length ? [entA, entB] : [entB, entA];

      if (longer.endsWith(shorter) && shorter.length >= 4) {
        candidates.push({
          canonical: longerEnt.id,
          alias: shorterEnt.id,
          canonicalLabel: longerEnt.label,
          aliasLabel: shorterEnt.label,
          source: "(cross-source)",
          reason: "suffix_match",
        });
      }
    }
  }

  return { canonical: allCanonical, candidates };
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const processedDir = path.join(process.cwd(), "data/processed");
  const canonDir = path.join(processedDir, "_canon");

  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  Cross-corpus entity reconciliation         ║");
  console.log("╚═════════════════════════════════════════════╝");
  console.log("");

  const graphs = loadSourceGraphs(processedDir);
  if (graphs.size === 0) {
    console.error("No source graphs found in data/processed/");
    process.exit(1);
  }

  console.log(`Found ${graphs.size} source(s): ${Array.from(graphs.keys()).join(", ")}`);
  console.log("");

  const { canonical, candidates } = reconcile(graphs);

  // Split by type
  const characters = canonical.filter((e) => e.type === "character");
  const organisations = canonical.filter((e) => e.type === "organisation");

  fs.mkdirSync(canonDir, { recursive: true });

  // Write canonical entities
  fs.writeFileSync(
    path.join(canonDir, "entities.json"),
    JSON.stringify(canonical, null, 2)
  );

  // Write organisations separately
  fs.writeFileSync(
    path.join(canonDir, "organisations.json"),
    JSON.stringify(organisations, null, 2)
  );

  // Write merge candidates for manual review
  fs.writeFileSync(
    path.join(canonDir, "merge-candidates.json"),
    JSON.stringify(candidates, null, 2)
  );

  console.log(`Canonical entities:    ${canonical.length}`);
  console.log(`  Characters:          ${characters.length}`);
  console.log(`  Organisations:       ${organisations.length}`);
  console.log(`  Other:               ${canonical.length - characters.length - organisations.length}`);
  console.log(`Merge candidates:      ${candidates.length} (review in _canon/merge-candidates.json)`);
  console.log("");
  console.log(`✅ Written to data/processed/_canon/`);
  console.log(`   entities.json · organisations.json · merge-candidates.json`);

  if (candidates.length > 0) {
    console.log("");
    console.log("⚠  Review merge candidates before proceeding:");
    for (const c of candidates.slice(0, 20)) {
      console.log(`   ${c.canonicalLabel} ← ${c.aliasLabel} (${c.reason}, ${c.source})`);
    }
    if (candidates.length > 20) {
      console.log(`   ... and ${candidates.length - 20} more`);
    }
  }
}

main();
