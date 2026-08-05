/**
 * TEMPORARY — the Neo4j query layer, preserved verbatim for parity capture.
 *
 * lib/graph-query.ts is now the SQL implementation. This copy exists only so
 * scripts/capture-parity.ts can regenerate the baseline from Neo4j under the
 * same canonicaliser the SQL side uses. Deleted at Stage 5 along with the rest
 * of the Neo4j code — see the migrate-neo4j-to-postgres ticket.
 *
 * Do not import this from application code.
 */
import { getSession } from "../lib/neo4j";
import { CANON_SLUGS, IN_UNIVERSE_ORDER } from "../lib/canon-types";
import type {
  CaseOutcome, CharacterState, Clue, CrimeType, DocumentType, Entity,
  KnowledgeItem, LexicalGraph, LexicalNode, MemberOf, Mention, ObjectiveEvent,
  ObjectiveGraph, OrgType, SectionMeta, StateEdge, StoryMeta,
} from "../lib/types";

export interface CharacterContext {
  state: CharacterState;
  visibleEvents: ObjectiveEvent[];
  characterEntity: Entity;
}

export async function getCharacterContext(
  story: string,
  characterId: string,
  sectionId: string
): Promise<CharacterContext> {
  const session = getSession();
  try {
    // ── 1. Resolve section cutoff index + character entity ──────────────────
    const sectionRes = await session.run(
      `MATCH (s:Section {story: $story, id: $sectionId}) RETURN s.index AS idx`,
      { story, sectionId }
    );
    const charRes = await session.run(
      `MATCH (c:Entity {story: $story, id: $characterId}) RETURN c`,
      { story, characterId }
    );

    if (!sectionRes.records.length)
      throw new Error(`Section "${sectionId}" not found in story "${story}"`);
    if (!charRes.records.length)
      throw new Error(`Character "${characterId}" not found in story "${story}"`);

    const cutoff = sectionRes.records[0].get("idx") as number;
    const charProps = charRes.records[0].get("c").properties;
    const characterEntity: Entity = {
      id: charProps.id,
      type: "character",
      label: charProps.label,
      description: charProps.description ?? "",
      firstSection: charProps.firstSection ?? "",
    };

    // ── 2. OBSERVED: events where character was a participant ──────────────
    //    Cypher: find all Event nodes reachable via PARTICIPATED_IN from this character
    const obsRes = await session.run(
      `MATCH (c:Entity {story: $story, id: $characterId})-[:PARTICIPATED_IN]->(e:Event)
       WHERE e.sectionIndex <= $cutoff
       RETURN e
       ORDER BY e.sectionIndex`,
      { story, characterId, cutoff }
    );

    const observations: KnowledgeItem[] = obsRes.records.map((r) => {
      const e = r.get("e").properties;
      return {
        id: `obs_${e.id}_${characterId}`,
        description: e.label as string,
        modality: "OBSERVED",
        confidence: 1.0,
        based_on_events: [e.id as string],
      };
    });

    // ── 3. TOLD: events where character was an explicit recipient ───────────
    //    Cypher: find Event nodes that have a TOLD_TO edge pointing at this character
    const toldRes = await session.run(
      `MATCH (e:Event {story: $story})-[:TOLD_TO]->(c:Entity {story: $story, id: $characterId})
       WHERE e.sectionIndex <= $cutoff
       RETURN e
       ORDER BY e.sectionIndex`,
      { story, characterId, cutoff }
    );

    const beliefs: KnowledgeItem[] = toldRes.records.map((r) => {
      const e = r.get("e").properties;
      return {
        id: `belief_${e.id}_${characterId}`,
        description: (e.communicatesContent ?? e.label) as string,
        modality: "TOLD",
        confidence: 0.7,
        based_on_events: [e.id as string],
      };
    });

    const state: CharacterState = {
      character: characterId,
      section: sectionId,
      observations,
      beliefs,
      deductions: [],
    };

    // ── 4. All visible events (for system-prompt context) ───────────────────
    //    Collect each event's participant ids in one pass via WITH/collect
    const allEventsRes = await session.run(
      `MATCH (e:Event {story: $story})
       WHERE e.sectionIndex <= $cutoff
       OPTIONAL MATCH (p:Entity)-[:PARTICIPATED_IN]->(e)
       OPTIONAL MATCH (e)-[:TOLD_TO]->(rec:Entity)
       WITH e, collect(DISTINCT p.id) AS participantIds, collect(DISTINCT rec.id) AS recipientIds
       RETURN e, participantIds, recipientIds
       ORDER BY e.sectionIndex`,
      { story, cutoff }
    );

    const visibleEvents: ObjectiveEvent[] = allEventsRes.records.map((r) => {
      const e = r.get("e").properties;
      const participantIds = r.get("participantIds") as string[];
      const recipientIds = r.get("recipientIds") as string[];
      return {
        id: e.id as string,
        type: "event",
        label: e.label as string,
        section: e.section as string,
        source_nodes: ((e.sourceNodes as string[] | null) ?? []),
        participants: participantIds,
        communicates: e.communicatesContent
          ? {
              speaker: (e.speakerId ?? "") as string,
              recipients: recipientIds,
              content: e.communicatesContent as string,
            }
          : undefined,
      };
    });

    return { state, visibleEvents, characterEntity };
  } finally {
    await session.close();
  }
}

