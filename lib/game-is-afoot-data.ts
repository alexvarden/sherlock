// ── Data feeders for the-game-is-afoot visual aids (server-side) ───────

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Entity, LexicalGraph, Mention, ObjectiveEvent, ObjectiveGraph } from "./types";

// Resolve data relative to this module (not process.cwd()), so the loaders
// work whether run from the standalone repo or as the @crane/sherlock package.
const DATA_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "processed");

// ── Cypher query demos ──────────────────────────────────────────────────
// Realistic Cypher syntax against the graph schema, with results computed
// in-memory from the JSON layer (the same data Neo4j holds after migration).

export interface CypherDemo {
  id: string;
  label: string;
  intent: string;          // one-line plain-English explanation
  query: string;           // Cypher syntax
  columns: string[];
  rows: (string | number)[][];
  rowCount: number;        // may exceed displayed rows
}

const CANON_SLUGS_FOR_CYPHER = [
  "a-study-in-scarlet", "sign-of-the-four", "silver-blaze", "yellow-face",
  "stockbrokers-clerk", "gloria-scott", "musgrave-ritual", "reigate-squires",
  "crooked-man", "resident-patient", "greek-interpreter", "naval-treaty",
  "final-problem", "cardboard-box", "hound-of-the-baskervilles",
  "valley-of-fear", "a-case-of-identity",
];

function loadAllWorks() {
  return CANON_SLUGS_FOR_CYPHER
    .map((slug) => {
      const dir = path.join(DATA_ROOT, slug);
      const lex = readJson<LexicalGraph>(path.join(dir, "lexical.json"));
      const obj = readJson<ObjectiveGraph>(path.join(dir, "objective-graph.json"));
      const meta = readJson<{ slug: string; name: string }>(path.join(dir, "meta.json"));
      if (!lex || !obj || !meta) return null;
      return { slug, lex, obj, meta };
    })
    .filter((w): w is NonNullable<typeof w> => Boolean(w));
}

