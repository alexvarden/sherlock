// ── Canon-wide aggregations for the /analysis page widgets ───────────────
// Server-only: imports fs. Types and constants live in ./canon-types.

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  LexicalGraph,
  ObjectiveGraph,
  StoryMeta,
  Entity,
} from "./types";

// Resolve data relative to this module (not process.cwd()), so the loaders
// work whether run from the standalone repo or as the @crane/sherlock package.
const DATA_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "processed");
import {
  CANON_SLUGS,
  type CanonData,
  type CoOccurrenceEdge,
  type EntitySummary,
  type FrequencyByType,
  type PresenceForEntity,
  type SearchSentence,
  type TrajectorySegment,
  type TrajectoryWork,
  type WorkSummary,
} from "./canon-types";

export { CANON_SLUGS, IN_UNIVERSE_ORDER } from "./canon-types";
export type {
  CanonData,
  CoOccurrenceEdge,
  EntitySummary,
  FrequencyByType,
  FrequencyNode,
  PresenceForEntity,
  PresenceMark,
  SearchSentence,
  TrajectorySegment,
  TrajectoryWork,
  WorkSummary,
} from "./canon-types";

// ── Entity canonicalisation across works ─────────────────────────────────
// Quick-and-dirty cross-work dedupe. The proper fix lives in
// scripts/reconcile-entities.ts; this is enough for the demo widgets.
const CANON_ALIASES: Record<string, string> = {
  // Holmes
  "sherlock_holmes": "sherlock_holmes",
  "holmes": "sherlock_holmes",
  "mr_sherlock_holmes": "sherlock_holmes",
  // Watson
  "watson": "watson",
  "dr_watson": "watson",
  "doctor_watson": "watson",
  "john_watson": "watson",
  // Lestrade
  "lestrade": "lestrade",
  "mr_lestrade": "lestrade",
  "inspector_lestrade": "lestrade",
  // Mycroft
  "mycroft_holmes": "mycroft_holmes",
  "mycroft": "mycroft_holmes",
  // Moriarty (Professor, not Colonel)
  "professor_moriarty": "professor_moriarty",
  "moriarty": "professor_moriarty",
  // Mrs Hudson — only the housekeeper, not Hudson the seaman / Hudson Street
};

// Preferred display label for canonicalised characters (overrides "longest wins")
const PREFERRED_LABELS: Record<string, string> = {
  "sherlock_holmes": "Sherlock Holmes",
  "watson": "Watson",
  "lestrade": "Lestrade",
  "mycroft_holmes": "Mycroft Holmes",
  "professor_moriarty": "Professor Moriarty",
};

function canonicalKey(rawId: string, type: string): string {
  const key = rawId.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  // Don't merge location/object Hudson into character Hudson
  if (type !== "character") return `${type}:${key}`;
  return CANON_ALIASES[key] ?? key;
}

function prettyLabel(rawLabel: string): string {
  return rawLabel
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/^Dr\.?$/, "Dr.");
}

// ── Loaders ──────────────────────────────────────────────────────────────

function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

interface LoadedWork {
  meta: StoryMeta;
  lexical: LexicalGraph;
  graph: ObjectiveGraph;
}

function loadWork(slug: string): LoadedWork | null {
  const dir = path.join(DATA_ROOT, slug);
  const meta = readJson<StoryMeta>(path.join(dir, "meta.json"));
  const lexical = readJson<LexicalGraph>(path.join(dir, "lexical.json"));
  const graph = readJson<ObjectiveGraph>(path.join(dir, "objective-graph.json"));
  if (!meta || !lexical || !graph) return null;
  return { meta, lexical, graph };
}

// Build a quick lookup: workSlug + sentence_id → text
function buildSentenceIndex(works: LoadedWork[]) {
  const idx = new Map<string, { text: string; position: number; total: number }>();
  for (const w of works) {
    const total = w.lexical.nodes.length;
    for (const n of w.lexical.nodes) {
      idx.set(`${w.meta.slug}:${n.id}`, { text: n.text, position: n.position, total });
    }
  }
  return idx;
}

