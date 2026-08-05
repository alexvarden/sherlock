/**
 * Verify a Postgres load against the Neo4j parity baseline.
 *
 * Checks three things:
 *   1. Counts    — nodes by kind/subkind and edges by rel_type match the
 *                  measured Neo4j baseline exactly.
 *   2. Integrity — no orphans, no self-edges, no nodes outside the canon.
 *   3. Storage   — total size, against Neon Free's 0.5 GB per-project cap.
 *
 * Exits non-zero on any mismatch, so it can gate a load in CI.
 *
 *   npm run db:verify
 */

import { Client } from "pg";
import { CANON_SLUGS } from "../lib/canon-types";

// Measured from local Neo4j on 2026-08-05, after the a-case-of-identity
// recalibration was adopted. Node labels map to (kind, subkind); Neo4j's
// :Entity carries a second label, which is what subkind reproduces.
const BASELINE_NODES: Record<string, number> = {
  lexical: 20459,
  event: 6041,
  entity: 2104,
  section: 533,
  story: 17,
};

const BASELINE_SUBKINDS: Record<string, number> = {
  character: 732,
  location: 504,
  object: 483,
  organisation: 149,
  document: 121,
  case: 115,
};

const BASELINE_EDGES: Record<string, number> = {
  PARTICIPATED_IN: 15909,
  PERFORMED: 6125,
  MENTIONED_IN: 5236,
  TOLD_TO: 4132,
  SPOKE_IN: 3404,
  LOCATED_AT: 1593,
  CLUE_FOR: 387,
  IS_INSIDE: 231,
  OWNS: 230,
  MEMBER_OF: 138,
};

const BASELINE_TOTAL_NODES = 29154;
const BASELINE_TOTAL_EDGES = 37385;

let failures = 0;

function check(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  if (!ok) failures++;
  const delta = actual - expected;
  const suffix = ok ? "" : `  (${delta > 0 ? "+" : ""}${delta})`;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(18)} ${String(actual).padStart(6)} / ${String(expected).padEnd(6)}${suffix}`);
}

async function main() {
  const url = process.env.SHERLOCK_DATABASE_URL;
  if (!url) throw new Error("SHERLOCK_DATABASE_URL is not set");

  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
  const client = new Client({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // ── 1. Counts ───────────────────────────────────────────────────────────
    console.log("Nodes by kind          actual / baseline");
    const kinds = await client.query<{ kind: string; c: string }>(
      "SELECT kind, count(*)::text AS c FROM nodes GROUP BY kind"
    );
    const kindCounts = new Map(kinds.rows.map((r) => [r.kind, Number(r.c)]));
    for (const [kind, expected] of Object.entries(BASELINE_NODES)) {
      check(kind, kindCounts.get(kind) ?? 0, expected);
    }

    console.log("\nEntities by subkind    actual / baseline");
    const subkinds = await client.query<{ subkind: string; c: string }>(
      "SELECT subkind, count(*)::text AS c FROM nodes WHERE kind = 'entity' GROUP BY subkind"
    );
    const subkindCounts = new Map(subkinds.rows.map((r) => [r.subkind, Number(r.c)]));
    for (const [subkind, expected] of Object.entries(BASELINE_SUBKINDS)) {
      check(subkind, subkindCounts.get(subkind) ?? 0, expected);
    }

    console.log("\nEdges by type          actual / baseline");
    const rels = await client.query<{ rel_type: string; c: string }>(
      "SELECT rel_type, count(*)::text AS c FROM edges GROUP BY rel_type"
    );
    const relCounts = new Map(rels.rows.map((r) => [r.rel_type, Number(r.c)]));
    for (const [rel, expected] of Object.entries(BASELINE_EDGES)) {
      check(rel, relCounts.get(rel) ?? 0, expected);
    }

    console.log("\nTotals                 actual / baseline");
    const totals = await client.query<{ n: string; e: string }>(
      "SELECT (SELECT count(*) FROM nodes)::text AS n, (SELECT count(*) FROM edges)::text AS e"
    );
    check("nodes", Number(totals.rows[0].n), BASELINE_TOTAL_NODES);
    check("edges", Number(totals.rows[0].e), BASELINE_TOTAL_EDGES);

    // ── 2. Integrity ────────────────────────────────────────────────────────
    console.log("\nIntegrity");

    // Foreign keys make true orphans impossible; this proves the constraint is
    // actually present rather than assuming it.
    const orphans = await client.query<{ c: string }>(`
      SELECT count(*)::text AS c FROM edges e
      WHERE NOT EXISTS (SELECT 1 FROM nodes n WHERE n.story = e.story AND n.id = e.from_id)
         OR NOT EXISTS (SELECT 1 FROM nodes n WHERE n.story = e.story AND n.id = e.to_id)
    `);
    check("orphan edges", Number(orphans.rows[0].c), 0);

    // Five self-edges exist in the extracted data (agra LOCATED_AT agra, sikhs
    // MEMBER_OF sikhs, body_hollow, lachine, mrs_stapleton OWNS herself).
    // Verified present in Neo4j too, so reproducing them is correct parity —
    // they are an extraction-quality issue for validate-canon-data, not a load
    // bug. Asserted rather than ignored so the number can't drift unnoticed.
    const selfEdges = await client.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM edges WHERE from_id = to_id"
    );
    check("self edges (known)", Number(selfEdges.rows[0].c), 5);

    const strays = await client.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM nodes WHERE story <> ALL($1::text[])",
      [CANON_SLUGS]
    );
    check("non-canon nodes", Number(strays.rows[0].c), 0);

    const unreachable = await client.query<{ c: string }>(`
      SELECT count(*)::text AS c FROM nodes n
      WHERE n.kind IN ('entity', 'event')
        AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.story = n.story AND (e.from_id = n.id OR e.to_id = n.id))
    `);
    // Not a failure — an entity extracted but never related to anything is a
    // data-quality signal, not a load bug. Reported so it can be watched.
    console.log(`  · unreachable entity/event nodes: ${unreachable.rows[0].c}`);

    const storyCount = await client.query<{ c: string }>(
      "SELECT count(DISTINCT story)::text AS c FROM nodes"
    );
    check("stories", Number(storyCount.rows[0].c), CANON_SLUGS.length);

    // ── 3. Storage ──────────────────────────────────────────────────────────
    const size = await client.query<{ total: string; bytes: string }>(`
      SELECT pg_size_pretty(pg_total_relation_size('nodes') + pg_total_relation_size('edges')) AS total,
             (pg_total_relation_size('nodes') + pg_total_relation_size('edges'))::text AS bytes
    `);
    const bytes = Number(size.rows[0].bytes);
    const capBytes = 0.5 * 1024 * 1024 * 1024;
    const pct = ((bytes / capBytes) * 100).toFixed(1);
    console.log(`\nStorage`);
    console.log(`  · nodes + edges, incl. indexes: ${size.rows[0].total}  (${pct}% of Neon Free's 0.5 GB/project)`);

    console.log("");
    if (failures > 0) {
      console.error(`verify-load: ${failures} check(s) FAILED`);
      process.exit(1);
    }
    console.log("verify-load: all checks passed");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("verify-load: failed");
  console.error(err);
  process.exit(1);
});
