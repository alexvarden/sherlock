import neo4j from "neo4j-driver";
import { readFileSync, existsSync } from "fs";
import path from "path";
import type { EntityType, LexicalGraph, ObjectiveGraph, StoryMeta } from "../lib/types";
import { entityTypes } from "../lib/graph-schema";
import { CANON_SLUGS } from "../lib/canon-types";

const driver = neo4j.driver(
  process.env.NEO4J_URI ?? "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER ?? "neo4j",
    process.env.NEO4J_PASSWORD ?? "sherlock"
  ),
  { disableLosslessIntegers: true }
);

// ── Generic helpers ────────────────────────────────────────────────────────
// All relationship writes follow the same shape: match two nodes by id+story,
// create a directional rel of a given type carrying a `props` map. Cypher
// can't parameterise rel types, so we interpolate it — but the rest is generic.

type Session = ReturnType<typeof driver.session>;
type RelRow = { fromId: string; toId: string; props?: Record<string, unknown> };

async function writeRelationships(
  session: Session,
  story: string,
  relType: string,
  rows: RelRow[],
  opts: { fromLabel?: string; toLabel?: string } = {}
): Promise<void> {
  if (!rows.length) return;
  const { fromLabel = "Entity", toLabel = "Entity" } = opts;
  await session.run(
    `UNWIND $rels AS r
     MATCH (f:${fromLabel} {story: $story, id: r.fromId})
     MATCH (t:${toLabel}   {story: $story, id: r.toId})
     CREATE (f)-[rel:${relType}]->(t)
     SET rel = r.props, rel.story = $story`,
    { story, rels: rows.map((r) => ({ ...r, props: r.props ?? {} })) }
  );
}

async function clearDatabase(session: Session) {
  console.log("Clearing database…");
  await session.run("MATCH (n) DETACH DELETE n");
  console.log("Database cleared.");
}

async function setupIndexes(session: Session) {
  const indexes = [
    `CREATE INDEX entity_story_id IF NOT EXISTS FOR (n:Entity) ON (n.story, n.id)`,
    `CREATE INDEX event_story_id IF NOT EXISTS FOR (e:Event) ON (e.story, e.id)`,
    `CREATE INDEX event_story_section IF NOT EXISTS FOR (e:Event) ON (e.story, e.sectionIndex)`,
    `CREATE INDEX section_story_id IF NOT EXISTS FOR (s:Section) ON (s.story, s.id)`,
    `CREATE INDEX story_slug IF NOT EXISTS FOR (s:Story) ON (s.slug)`,
    `CREATE INDEX lexical_node_story_section IF NOT EXISTS FOR (n:LexicalNode) ON (n.story, n.section)`,
  ];
  for (const q of indexes) await session.run(q);
}

