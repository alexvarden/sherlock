/**
 * Canonical serialisation for parity fixtures.
 *
 * Shared by scripts/capture-parity.ts (which records the Neo4j baseline) and
 * the Stage 2 comparison, so both sides normalise identically. If they ever
 * diverge, every parity result becomes meaningless — hence one module.
 *
 * Two things need normalising before a hash is meaningful:
 *
 *   1. Object key order. JSON.stringify preserves insertion order, which
 *      differs between a Neo4j record mapping and a SQL row mapping even when
 *      the data is identical.
 *   2. Set-valued arrays. Anything built from a Cypher `collect()` has no
 *      guaranteed order, and neither does the equivalent SQL aggregate. Those
 *      fields are sorted; genuinely ordered arrays (sections by index, lexical
 *      nodes by position, events by section) are left alone, so a real
 *      ordering regression still fails.
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

export function canonicalise(value: unknown, field?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalise(v));
    if (field && SET_FIELDS.has(field)) {
      return [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return items;
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