// ── Story listing ─────────────────────────────────────────────────────────────

export async function listStories(): Promise<StoryMeta[]> {
  const session = getSession();
  try {
    const res = await session.run(`MATCH (s:Story) RETURN s ORDER BY s.name`);
    const bySlug = new Map<string, StoryMeta>();
    for (const r of res.records) {
      const s = r.get("s").properties;
      const slug = s.slug as string;
      // Defensive: only ever surface the 17-work canon, even if a stray
      // fixture (calibration variant, Sally-Anne test data) ever landed in
      // the database — CANON_SLUGS is the single source of truth, shared
      // with the load-time filter in scripts/migrate-to-neo4j.ts.
      if (!CANON_SLUGS.includes(slug as (typeof CANON_SLUGS)[number])) continue;
      bySlug.set(slug, { slug, name: s.name as string, sourceFile: s.sourceFile as string });
    }
    // In-universe order, not alphabetical — a reader picking a story wants
    // the canon's internal chronology, not a dictionary sort.
    return IN_UNIVERSE_ORDER.map((slug) => bySlug.get(slug)).filter(
      (s): s is StoryMeta => s !== undefined
    );
  } finally {
    await session.close();
  }
}

// ── Full story data (replaces JSON file reads) ────────────────────────────────

export async function getStoryData(story: string): Promise<{
  lexical: LexicalGraph;
  objective: ObjectiveGraph;
} | null> {
  const session = getSession();
  try {
    // 1. Story meta (confirms it exists + gives granularity)
    const storyRes = await session.run(
      `MATCH (s:Story {slug: $story}) RETURN s.granularity AS granularity`,
      { story }
    );
    if (!storyRes.records.length) return null;
    const granularity = (storyRes.records[0].get("granularity") ?? "sentence") as LexicalGraph["granularity"];

    // 2. Sections
    const sectionsRes = await session.run(
      `MATCH (s:Section {story: $story}) RETURN s ORDER BY s.index`,
      { story }
    );
    const sections: SectionMeta[] = sectionsRes.records.map((r) => {
      const s = r.get("s").properties;
      return { id: s.id as string, index: s.index as number, title: s.title as string, wordCount: s.wordCount as number };
    });

    // 3. Lexical nodes (sentence text)
    const nodesRes = await session.run(
      `MATCH (n:LexicalNode {story: $story}) RETURN n ORDER BY n.position`,
      { story }
    );
    const nodes: LexicalNode[] = nodesRes.records.map((r) => {
      const n = r.get("n").properties;
      return {
        id: n.id as string,
        section: n.section as string,
        position: n.position as number,
        text: n.text as string,
        entities: (n.entities as string[]) ?? [],
      };
    });

    // 4. Entities
    const entitiesRes = await session.run(
      `MATCH (e:Entity {story: $story}) RETURN e, labels(e) AS labels`,
      { story }
    );
    const entities: Entity[] = entitiesRes.records.map((r) => {
      const e = r.get("e").properties;
      const labels = r.get("labels") as string[];
      const type: Entity["type"] =
          labels.includes("Character")    ? "character"
        : labels.includes("Location")     ? "location"
        : labels.includes("Case")         ? "case"
        : labels.includes("Document")     ? "document"
        : labels.includes("Organisation") ? "organisation"
        : "object";
      const base: Entity = {
        id: e.id as string,
        type,
        label: e.label as string,
        description: (e.description as string) ?? "",
        firstSection: (e.firstSection as string) ?? "",
      };
      if (type === "case") {
        base.source = (e.source as string) || undefined;
        base.client = (e.client as string) || undefined;
        base.crime_type = ((e.crime_type as string) || undefined) as CrimeType | undefined;
        base.outcome = ((e.outcome as string) || undefined) as CaseOutcome | undefined;
        base.primary_location = (e.primary_location as string) || undefined;
      } else if (type === "document") {
        base.document_type = ((e.document_type as string) || undefined) as DocumentType | undefined;
        base.from = (e.sender as string) || undefined;
        base.to = (e.recipient as string) || undefined;
        base.content_summary = (e.content_summary as string) || undefined;
      } else if (type === "organisation") {
        base.org_type = ((e.org_type as string) || undefined) as OrgType | undefined;
      }
      return base;
    });

    // 5. Events with participants, performers, and recipients
    const eventsRes = await session.run(
      `MATCH (e:Event {story: $story})
       OPTIONAL MATCH (p:Entity)-[:PARTICIPATED_IN]->(e)
       OPTIONAL MATCH (perf:Entity)-[:PERFORMED]->(e)
       OPTIONAL MATCH (e)-[:TOLD_TO]->(r:Entity)
       WITH e,
            collect(DISTINCT p.id) AS participants,
            collect(DISTINCT perf.id) AS performers,
            collect(DISTINCT r.id)   AS recipients
       RETURN e, participants, performers, recipients
       ORDER BY e.sectionIndex`,
      { story }
    );
    const events: ObjectiveEvent[] = eventsRes.records.map((r) => {
      const e = r.get("e").properties;
      const participants = (r.get("participants") as string[]).filter(Boolean);
      const performers   = (r.get("performers")   as string[]).filter(Boolean);
      const recipients   = (r.get("recipients")   as string[]).filter(Boolean);
      return {
        id: e.id as string,
        type: "event",
        label: e.label as string,
        section: e.section as string,
        source_nodes: ((e.sourceNodes as string[] | null) ?? []),
        participants,
        performs: performers.length ? performers : undefined,
        communicates: e.communicatesContent
          ? { speaker: (e.speakerId ?? "") as string, recipients, content: e.communicatesContent as string }
          : undefined,
      };
    });

    // 6. State edges
    const stateEdgesRes = await session.run(
      `MATCH (f:Entity {story: $story})-[r:IS_INSIDE|LOCATED_AT|OWNS]->(t:Entity)
       RETURN f.id AS fromId, t.id AS toId, type(r) AS relType,
              r.validFrom AS validFrom, r.validUntil AS validUntil`,
      { story }
    );
    const stateEdges: StateEdge[] = stateEdgesRes.records.map((r, i) => ({
      id: `state_${i + 1}`,
      from: r.get("fromId") as string,
      to: r.get("toId") as string,
      type: r.get("relType") as StateEdge["type"],
      valid_from: r.get("validFrom") as string,
      valid_until: (r.get("validUntil") as string | null) ?? undefined,
      caused_by: [],
    }));

    // 7. Mentions (entity → section)
    const mentionsRes = await session.run(
      `MATCH (e:Entity {story: $story})-[r:MENTIONED_IN]->(s:Section {story: $story})
       RETURN e.id AS entityId, s.id AS sectionId,
              r.mentionCount AS mentionCount, r.sentenceIds AS sentenceIds
       ORDER BY s.index`,
      { story }
    );
    const mentions: Mention[] = mentionsRes.records.map((r) => ({
      entity: r.get("entityId") as string,
      section: r.get("sectionId") as string,
      mention_count: (r.get("mentionCount") as number) ?? 0,
      sentence_ids: (r.get("sentenceIds") as string[]) ?? [],
    }));

    // 8. Clues (object → case)
    const cluesRes = await session.run(
      `MATCH (o:Entity {story: $story})-[r:CLUE_FOR]->(k:Entity {story: $story})
       RETURN o.id AS objectId, k.id AS caseId,
              r.discoveredBy AS discoveredBy, r.discoveredInSection AS discoveredInSection,
              r.significance AS significance, r.sourceNodes AS sourceNodes
       ORDER BY r.sectionIndex`,
      { story }
    );
    const clues: Clue[] = cluesRes.records.map((r) => ({
      object: r.get("objectId") as string,
      case: r.get("caseId") as string,
      discovered_by: r.get("discoveredBy") as string,
      discovered_in_section: r.get("discoveredInSection") as string,
      significance: (r.get("significance") as string) ?? "",
      source_nodes: (r.get("sourceNodes") as string[]) ?? [],
    }));

    // 9. Memberships (character → organisation)
    const memberRes = await session.run(
      `MATCH (c:Entity {story: $story})-[r:MEMBER_OF]->(o:Entity {story: $story})
       RETURN c.id AS characterId, o.id AS organisationId,
              r.validFrom AS validFrom, r.validUntil AS validUntil`,
      { story }
    );
    const memberOf: MemberOf[] = memberRes.records.map((r) => ({
      character: r.get("characterId") as string,
      organisation: r.get("organisationId") as string,
      valid_from: (r.get("validFrom") as string | null) ?? undefined,
      valid_until: (r.get("validUntil") as string | null) ?? undefined,
    }));

    return {
      lexical: { granularity, sections, nodes },
      objective: { entities, events, stateEdges, mentions, clues, memberOf },
    };
  } finally {
    await session.close();
  }
}

// ── Utility: current location of an entity at a section ──────────────────────
// Uses the state-edge validity windows (LOCATED_AT / IS_INSIDE) stored during ingestion.
export async function getEntityStateAt(
  story: string,
  entityId: string,
  sectionIndex: number
): Promise<{ type: string; targetId: string; targetLabel: string }[]> {
  const session = getSession();
  try {
    const res = await session.run(
      `MATCH (e:Entity {story: $story, id: $entityId})-[r:IS_INSIDE|LOCATED_AT|OWNS]->(t:Entity)
       WHERE r.validFromIndex <= $sectionIndex
         AND (r.validUntilIndex IS NULL OR r.validUntilIndex > $sectionIndex)
       RETURN type(r) AS edgeType, t.id AS targetId, t.label AS targetLabel`,
      { story, entityId, sectionIndex }
    );
    return res.records.map((r) => ({
      type: r.get("edgeType") as string,
      targetId: r.get("targetId") as string,
      targetLabel: r.get("targetLabel") as string,
    }));
  } finally {
    await session.close();
  }
}
