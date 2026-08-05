/**
 * Load the canon into Postgres. Replaces scripts/migrate-to-neo4j.ts.
 *
 * data/processed/*.json is the source of truth; this script is the only way
 * data gets into the database, and it is safe to re-run. Each story is loaded
 * inside a single transaction that first deletes everything belonging to that
 * story, so running twice leaves the same final state — that is the whole
 * disaster-recovery story, and it is tested by scripts/verify-load.ts.
 *
 * Uses node-postgres over the pooled connection string. The Neon serverless
 * driver in lib/db.ts is HTTP-per-query, which would turn this into tens of
 * thousands of sequential round trips.
 *
 *   npm run db:load
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import type { EntityType, LexicalGraph, ObjectiveGraph, StoryMeta } from "../lib/types";
import { CANON_SLUGS } from "../lib/canon-types";
import { entityTypes } from "../lib/graph-schema";

// The six types the schema knows about. Anything else is skipped, matching the
// Neo4j loader, which built its entity writes by iterating entityTypes and so
// never created a node for an unrecognised type. Two such entities exist in the
// corpus today (see the warning this triggers) — keeping them would silently
// diverge from the parity baseline.
const KNOWN_ENTITY_TYPES = new Set<string>(entityTypes.map((t) => t.id));

// Which node kind each end of a relationship must have.
//
// This mirrors the label scoping in the Neo4j loader, where every write was a
// `MATCH (f:Entity)...MATCH (t:Event)` pair: an id that resolved to the wrong
// kind of node simply failed to match and the relationship was never created.
// Checking existence alone is not equivalent — ids are only unique per story,
// not per kind, so an event id can collide with an entity id.
const ENDPOINT_KINDS: Record<string, { from: NodeRow["kind"]; to: NodeRow["kind"] }> = {
  PARTICIPATED_IN: { from: "entity", to: "event" },
  PERFORMED:       { from: "entity", to: "event" },
  SPOKE_IN:        { from: "entity", to: "event" },
  TOLD_TO:         { from: "event",  to: "entity" },
  MENTIONED_IN:    { from: "entity", to: "section" },
  IS_INSIDE:       { from: "entity", to: "entity" },
  LOCATED_AT:      { from: "entity", to: "entity" },
  OWNS:            { from: "entity", to: "entity" },
  CLUE_FOR:        { from: "entity", to: "entity" },
  MEMBER_OF:       { from: "entity", to: "entity" },
};

// ── Row shapes ──────────────────────────────────────────────────────────────

type NodeRow = {
  story: string;
  id: string;
  kind: "story" | "section" | "lexical" | "entity" | "event";
  subkind: EntityType | null;
  name: string | null;
  pos: number | null;
  props: Record<string, unknown>;
};

type EdgeRow = {
  story: string;
  from_id: string;
  to_id: string;
  rel_type: string;
  valid_from_section: number | null;
  valid_to_section: number | null;
  props: Record<string, unknown>;
};

// ── Batched multi-row insert ────────────────────────────────────────────────
// Postgres caps a statement at 65535 bind parameters. Nodes bind 7 columns and
// edges 7, so 2000 rows per statement stays comfortably under with room spare.

const BATCH_ROWS = 2000;

async function insertBatched(
  client: Client,
  table: string,
  columns: string[],
  rows: unknown[][]
): Promise<void> {
  if (!rows.length) return;
  const cols = columns.join(", ");

  for (let start = 0; start < rows.length; start += BATCH_ROWS) {
    const chunk = rows.slice(start, start + BATCH_ROWS);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(`INSERT INTO ${table} (${cols}) VALUES ${tuples.join(", ")}`, params);
  }
}

// ── Build the two tables for one story ──────────────────────────────────────

type SkippedEntity = { story: string; id: string; type: string; label: string };

function buildStory(
  slug: string,
  meta: StoryMeta,
  lexical: LexicalGraph,
  graph: ObjectiveGraph,
  skippedEntities: SkippedEntity[]
): { nodes: NodeRow[]; edges: EdgeRow[] } {
  // Section id -> index, and event id -> the index of its section. Both are
  // needed to turn the JSON's event-id-based validity windows into the integer
  // section windows the schema promotes to columns.
  const sectionIndex = new Map<string, number>();
  for (const s of lexical.sections) sectionIndex.set(s.id, s.index);

  const eventSectionIndex = new Map<string, number>();
  for (const ev of graph.events) eventSectionIndex.set(ev.id, sectionIndex.get(ev.section) ?? 0);

  const nodes: NodeRow[] = [];
  const edges: EdgeRow[] = [];

  // ── Nodes ─────────────────────────────────────────────────────────────────

  nodes.push({
    story: slug,
    id: slug,
    kind: "story",
    subkind: null,
    name: meta.name,
    pos: null,
    props: { sourceFile: meta.sourceFile, granularity: lexical.granularity },
  });

  for (const s of lexical.sections) {
    nodes.push({
      story: slug,
      id: s.id,
      kind: "section",
      subkind: null,
      name: s.title,
      pos: s.index,
      props: { wordCount: s.wordCount },
    });
  }

  for (const n of lexical.nodes) {
    nodes.push({
      story: slug,
      id: n.id,
      kind: "lexical",
      subkind: null,
      // Lexical text is content, not a name — it belongs in props.
      name: null,
      pos: n.position,
      props: { section: n.section, text: n.text, entities: n.entities ?? [] },
    });
  }

  for (const e of graph.entities) {
    if (!KNOWN_ENTITY_TYPES.has(e.type)) {
      skippedEntities.push({ story: slug, id: e.id, type: e.type, label: e.label });
      continue;
    }
    // Everything except the identity columns goes to props verbatim, so the
    // type-specific fields (case/document/organisation) need no special-casing
    // here — unlike the Neo4j loader, which had to name them one by one.
    const { id, type, label, ...rest } = e;
    nodes.push({
      story: slug,
      id,
      kind: "entity",
      subkind: type,
      name: label,
      // An entity has no single position; props.firstSection is its debut.
      pos: null,
      props: rest,
    });
  }

  for (const ev of graph.events) {
    nodes.push({
      story: slug,
      id: ev.id,
      kind: "event",
      subkind: null,
      name: ev.label,
      pos: eventSectionIndex.get(ev.id) ?? 0,
      props: {
        section: ev.section,
        // Which lexical nodes the event was derived from. The viewer resolves
        // each event to its earliest sentence position from this; without it,
        // visibility falls back to the section start and the whole section
        // pops in at once.
        sourceNodes: ev.source_nodes ?? [],
        speakerId: ev.communicates?.speaker ?? null,
        communicatesContent: ev.communicates?.content ?? null,
      },
    });
  }

  // ── Edges ─────────────────────────────────────────────────────────────────
  // Event-anchored relations carry no window of their own: the event node's
  // pos is the time. Only genuinely stateful relations get validity columns.

  const push = (
    from_id: string,
    to_id: string,
    rel_type: string,
    validFrom: number | null = null,
    validTo: number | null = null,
    props: Record<string, unknown> = {}
  ) => {
    edges.push({
      story: slug,
      from_id,
      to_id,
      rel_type,
      valid_from_section: validFrom,
      valid_to_section: validTo,
      props,
    });
  };

  for (const ev of graph.events) {
    for (const pid of ev.participants) push(pid, ev.id, "PARTICIPATED_IN");
    for (const pid of ev.performs ?? []) push(pid, ev.id, "PERFORMED");

    if (ev.communicates) {
      if (ev.communicates.speaker) push(ev.communicates.speaker, ev.id, "SPOKE_IN");
      for (const rid of ev.communicates.recipients) push(ev.id, rid, "TOLD_TO");
    }
  }

  // State edges: the validity window is expressed in the JSON as event ids;
  // resolve those to section indices, which is what the columns hold.
  for (const e of graph.stateEdges) {
    push(
      e.from,
      e.to,
      e.type,
      eventSectionIndex.get(e.valid_from) ?? 0,
      e.valid_until ? eventSectionIndex.get(e.valid_until) ?? null : null,
      { validFrom: e.valid_from, validUntil: e.valid_until ?? null }
    );
  }

  for (const m of graph.mentions ?? []) {
    // Point in time, not a window.
    push(m.entity, m.section, "MENTIONED_IN", sectionIndex.get(m.section) ?? 0, null, {
      mentionCount: m.mention_count,
      sentenceIds: m.sentence_ids,
    });
  }

  for (const c of graph.clues ?? []) {
    push(c.object, c.case, "CLUE_FOR", sectionIndex.get(c.discovered_in_section) ?? 0, null, {
      discoveredBy: c.discovered_by,
      discoveredInSection: c.discovered_in_section,
      significance: c.significance,
      sourceNodes: c.source_nodes,
    });
  }

  for (const m of graph.memberOf ?? []) {
    push(
      m.character,
      m.organisation,
      "MEMBER_OF",
      m.valid_from ? eventSectionIndex.get(m.valid_from) ?? 0 : 0,
      m.valid_until ? eventSectionIndex.get(m.valid_until) ?? null : null,
      { validFrom: m.valid_from ?? null, validUntil: m.valid_until ?? null }
    );
  }

  return { nodes, edges };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.SHERLOCK_DATABASE_URL;
  if (!url) throw new Error("SHERLOCK_DATABASE_URL is not set");

  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
  const client = new Client({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  const dataDir = path.join(process.cwd(), "data/processed");

  // Load the canon only — never the calibration variants (-600w/-3000w/-mini/
  // -nano) or Sally-Anne fixtures. CANON_SLUGS is the single source of truth,
  // shared with the article loaders (lib/canon-types.ts).
  //
  // The slug is also the DIRECTORY NAME, and deliberately not meta.json's
  // `slug` field: six directories declare "a-case-of-identity", so keying on
  // the field would collapse them onto one story and the per-story delete
  // below would wipe each in turn.
  console.log(`Loading ${CANON_SLUGS.length} canon works…`);

  let totalNodes = 0;
  let totalEdges = 0;
  let totalDropped = 0;
  const skippedEntities: SkippedEntity[] = [];

  try {
    for (const slug of CANON_SLUGS) {
      const dir = path.join(dataDir, slug);
      const lexicalPath = path.join(dir, "lexical.json");
      const objPath = path.join(dir, "objective-graph.json");

      if (!existsSync(lexicalPath) || !existsSync(objPath)) {
        console.log(`Skipping ${slug} — missing lexical.json or objective-graph.json`);
        continue;
      }

      const lexical = JSON.parse(readFileSync(lexicalPath, "utf-8")) as LexicalGraph;
      const graph = JSON.parse(readFileSync(objPath, "utf-8")) as ObjectiveGraph;
      const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf-8")) as StoryMeta;

      const { nodes, edges } = buildStory(slug, meta, lexical, graph, skippedEntities);

      // Drop edges whose endpoints don't resolve to a node of the right kind,
      // and say so. Neo4j's label-scoped MATCH writes dropped these silently;
      // replicating that keeps parity with the baseline, but the silence is
      // what let them go unnoticed. Foreign keys are the backstop for anything
      // this filter misses.
      const kindById = new Map(nodes.map((n) => [n.id, n.kind]));
      const resolves = (id: string, kind: NodeRow["kind"]) => kindById.get(id) === kind;

      const kept = edges.filter((e) => {
        const want = ENDPOINT_KINDS[e.rel_type];
        if (!want) throw new Error(`No endpoint kinds declared for rel_type ${e.rel_type}`);
        return resolves(e.from_id, want.from) && resolves(e.to_id, want.to);
      });
      const dropped = edges.length - kept.length;

      if (dropped > 0) {
        const byType = new Map<string, number>();
        for (const e of edges) {
          const want = ENDPOINT_KINDS[e.rel_type];
          if (!resolves(e.from_id, want.from) || !resolves(e.to_id, want.to)) {
            byType.set(e.rel_type, (byType.get(e.rel_type) ?? 0) + 1);
          }
        }
        const summary = [...byType.entries()].map(([t, c]) => `${t}×${c}`).join(", ");
        console.warn(`  ⚠ ${slug}: dropped ${dropped} edge(s) with unresolvable endpoints — ${summary}`);
        totalDropped += dropped;
      }

      process.stdout.write(`Loading ${slug}… `);

      await client.query("BEGIN");
      try {
        // ON DELETE CASCADE clears this story's edges with its nodes.
        await client.query("DELETE FROM nodes WHERE story = $1", [slug]);

        await insertBatched(
          client,
          "nodes",
          ["story", "id", "kind", "subkind", "name", "pos", "props"],
          nodes.map((n) => [n.story, n.id, n.kind, n.subkind, n.name, n.pos, JSON.stringify(n.props)])
        );

        await insertBatched(
          client,
          "edges",
          ["story", "from_id", "to_id", "rel_type", "valid_from_section", "valid_to_section", "props"],
          kept.map((e) => [
            e.story, e.from_id, e.to_id, e.rel_type,
            e.valid_from_section, e.valid_to_section, JSON.stringify(e.props),
          ])
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }

      totalNodes += nodes.length;
      totalEdges += kept.length;
      console.log(`✓  ${nodes.length} nodes · ${kept.length} edges`);
    }

    // Reclaim the dead tuples the per-story DELETE leaves behind, and refresh
    // planner stats. Without this, each reload grows the database by roughly
    // its own size until autovacuum catches up — measured at 37 MB -> 65 MB
    // over three loads, against Neon Free's hard 0.5 GB per-project cap.
    // Cannot run inside a transaction, which is why it sits after the loop.
    process.stdout.write("Vacuuming… ");
    await client.query("VACUUM (ANALYZE) nodes");
    await client.query("VACUUM (ANALYZE) edges");
    console.log("done");

    console.log("");
    console.log(`Load complete — ${totalNodes} nodes · ${totalEdges} edges`);
    if (totalDropped > 0) {
      console.warn(`⚠ ${totalDropped} edge(s) dropped across the corpus for unresolvable endpoints`);
    }
    if (skippedEntities.length > 0) {
      console.warn(`⚠ ${skippedEntities.length} entit(ies) skipped for an unrecognised type:`);
      for (const s of skippedEntities) {
        console.warn(`    ${s.story}/${s.id} — type "${s.type}" (${s.label})`);
      }
      console.warn(`  These are extraction bugs, not load bugs. Fixing them means re-extracting`);
      console.warn(`  or adding the type to lib/graph-schema.ts — either way it moves the baseline.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("load-canon: failed");
  console.error(err);
  process.exit(1);
});