export function loadCypherDemos(): CypherDemo[] {
  const works = loadAllWorks();

  // ── Q1: every sentence that mentions Watson ──────────────────────────
  const watsonHits: (string | number)[][] = [];
  let watsonCount = 0;
  for (const w of works) {
    const sentMap = new Map(w.lex.nodes.map((n) => [n.id, n]));
    const watsonMentions = w.obj.mentions.filter((m) => {
      const e = w.obj.entities.find((x) => x.id === m.entity);
      return e && /^watson$|^dr_watson$|^doctor_watson$|^john_watson$/i.test(e.id);
    });
    for (const m of watsonMentions) {
      for (const sid of m.sentence_ids) {
        const s = sentMap.get(sid);
        if (!s) continue;
        watsonCount++;
        if (watsonHits.length < 5) {
          watsonHits.push([w.meta.name, sid, s.text.length > 90 ? s.text.slice(0, 87) + "…" : s.text]);
        }
      }
    }
  }

  // ── Q2: Holmes appearances grouped by work ───────────────────────────
  const holmesByWork: (string | number)[][] = [];
  for (const w of works) {
    const holmesMentions = w.obj.mentions.filter((m) => {
      const e = w.obj.entities.find((x) => x.id === m.entity);
      return e && /^sherlock_holmes$|^holmes$|^mr_sherlock_holmes$/i.test(e.id);
    });
    const sentenceCount = holmesMentions.reduce((s, m) => s + m.sentence_ids.length, 0);
    if (sentenceCount > 0) {
      holmesByWork.push([w.meta.name, sentenceCount]);
    }
  }
  holmesByWork.sort((a, b) => (b[1] as number) - (a[1] as number));

  // ── Q3: sections where Holmes and Lestrade co-occur ──────────────────
  const coOccur: (string | number)[][] = [];
  for (const w of works) {
    const sections = new Map<string, Set<string>>();
    for (const m of w.obj.mentions) {
      const e = w.obj.entities.find((x) => x.id === m.entity);
      if (!e) continue;
      if (!/^sherlock_holmes$|^holmes$|^mr_sherlock_holmes$|^lestrade$|^mr_lestrade$|^inspector_lestrade$/i.test(e.id)) continue;
      if (!sections.has(m.section)) sections.set(m.section, new Set());
      sections.get(m.section)!.add(e.id);
    }
    let count = 0;
    for (const ids of sections.values()) {
      const hasH = Array.from(ids).some((i) => /holmes/i.test(i));
      const hasL = Array.from(ids).some((i) => /lestrade/i.test(i));
      if (hasH && hasL) count++;
    }
    if (count > 0) coOccur.push([w.meta.name, count]);
  }
  coOccur.sort((a, b) => (b[1] as number) - (a[1] as number));

  // ── Q4: extracted from section_1 of The Final Problem ────────────────
  const fp = works.find((w) => w.slug === "final-problem");
  const fpSection1Rows: (string | number)[][] = [];
  let fpSection1Count = 0;
  if (fp) {
    const sectionId = "final-problem-section_1";
    const entitiesInSection = new Set<string>();
    for (const m of fp.obj.mentions) {
      if (m.section === sectionId) entitiesInSection.add(m.entity);
    }
    for (const eid of entitiesInSection) {
      const e = fp.obj.entities.find((x) => x.id === eid);
      if (!e) continue;
      fpSection1Count++;
      if (fpSection1Rows.length < 8) {
        fpSection1Rows.push([e.id, e.type, e.label]);
      }
    }
  }

  return [
    {
      id: "watson-sentences",
      label: "Every sentence Watson is named in",
      intent: "Walk from one entity back to every sentence that cites it.",
      query: `MATCH (e:Entity {id: "watson"})-[:MENTIONED_IN]->(s:Sentence)
RETURN s.work, s.id, s.text
ORDER BY s.work, s.position`,
      columns: ["work", "sentence_id", "text"],
      rows: watsonHits,
      rowCount: watsonCount,
    },
    {
      id: "holmes-by-work",
      label: "Holmes appearances by work",
      intent: "Count Holmes mentions, grouped by the book they appear in.",
      query: `MATCH (e:Entity {id: "sherlock_holmes"})-[:MENTIONED_IN]->(s:Sentence)
RETURN s.work AS work, count(s) AS mentions
ORDER BY mentions DESC`,
      columns: ["work", "mentions"],
      rows: holmesByWork,
      rowCount: holmesByWork.length,
    },
    {
      id: "holmes-lestrade",
      label: "Sections where Holmes and Lestrade share a scene",
      intent: "Find every section in which both characters are mentioned.",
      query: `MATCH (h:Entity {id: "sherlock_holmes"})-[:MENTIONED_IN]->(s:Sentence),
      (l:Entity {id: "lestrade"})-[:MENTIONED_IN]->(s2:Sentence)
WHERE s.section = s2.section
RETURN s.work AS work, count(DISTINCT s.section) AS shared_sections
ORDER BY shared_sections DESC`,
      columns: ["work", "shared_sections"],
      rows: coOccur,
      rowCount: coOccur.length,
    },
    {
      id: "section-extraction",
      label: "Everything extracted from one section",
      intent: "List every entity tied to the opening section of The Final Problem.",
      query: `MATCH (e:Entity)-[:MENTIONED_IN]->(s:Sentence {section: "final-problem-section_1"})
RETURN DISTINCT e.id, e.type, e.label
ORDER BY e.type, e.label`,
      columns: ["entity_id", "type", "label"],
      rows: fpSection1Rows,
      rowCount: fpSection1Count,
    },
  ];
}

// ── Sample passage: opening of The Final Problem (sentences 3–14) ───────
// Watson's framing paragraphs. Rich entities, clean events, well-known prose.

const PASSAGE_SLUG = "final-problem";
const PASSAGE_SENTENCE_RANGE: [number, number] = [3, 14]; // inclusive, 1-based

export interface PassageSentence {
  id: string;
  position: number;
  text: string;
  entityIds: string[];   // entities mentioned in this sentence
}

export interface PassageEntity {
  id: string;
  type: string;
  label: string;
}

export interface PassageEvent {
  id: string;
  label: string;
  participantIds: string[];
  sourceIds: string[];   // sentence ids
}

export interface PassageData {
  workName: string;
  sectionLabel: string;
  sentences: PassageSentence[];
  entities: PassageEntity[];
  events: PassageEvent[];
}

function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

