/**
 * Canonical serialisation for parity fixtures.
 *
 * Shared by scripts/capture-parity.ts (which records the Neo4j baseline) and
 * scripts/compare-parity.ts (which checks the SQL rewrite against it), so both
 * sides normalise identically. If they ever diverge, every parity result
 * becomes meaningless — hence one module.
 *
 * Three things need normalising before a hash means anything:
 *
 *  1. Object key order. JSON.stringify preserves insertion order, which
 *     differs between a Neo4j record mapping and a SQL row mapping even when
 *     the data is identical.
 *
 *  2. Set-valued arrays. Anything built from a Cypher `collect()` has no
 *     guaranteed order, and neither does the SQL `array_agg` replacing it.
 *
 *  3. Collections whose row order was never guaranteed on EITHER side. Several
 *     Cypher reads had no ORDER BY at all (entities, stateEdges, memberOf), and
 *     others ordered by a non-unique key so ties fell out arbitrarily (events
 *     by sectionIndex, mentions by section index, clues by section index).
 *     Comparing those in returned order would be comparing noise. They are
 *     sorted by a stable key instead.
 *
 * What is deliberately NOT normalised: `sections` (ordered by index) and
 * lexical `nodes` (ordered by position). Those orderings are deterministic and
 * semantically load-bearing, so a regression in them must still fail. Ordering
 * that is normalised away here is checked structurally by compare-parity.ts
 * instead.
 */

import { createHash } from "node:crypto";

// Fields whose array value is a set, not a sequence.
const SET_FIELDS = new Set([
  "participants",
  "performs",
  "recipients",
  "entities",
  "sentence_ids",
  "source_nodes",
  "based_on_events",
]);

// Collections to sort, and the stable key to sort them by.
const SORT_KEYS: Record<string, (item: Record<string, unknown>) => string> = {
  entities: (e) => String(e.id),
  events: (e) => String(e.id),
  visibleEvents: (e) => String(e.id),
  observations: (o) => String(o.id),
  beliefs: (b) => String(b.id),
  mentions: (m) => `${m.entity}|${m.section}`,
  clues: (c) => `${c.object}|${c.case}`,
  memberOf: (m) => `${m.character}|${m.organisation}`,
  // getEntityStateAt returns a bare array with no field name of its own, and
  // the Cypher behind it had no ORDER BY at all. capture/compare wrap the
  // result under this key so it gets normalised like every other collection.
  entityState: (r) => `${r.type}|${r.targetId}`,
};

// stateEdges is a special case: the Neo4j reader assigned `state_${i + 1}` from
// the result index, so the id is a function of an ordering that was itself
// arbitrary. Sorting by content and renumbering makes the field comparable
// without dropping it.
function normaliseStateEdges(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...items]
    .sort((a, b) =>
      `${a.from}|${a.to}|${a.type}|${a.valid_from ?? ""}|${a.valid_until ?? ""}`.localeCompare(
        `${b.from}|${b.to}|${b.type}|${b.valid_from ?? ""}|${b.valid_until ?? ""}`
      )
    )
    .map((e, i) => ({ ...e, id: `state_${i + 1}` }));
}

export function canonicalise(value: unknown, field?: string): unknown {
  if (Array.isArray(value)) {
    let items = value;

    if (field === "stateEdges") {
      items = normaliseStateEdges(items as Record<string, unknown>[]);
    }

    let mapped = items.map((v) => canonicalise(v));

    if (field && SORT_KEYS[field]) {
      const key = SORT_KEYS[field];
      // Sort by the semantic key, then break ties on full content.
      //
      // The tiebreak is not belt-and-braces: the corpus genuinely contains
      // duplicate rows under the same key — silver-blaze has two separate
      // mention rows for (john_straker, section_7) with different counts and
      // sentence ids. Both databases hold both rows, so only the tie order
      // differed, and a key-only sort reported 107 false parity failures.
      mapped = [...mapped].sort((a, b) => {
        const ka = key(a as Record<string, unknown>);
        const kb = key(b as Record<string, unknown>);
        if (ka !== kb) return ka.localeCompare(kb);
        return JSON.stringify(a).localeCompare(JSON.stringify(b));
      });
    }

    if (field && SET_FIELDS.has(field)) {
      return [...mapped].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return mapped;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      // Drop undefined so an omitted optional and an explicit undefined agree.
      if (v === undefined) continue;
      out[key] = canonicalise(v, key);
    }
    return out;
  }

  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value), null, 2);
}

export function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}
