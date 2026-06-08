import * as fs from "fs";
import * as path from "path";
import type { Entity, ObjectiveGraph, Mention, Clue } from "../lib/types";

// ── Canon aggregation: cross-references, cases, documents ─────────────────
// Walks all per-source objective graphs and produces:
//   _canon/cross-references.json  — entity_id → [(source, section, mention_count)]
//   _canon/cases.json             — one entry per case with its clues joined in
//   _canon/documents.json         — all documents across the canon

interface CrossReference {
  entity_id: string;
  label: string;
  refs: Array<{ source: string; section: string; mention_count: number; sentence_ids: string[] }>;
}

interface CaseAggregate {
  id: string;
  label: string;
  source: string;
  client?: string;
  crime_type?: string;
  outcome?: string;
  primary_location?: string;
  clues: Clue[];
}

interface DocumentAggregate {
  id: string;
  label: string;
  source: string;
  document_type?: string;
  from?: string;
  to?: string;
  content_summary?: string;
  first_section: string;
}

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

function main() {
  const processedDir = path.join(process.cwd(), "data/processed");
  const canonDir = path.join(processedDir, "_canon");

  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  Canon aggregation                          ║");
  console.log("╚═════════════════════════════════════════════╝");
  console.log("");

  const graphs = loadSourceGraphs(processedDir);
  if (graphs.size === 0) {
    console.error("No source graphs found in data/processed/");
    process.exit(1);
  }

  console.log(`Found ${graphs.size} source(s): ${Array.from(graphs.keys()).join(", ")}`);
  console.log("");

  // ── Cross-references ──────────────────────────────────────────────────
  const crossRefMap = new Map<string, CrossReference>();

  for (const [slug, graph] of graphs) {
    // Collect entity labels for lookup
    const entityLabels = new Map<string, string>();
    for (const e of graph.entities) entityLabels.set(e.id, e.label);

    for (const mention of graph.mentions) {
      let cr = crossRefMap.get(mention.entity);
      if (!cr) {
        cr = {
          entity_id: mention.entity,
          label: entityLabels.get(mention.entity) ?? mention.entity,
          refs: [],
        };
        crossRefMap.set(mention.entity, cr);
      }
      cr.refs.push({
        source: slug,
        section: mention.section,
        mention_count: mention.mention_count,
        sentence_ids: mention.sentence_ids,
      });
    }
  }

  const crossReferences = Array.from(crossRefMap.values())
    .sort((a, b) => b.refs.length - a.refs.length);

  // ── Cases ─────────────────────────────────────────────────────────────
  const cases: CaseAggregate[] = [];

  for (const [slug, graph] of graphs) {
    const caseEntities = graph.entities.filter((e) => e.type === "case");
    for (const c of caseEntities) {
      const caseClues = graph.clues.filter((cl) => cl.case === c.id);
      cases.push({
        id: c.id,
        label: c.label,
        source: slug,
        client: c.client,
        crime_type: c.crime_type,
        outcome: c.outcome,
        primary_location: c.primary_location,
        clues: caseClues,
      });
    }
  }

  // ── Documents ─────────────────────────────────────────────────────────
  const documents: DocumentAggregate[] = [];

  for (const [slug, graph] of graphs) {
    const docEntities = graph.entities.filter((e) => e.type === "document");
    for (const d of docEntities) {
      documents.push({
        id: d.id,
        label: d.label,
        source: slug,
        document_type: d.document_type,
        from: d.from,
        to: d.to,
        content_summary: d.content_summary,
        first_section: d.firstSection,
      });
    }
  }

  // ── Write outputs ─────────────────────────────────────────────────────
  fs.mkdirSync(canonDir, { recursive: true });

  fs.writeFileSync(
    path.join(canonDir, "cross-references.json"),
    JSON.stringify(crossReferences, null, 2)
  );
  fs.writeFileSync(
    path.join(canonDir, "cases.json"),
    JSON.stringify(cases, null, 2)
  );
  fs.writeFileSync(
    path.join(canonDir, "documents.json"),
    JSON.stringify(documents, null, 2)
  );

  console.log(`Cross-references:  ${crossReferences.length} entities tracked`);
  console.log(`Cases:             ${cases.length}`);
  console.log(`Documents:         ${documents.length}`);
  console.log("");
  console.log(`✅ Written to data/processed/_canon/`);
  console.log(`   cross-references.json · cases.json · documents.json`);
}

main();