export function loadSamplePassage(): PassageData | null {
  const dir = path.join(DATA_ROOT, PASSAGE_SLUG);
  const lex = readJson<LexicalGraph>(path.join(dir, "lexical.json"));
  const obj = readJson<ObjectiveGraph>(path.join(dir, "objective-graph.json"));
  if (!lex || !obj) return null;

  const [from, to] = PASSAGE_SENTENCE_RANGE;
  const nodes = lex.nodes.filter((n) => {
    const idx = parseInt(n.id.replace("sentence_", ""), 10);
    return idx >= from && idx <= to;
  });
  if (nodes.length === 0) return null;

  const passageSentenceIds = new Set(nodes.map((n) => n.id));

  // Find mentions whose sentence_ids intersect the passage range
  const sentenceToEntities = new Map<string, Set<string>>();
  const usedEntityIds = new Set<string>();
  for (const m of obj.mentions) {
    for (const sid of m.sentence_ids) {
      if (!passageSentenceIds.has(sid)) continue;
      if (!sentenceToEntities.has(sid)) sentenceToEntities.set(sid, new Set());
      sentenceToEntities.get(sid)!.add(m.entity);
      usedEntityIds.add(m.entity);
    }
  }

  // Events that cite at least one sentence in the passage
  const events: PassageEvent[] = obj.events
    .filter((e) => e.source_nodes.some((s) => passageSentenceIds.has(s)))
    .map((e: ObjectiveEvent) => ({
      id: e.id,
      label: e.label,
      participantIds: e.participants.filter((p) => usedEntityIds.has(p) || true),
      sourceIds: e.source_nodes.filter((s) => passageSentenceIds.has(s)),
    }));

  // Pull participant ids into usedEntityIds
  for (const ev of events) for (const p of ev.participantIds) usedEntityIds.add(p);

  const entitiesMap = new Map<string, Entity>(obj.entities.map((e) => [e.id, e]));
  const entities: PassageEntity[] = Array.from(usedEntityIds)
    .map((id) => entitiesMap.get(id))
    .filter((e): e is Entity => Boolean(e))
    .map((e) => ({ id: e.id, type: e.type, label: e.label }));

  const sentences: PassageSentence[] = nodes.map((n) => ({
    id: n.id,
    position: n.position,
    text: n.text,
    entityIds: Array.from(sentenceToEntities.get(n.id) ?? []),
  }));

  // Build a friendly section label
  const sectionMeta = lex.sections.find((s) => s.id === nodes[0].section);
  const sectionLabel = sectionMeta?.title ?? nodes[0].section;

  return {
    workName: "The Final Problem",
    sectionLabel,
    sentences,
    entities,
    events,
  };
}

// ── Full work data for the embedded KnowledgeGraphViewer ────────────────
// The article embeds the real /graph viewer scoped to The Final Problem.
// Same committed JSON the passage loaders use — no Neo4j needed.

export interface GraphViewerData {
  slug: string;
  lexical: LexicalGraph;
  objective: ObjectiveGraph;
}

export function loadGraphViewerData(): GraphViewerData | null {
  const dir = path.join(DATA_ROOT, PASSAGE_SLUG);
  const lexical = readJson<LexicalGraph>(path.join(dir, "lexical.json"));
  const objective = readJson<ObjectiveGraph>(path.join(dir, "objective-graph.json"));
  if (!lexical || !objective) return null;
  return { slug: PASSAGE_SLUG, lexical, objective };
}

// ── Sample clue: Mortimer's walking stick, opening of Hound ─────────────
// The first clue extracted from the canon's most famous opening scene:
// Holmes reading the visitor's stick. Resolves the cited sentences to text.

export interface SampleClue {
  objectLabel: string;
  caseLabel: string;
  discoveredByLabel: string;
  significance: string;
  sentences: { id: string; text: string }[];
}

export function loadSampleClue(): SampleClue | null {
  const dir = path.join(DATA_ROOT, "hound-of-the-baskervilles");
  const lex = readJson<LexicalGraph>(path.join(dir, "lexical.json"));
  const obj = readJson<ObjectiveGraph>(path.join(dir, "objective-graph.json"));
  if (!lex || !obj || obj.clues.length === 0) return null;

  const clue = obj.clues[0];
  const entityLabel = (id: string) =>
    obj.entities.find((e) => e.id === id)?.label ?? id;
  const nodeText = new Map(lex.nodes.map((n) => [n.id, n.text]));

  return {
    objectLabel: entityLabel(clue.object),
    caseLabel: entityLabel(clue.case),
    discoveredByLabel: entityLabel(clue.discovered_by),
    significance: clue.significance,
    sentences: clue.source_nodes
      .filter((id) => nodeText.has(id))
      .map((id) => ({ id, text: nodeText.get(id)! })),
  };
}