// ── Main aggregator ──────────────────────────────────────────────────────

export function loadCanonData(): CanonData {
  const works = CANON_SLUGS.map(loadWork).filter((w): w is LoadedWork => w !== null);

  const workSummaries: WorkSummary[] = works.map((w) => {
    const wordCount = w.lexical.sections.reduce((s, sec) => s + (sec.wordCount ?? 0), 0);
    const mentionCount = w.graph.mentions.reduce((s, m) => s + m.mention_count, 0);
    return {
      slug: w.meta.slug,
      name: w.meta.name,
      sentenceCount: w.lexical.nodes.length,
      sectionCount: w.lexical.sections.length,
      wordCount,
      entityCount: w.graph.entities.length,
      mentionCount,
      eventCount: w.graph.events.length,
    };
  });

  const sentenceIdx = buildSentenceIndex(works);

  // ── Canonicalise entities ────────────────────────────────────────────
  // For each work's entity, derive canonical key, accumulate.
  const entityAgg = new Map<string, {
    key: string;
    label: string;
    type: string;
    totalMentions: number;
    works: Set<string>;
    rawIdByWork: Map<string, string[]>; // work → list of raw ids that map here
  }>();

  for (const w of works) {
    for (const e of w.graph.entities) {
      const key = canonicalKey(e.id, e.type);
      const existing = entityAgg.get(key);
      if (existing) {
        // Keep the prettier label (longer & has capitals, usually wins)
        if (e.label.length > existing.label.length) existing.label = prettyLabel(e.label);
        if (!existing.rawIdByWork.has(w.meta.slug)) existing.rawIdByWork.set(w.meta.slug, []);
        existing.rawIdByWork.get(w.meta.slug)!.push(e.id);
      } else {
        const m = new Map<string, string[]>();
        m.set(w.meta.slug, [e.id]);
        entityAgg.set(key, {
          key,
          label: prettyLabel(e.label),
          type: e.type,
          totalMentions: 0,
          works: new Set(),
          rawIdByWork: m,
        });
      }
    }
    // Count mentions
    for (const m of w.graph.mentions) {
      const ent = w.graph.entities.find((x) => x.id === m.entity);
      if (!ent) continue;
      const key = canonicalKey(ent.id, ent.type);
      const agg = entityAgg.get(key);
      if (!agg) continue;
      agg.totalMentions += m.mention_count;
      agg.works.add(w.meta.slug);
    }
  }

  const entities: EntitySummary[] = Array.from(entityAgg.values())
    .map((a) => ({
      key: a.key,
      label: PREFERRED_LABELS[a.key] ?? a.label,
      type: a.type,
      totalMentions: a.totalMentions,
      works: Array.from(a.works),
    }))
    .sort((a, b) => b.totalMentions - a.totalMentions);

  // ── Presence per entity per work ─────────────────────────────────────
  const presence: Record<string, PresenceForEntity> = {};

  for (const w of works) {
    const totalSentences = w.lexical.nodes.length;
    for (const m of w.graph.mentions) {
      const ent = w.graph.entities.find((x) => x.id === m.entity);
      if (!ent) continue;
      const key = canonicalKey(ent.id, ent.type);
      if (!presence[key]) presence[key] = { byWork: {} };
      if (!presence[key].byWork[w.meta.slug]) presence[key].byWork[w.meta.slug] = [];
      for (const sid of m.sentence_ids) {
        const info = sentenceIdx.get(`${w.meta.slug}:${sid}`);
        if (!info) continue;
        presence[key].byWork[w.meta.slug].push({
          position: totalSentences > 1 ? info.position / (totalSentences - 1) : 0,
          sentenceText: info.text,
          rawIndex: info.position,
        });
      }
    }
  }
  // Sort marks by position
  for (const key of Object.keys(presence)) {
    for (const slug of Object.keys(presence[key].byWork)) {
      presence[key].byWork[slug].sort((a, b) => a.position - b.position);
    }
  }

  // ── Sentences for lexical search ─────────────────────────────────────
  const sentences: SearchSentence[] = [];
  for (const w of works) {
    const total = w.lexical.nodes.length;
    for (const n of w.lexical.nodes) {
      if (n.text.length < 4) continue; // skip "XII." style fragments
      sentences.push({
        workSlug: w.meta.slug,
        workName: w.meta.name,
        position: total > 1 ? n.position / (total - 1) : 0,
        rawIndex: n.position,
        text: n.text,
      });
    }
  }

  // ── Co-occurrence (top 40 entities by mentions) ──────────────────────
  // Edge weight = number of sections (across all works) where both appear.
  const topKeys = new Set(entities.filter((e) => e.type === "character").slice(0, 40).map((e) => e.key));

  // Build per-section entity sets (canonical), per work
  const sectionEntities: Array<Set<string>> = [];
  for (const w of works) {
    const bySection = new Map<string, Set<string>>();
    for (const m of w.graph.mentions) {
      const ent = w.graph.entities.find((x) => x.id === m.entity);
      if (!ent) continue;
      const key = canonicalKey(ent.id, ent.type);
      if (!topKeys.has(key)) continue;
      if (!bySection.has(m.section)) bySection.set(m.section, new Set());
      bySection.get(m.section)!.add(key);
    }
    for (const set of bySection.values()) sectionEntities.push(set);
  }

  const edgeMap = new Map<string, number>();
  for (const set of sectionEntities) {
    const arr = Array.from(set);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const [a, b] = [arr[i], arr[j]].sort();
        const k = `${a}|${b}`;
        edgeMap.set(k, (edgeMap.get(k) ?? 0) + 1);
      }
    }
  }
  const coOccurrence: CoOccurrenceEdge[] = Array.from(edgeMap.entries())
    .map(([k, weight]) => {
      const [a, b] = k.split("|");
      return { a, b, weight };
    })
    .sort((x, y) => y.weight - x.weight);

  // ── Trajectories per work ────────────────────────────────────────────
  const trajectories: TrajectoryWork[] = works.map((w) => {
    // Order events by section, then by id suffix
    const events = [...w.graph.events].sort((a, b) => {
      if (a.section !== b.section) return a.section.localeCompare(b.section);
      return a.id.localeCompare(b.id);
    });
    const eventIndex = new Map(events.map((e, i) => [e.id, i]));

    const entityById = new Map<string, Entity>(w.graph.entities.map((e) => [e.id, e]));
    const segments: TrajectorySegment[] = [];

    for (const edge of w.graph.stateEdges) {
      if (edge.type !== "LOCATED_AT") continue;
      const character = entityById.get(edge.from);
      const location = entityById.get(edge.to);
      if (!character || character.type !== "character") continue;
      if (!location || location.type !== "location") continue;

      const from = eventIndex.get(edge.valid_from);
      const to = edge.valid_until ? eventIndex.get(edge.valid_until) : events.length;
      if (from === undefined || to === undefined) continue;

      segments.push({
        characterKey: canonicalKey(character.id, "character"),
        characterLabel: prettyLabel(character.label),
        locationKey: canonicalKey(location.id, "location"),
        locationLabel: prettyLabel(location.label),
        fromEventIndex: from,
        toEventIndex: Math.max(to, from + 1),
      });
    }

    return {
      slug: w.meta.slug,
      name: w.meta.name,
      eventCount: events.length,
      segments,
    };
  });

  // ── Frequency tree ───────────────────────────────────────────────────
  const types = ["character", "location", "object", "organisation", "document", "case"] as const;
  const frequency: FrequencyByType[] = types.map((type) => {
    const items = entities
      .filter((e) => e.type === type)
      .slice(0, 60)
      .map((e) => ({
        key: e.key,
        label: e.label,
        count: e.totalMentions,
        works: e.works.length,
      }));
    const total = items.reduce((s, i) => s + i.count, 0);
    return { type, total, items };
  });

  return {
    works: workSummaries,
    entities,
    presence,
    sentences,
    coOccurrence,
    trajectories,
    frequency,
  };
}