async function migrateStory(
  session: ReturnType<typeof driver.session>,
  slug: string,
  meta: StoryMeta,
  lexical: LexicalGraph,
  graph: ObjectiveGraph
) {
  // ── Build lookup maps ────────────────────────────────────────────────────
  const sectionIndexMap = new Map<string, number>();
  for (const s of lexical.sections) sectionIndexMap.set(s.id, s.index);

  const eventSectionIndexMap = new Map<string, number>();
  for (const ev of graph.events) {
    eventSectionIndexMap.set(ev.id, sectionIndexMap.get(ev.section) ?? 0);
  }

  // ── Clear existing data for this story ───────────────────────────────────
  await session.run(`MATCH (n {story: $story}) DETACH DELETE n`, { story: slug });

  // ── Story node ───────────────────────────────────────────────────────────
  await session.run(
    `CREATE (:Story {slug: $slug, name: $name, sourceFile: $sourceFile, granularity: $granularity})`,
    { slug, name: meta.name, sourceFile: meta.sourceFile, granularity: lexical.granularity }
  );

  // ── Section nodes ────────────────────────────────────────────────────────
  await session.run(
    `UNWIND $sections AS s
     CREATE (:Section {story: $story, id: s.id, index: s.index, title: s.title, wordCount: s.wordCount})`,
    { story: slug, sections: lexical.sections }
  );

  // ── Lexical nodes (sentence/paragraph text) ─────────────────────────────
  if (lexical.nodes.length) {
    await session.run(
      `UNWIND $nodes AS n
       CREATE (:LexicalNode {story: $story, id: n.id, section: n.section, position: n.position, text: n.text, entities: n.entities})`,
      { story: slug, nodes: lexical.nodes.map((n) => ({ ...n, entities: n.entities ?? [] })) }
    );
  }

  // ── Entity nodes (driven by graph-schema config) ─────────────────────────
  // The base properties are shared. Type-specific fields are listed here once;
  // adding a new entity type means: (a) extend graph-schema's entityTypes, (b)
  // optionally add a fragment below if it carries extra properties.
  const baseProps = `story: $story, id: e.id, label: e.label,
    description: coalesce(e.description,''),
    firstSection: coalesce(e.firstSection,'')`;

  const extraProps: Partial<Record<EntityType, string>> = {
    case:         `, source: coalesce(e.source,''), client: coalesce(e.client,''),
                     crime_type: coalesce(e.crime_type,''), outcome: coalesce(e.outcome,''),
                     primary_location: coalesce(e.primary_location,'')`,
    document:     `, document_type: coalesce(e.document_type,''), sender: coalesce(e.from,''),
                     recipient: coalesce(e.to,''), content_summary: coalesce(e.content_summary,'')`,
    organisation: `, org_type: coalesce(e.org_type,'')`,
  };

  for (const spec of entityTypes) {
    const entities = graph.entities.filter((e) => e.type === spec.id);
    if (!entities.length) continue;
    const query = `UNWIND $entities AS e CREATE (:Entity:${spec.neo4jLabel} {${baseProps}${extraProps[spec.id] ?? ""}})`;
    await session.run(query, { story: slug, entities });
  }

  // ── Event nodes ──────────────────────────────────────────────────────────
  // sourceNodes is the array of lexical-node ids the event was derived from;
  // we need it on read so the frontend can resolve each event to the earliest
  // sentence position it appears at (otherwise visibility falls back to the
  // start of the event's section, which makes the whole section pop in at once).
  const eventRows = graph.events.map((ev) => ({
    id: ev.id,
    label: ev.label,
    section: ev.section,
    sectionIndex: eventSectionIndexMap.get(ev.id) ?? 0,
    sourceNodes: ev.source_nodes ?? [],
    speakerId: ev.communicates?.speaker ?? null,
    communicatesContent: ev.communicates?.content ?? null,
  }));

  await session.run(
    `UNWIND $events AS e
     CREATE (:Event {
       story: $story, id: e.id, label: e.label,
       section: e.section, sectionIndex: e.sectionIndex,
       sourceNodes: e.sourceNodes,
       speakerId: e.speakerId, communicatesContent: e.communicatesContent
     })`,
    { story: slug, events: eventRows }
  );

  // ── Event-anchored relationships (PARTICIPATED_IN / PERFORMED / SPOKE_IN / TOLD_TO) ──
  await writeRelationships(session, slug, "PARTICIPATED_IN",
    graph.events.flatMap((ev) => ev.participants.map((pid) => ({ fromId: pid, toId: ev.id }))),
    { toLabel: "Event" }
  );

  await writeRelationships(session, slug, "PERFORMED",
    graph.events.flatMap((ev) => (ev.performs ?? []).map((pid) => ({ fromId: pid, toId: ev.id }))),
    { toLabel: "Event" }
  );

  const commEvents = graph.events.filter((ev) => ev.communicates);

  await writeRelationships(session, slug, "SPOKE_IN",
    commEvents
      .filter((ev) => ev.communicates!.speaker)
      .map((ev) => ({ fromId: ev.communicates!.speaker, toId: ev.id })),
    { toLabel: "Event" }
  );

  await writeRelationships(session, slug, "TOLD_TO",
    commEvents.flatMap((ev) => ev.communicates!.recipients.map((rid) => ({ fromId: ev.id, toId: rid }))),
    { fromLabel: "Event" }
  );

  // ── State edges (IS_INSIDE / LOCATED_AT / OWNS) ──────────────────────────
  // Same shape, different rel types. Drive from a small table.
  const STATE_REL_TYPES = ["IS_INSIDE", "LOCATED_AT", "OWNS"] as const;
  for (const relType of STATE_REL_TYPES) {
    await writeRelationships(session, slug, relType,
      graph.stateEdges
        .filter((e) => e.type === relType)
        .map((e) => ({
          fromId: e.from,
          toId: e.to,
          props: {
            validFrom: e.valid_from,
            validUntil: e.valid_until ?? null,
            validFromIndex: eventSectionIndexMap.get(e.valid_from) ?? 0,
            validUntilIndex: e.valid_until ? (eventSectionIndexMap.get(e.valid_until) ?? null) : null,
          },
        }))
    );
  }

  // ── MENTIONED_IN (entity → section) ──────────────────────────────────────
  await writeRelationships(session, slug, "MENTIONED_IN",
    (graph.mentions ?? []).map((m) => ({
      fromId: m.entity,
      toId: m.section,
      props: {
        sectionIndex: sectionIndexMap.get(m.section) ?? 0,
        mentionCount: m.mention_count,
        sentenceIds: m.sentence_ids,
      },
    })),
    { toLabel: "Section" }
  );

  // ── CLUE_FOR (object → case) ─────────────────────────────────────────────
  await writeRelationships(session, slug, "CLUE_FOR",
    (graph.clues ?? []).map((c) => ({
      fromId: c.object,
      toId: c.case,
      props: {
        discoveredBy: c.discovered_by,
        discoveredInSection: c.discovered_in_section,
        sectionIndex: sectionIndexMap.get(c.discovered_in_section) ?? 0,
        significance: c.significance,
        sourceNodes: c.source_nodes,
      },
    }))
  );

  // ── MEMBER_OF (character → organisation) ─────────────────────────────────
  await writeRelationships(session, slug, "MEMBER_OF",
    (graph.memberOf ?? []).map((m) => ({
      fromId: m.character,
      toId: m.organisation,
      props: {
        validFrom: m.valid_from ?? null,
        validUntil: m.valid_until ?? null,
        validFromIndex: m.valid_from ? (eventSectionIndexMap.get(m.valid_from) ?? 0) : 0,
        validUntilIndex: m.valid_until ? (eventSectionIndexMap.get(m.valid_until) ?? null) : null,
      },
    }))
  );
}

async function main() {
  const session = driver.session({ database: process.env.NEO4J_DATABASE ?? "neo4j" });
  try {
    await clearDatabase(session);
    console.log("Setting up indexes…");
    await setupIndexes(session);

    const dataDir = path.join(process.cwd(), "data/processed");
    // Load the canon only — never the calibration variants (-600w/-3000w/-mini/
    // -nano) or Sally-Anne fixtures. CANON_SLUGS is the single source of truth
    // shared with the article loaders (lib/canon-types.ts).
    const slugs = CANON_SLUGS;
    console.log(`Loading ${slugs.length} canon works…`);

    for (const slug of slugs) {
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
      process.stdout.write(`Migrating ${slug}… `);
      await migrateStory(session, slug, meta, lexical, graph);
      console.log(
        `✓  ${graph.entities.length} entities · ${graph.events.length} events · ${graph.stateEdges.length} state · ${(graph.mentions ?? []).length} mentions · ${(graph.clues ?? []).length} clues · ${(graph.memberOf ?? []).length} memberships`
      );
    }

    console.log("\nMigration complete.");
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