// ── Reconciliation: real entity-variant clusters from the canon ─────────
// We gather every raw entity across all works, then group by our canonical
// alias map (mirrors lib/canon-aggregate.ts) to show before/after clusters.

const CANON_SLUGS = [
  "a-study-in-scarlet", "sign-of-the-four", "silver-blaze", "yellow-face",
  "stockbrokers-clerk", "gloria-scott", "musgrave-ritual", "reigate-squires",
  "crooked-man", "resident-patient", "greek-interpreter", "naval-treaty",
  "final-problem", "cardboard-box", "hound-of-the-baskervilles",
  "valley-of-fear", "a-case-of-identity",
];

export interface VariantEntry {
  workSlug: string;
  rawId: string;
  label: string;
  type: string;
  mentionCount: number;
}

export interface ReconciliationCluster {
  canonicalKey: string;
  canonicalLabel: string;
  canonicalType: string;
  variants: VariantEntry[];
}

export interface ReconciliationData {
  // Clean dedupe — character variants that fold to one
  mergeExample: ReconciliationCluster;
  // Type-aware separation — the Hudson case
  collisionExample: ReconciliationCluster[];
}

function rawKey(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function loadReconciliationData(): ReconciliationData {
  const variantsByName: Map<string, VariantEntry[]> = new Map();

  for (const slug of CANON_SLUGS) {
    const dir = path.join(DATA_ROOT, slug);
    const obj = readJson<ObjectiveGraph>(path.join(dir, "objective-graph.json"));
    if (!obj) continue;

    const mentionCount = new Map<string, number>();
    for (const m of obj.mentions) {
      mentionCount.set(m.entity, (mentionCount.get(m.entity) ?? 0) + m.mention_count);
    }

    for (const e of obj.entities) {
      const k = rawKey(e.id);
      // Group by raw id stem — this lets us detect cross-work duplicates with different ids
      if (!variantsByName.has(k)) variantsByName.set(k, []);
      variantsByName.get(k)!.push({
        workSlug: slug,
        rawId: e.id,
        label: e.label,
        type: e.type,
        mentionCount: mentionCount.get(e.id) ?? 0,
      });
    }
  }

  // ── Merge example: collect all Holmes-variant entries ────────────────
  const holmesKeys = ["sherlock_holmes", "holmes", "mr_sherlock_holmes"];
  const holmesVariants: VariantEntry[] = [];
  for (const k of holmesKeys) {
    if (variantsByName.has(k)) holmesVariants.push(...variantsByName.get(k)!);
  }

  // Sort variants by mention count desc, then by work alphabetical
  holmesVariants.sort((a, b) => b.mentionCount - a.mentionCount);

  const mergeExample: ReconciliationCluster = {
    canonicalKey: "sherlock_holmes",
    canonicalLabel: "Sherlock Holmes",
    canonicalType: "character",
    variants: holmesVariants,
  };

  // ── Collision example: the three Hudsons ──────────────────────────────
  const hudsonRaw: VariantEntry[] = [];
  for (const [, list] of variantsByName.entries()) {
    for (const v of list) {
      if (/hudson/i.test(v.label)) hudsonRaw.push(v);
    }
  }
  // Bucket by (type + label-stem) — Mrs Hudson is character; Hudson Street is location; Hudson (seaman) is character but different label
  const buckets = new Map<string, ReconciliationCluster>();
  for (const v of hudsonRaw) {
    // Bucketing rule: type + first canonicalisation of label
    const labelStem = v.label.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
    let bucketKey: string;
    let canonLabel: string;
    if (v.type === "location") {
      bucketKey = `loc:${labelStem}`;
      canonLabel = v.label;
    } else if (labelStem.startsWith("mrs")) {
      bucketKey = "char:mrs_hudson";
      canonLabel = "Mrs. Hudson";
    } else {
      // Probably Hudson the seaman or Hudson Street (mis-typed)
      bucketKey = `char:${labelStem}`;
      canonLabel = v.label;
    }
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        canonicalKey: bucketKey,
        canonicalLabel: canonLabel,
        canonicalType: v.type,
        variants: [],
      });
    }
    buckets.get(bucketKey)!.variants.push(v);
  }

  const collisionExample = Array.from(buckets.values()).sort((a, b) => b.variants.length - a.variants.length);

  return { mergeExample, collisionExample };
}
