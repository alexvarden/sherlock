import { getQuery } from "./db";
import { CANON_SLUGS, IN_UNIVERSE_ORDER } from "./canon-types";
import type {
  CaseOutcome, CharacterState, Clue, CrimeType, DocumentType, Entity,
  EntityType, KnowledgeItem, LexicalGraph, LexicalNode, MemberOf, Mention,
  ObjectiveEvent, ObjectiveGraph, OrgType, SectionMeta, StateEdge, StoryMeta,
} from "./types";

/**
 * The query layer, in SQL.
 *
 * Everything here reads the two-table model in lib/db/migrations/0001_graph.sql.
 * The three promoted columns do the work that Cypher traversal used to:
 *
 *   nodes.pos                        how far into the story a node sits, so the
 *                                    perspective cutoff and the reader window
 *                                    are both integer comparisons
 *   edges.valid_from/to_section      what was true when
 *   the edge row itself              who saw it
 *
 * Signatures are unchanged from the Neo4j implementation so no caller needed
 * editing. Parity against the Neo4j baseline is enforced by
 * scripts/compare-parity.ts against the fixtures in data/parity/.
 */

export interface CharacterContext {
  state: CharacterState;
  visibleEvents: ObjectiveEvent[];
  characterEntity: Entity;
}

// ── Row shapes ──────────────────────────────────────────────────────────────

type NodeRow = {
  id: string;
  kind: string;
  subkind: string | null;
  name: string | null;
  pos: number | null;
  props: Record<string, unknown>;
};

type EventRow = NodeRow & {
  participants: string[] | null;
  performers: string[] | null;
  recipients: string[] | null;
};

// Aggregating the three entity-to-event relations in one pass, as the Cypher
// did with collect(). Ordering by pos reproduces ORDER BY e.sectionIndex.
const EVENT_SELECT = `
  SELECT e.id, e.kind, e.subkind, e.name, e.pos, e.props,
         (SELECT array_agg(DISTINCT x.from_id) FROM edges x
           WHERE x.story = e.story AND x.to_id = e.id AND x.rel_type = 'PARTICIPATED_IN') AS participants,
         (SELECT array_agg(DISTINCT x.from_id) FROM edges x
           WHERE x.story = e.story AND x.to_id = e.id AND x.rel_type = 'PERFORMED')       AS performers,
         (SELECT array_agg(DISTINCT x.to_id)   FROM edges x
           WHERE x.story = e.story AND x.from_id = e.id AND x.rel_type = 'TOLD_TO')       AS recipients
    FROM nodes e
   WHERE e.story = $1 AND e.kind = 'event'`;

// `withPerforms` is not a style choice. The Neo4j getCharacterContext built its
// visibleEvents from a query that collected only participants and recipients,
// so `performs` was always absent there — while getStoryData did include it.
// That inconsistency is reproduced rather than tidied: parity is the deliverable
// at this stage, and quietly enriching the character-context payload would
// change what the LLM sees on /read. Worth revisiting once the migration is
// signed off.
function toEvent(r: EventRow, withPerforms = true): ObjectiveEvent {
  const communicatesContent = r.props.communicatesContent as string | null;
  const recipients = (r.recipients ?? []).filter(Boolean);
  const performers = (r.performers ?? []).filter(Boolean);

  return {
    id: r.id,
    type: "event",
    label: r.name ?? "",
    section: (r.props.section as string) ?? "",
    source_nodes: (r.props.sourceNodes as string[] | null) ?? [],
    participants: (r.participants ?? []).filter(Boolean),
    performs: withPerforms && performers.length ? performers : undefined,
    communicates: communicatesContent
      ? {
          speaker: (r.props.speakerId as string | null) ?? "",
          recipients,
          content: communicatesContent,
        }
      : undefined,
  };
}

function toEntity(r: NodeRow): Entity {
  const p = r.props;
  const type = (r.subkind ?? "object") as EntityType;

  const base: Entity = {
    id: r.id,
    type,
    label: r.name ?? "",
    description: (p.description as string) ?? "",
    firstSection: (p.firstSection as string) ?? "",
  };

  // Type-specific fields, mirroring what the Neo4j reader reconstructed from
  // its per-type property fragments. Empty strings collapse to undefined, as
  // they did there.
  if (type === "case") {
    base.source = (p.source as string) || undefined;
    base.client = (p.client as string) || undefined;
    base.crime_type = ((p.crime_type as string) || undefined) as CrimeType | undefined;
    base.outcome = ((p.outcome as string) || undefined) as CaseOutcome | undefined;
    base.primary_location = (p.primary_location as string) || undefined;
  } else if (type === "document") {
    base.document_type = ((p.document_type as string) || undefined) as DocumentType | undefined;
    base.from = (p.from as string) || undefined;
    base.to = (p.to as string) || undefined;
    base.content_summary = (p.content_summary as string) || undefined;
  } else if (type === "organisation") {
    base.org_type = ((p.org_type as string) || undefined) as OrgType | undefined;
  }

  return base;
}

// ── Character context ───────────────────────────────────────────────────────

export async function getCharacterContext(
  story: string,
  characterId: string,
  sectionId: string
): Promise<CharacterContext> {
  const query = getQuery();

  const [sectionRow] = await query<{ pos: number }>(
    `SELECT pos FROM nodes WHERE story = $1 AND id = $2 AND kind = 'section'`,
    [story, sectionId]
  );
  if (!sectionRow) throw new Error(`Section "${sectionId}" not found in story "${story}"`);

  const [charRow] = await query<NodeRow>(
    `SELECT id, kind, subkind, name, pos, props FROM nodes
      WHERE story = $1 AND id = $2 AND kind = 'entity'`,
    [story, characterId]
  );
  if (!charRow) throw new Error(`Character "${characterId}" not found in story "${story}"`);

  const cutoff = sectionRow.pos;
  const characterEntity = toEntity(charRow);
  // The Neo4j reader hard-coded type "character" here rather than reading the
  // label, so preserve that: a mis-typed entity must not change the shape.
  characterEntity.type = "character";

  // OBSERVED — events the character took part in, up to the cutoff.
  const observed = await query<{ id: string; name: string | null; pos: number }>(
    `SELECT e.id, e.name, e.pos
       FROM nodes e
       JOIN edges r ON r.story = e.story AND r.to_id = e.id AND r.rel_type = 'PARTICIPATED_IN'
      WHERE e.story = $1 AND e.kind = 'event' AND r.from_id = $2 AND e.pos <= $3
      ORDER BY e.pos`,
    [story, characterId, cutoff]
  );

  const observations: KnowledgeItem[] = observed.map((e) => ({
    id: `obs_${e.id}_${characterId}`,
    description: e.name ?? "",
    modality: "OBSERVED",
    confidence: 1.0,
    based_on_events: [e.id],
  }));

  // TOLD — events where the character was an explicit recipient. The content
  // of the claim is preferred over the event label, because what a character
  // was told may be false; that difference is the whole point.
  const told = await query<{ id: string; name: string | null; content: string | null }>(
    `SELECT e.id, e.name, e.props->>'communicatesContent' AS content
       FROM nodes e
       JOIN edges r ON r.story = e.story AND r.from_id = e.id AND r.rel_type = 'TOLD_TO'
      WHERE e.story = $1 AND e.kind = 'event' AND r.to_id = $2 AND e.pos <= $3
      ORDER BY e.pos`,
    [story, characterId, cutoff]
  );

  const beliefs: KnowledgeItem[] = told.map((e) => ({
    id: `belief_${e.id}_${characterId}`,
    description: e.content ?? e.name ?? "",
    modality: "TOLD",
    confidence: 0.7,
    based_on_events: [e.id],
  }));

  const state: CharacterState = {
    character: characterId,
    section: sectionId,
    observations,
    beliefs,
    deductions: [],
  };

  const visible = await query<EventRow>(`${EVENT_SELECT} AND e.pos <= $2 ORDER BY e.pos, e.id`, [
    story,
    cutoff,
  ]);

  return { state, visibleEvents: visible.map((r) => toEvent(r, false)), characterEntity };
}

// ── Story listing ───────────────────────────────────────────────────────────

export async function listStories(): Promise<StoryMeta[]> {
  const query = getQuery();

  const rows = await query<NodeRow>(
    `SELECT id, kind, subkind, name, pos, props FROM nodes WHERE kind = 'story' ORDER BY name`
  );

  const bySlug = new Map<string, StoryMeta>();
  for (const r of rows) {
    // Defensive: only ever surface the 17-work canon, even if a stray fixture
    // (calibration variant, Sally-Anne test data) ever landed in the database
    // — CANON_SLUGS is the single source of truth, shared with the load-time
    // filter in scripts/load-canon.ts.
    if (!CANON_SLUGS.includes(r.id as (typeof CANON_SLUGS)[number])) continue;
    bySlug.set(r.id, {
      slug: r.id,
      name: r.name ?? "",
      sourceFile: (r.props.sourceFile as string) ?? "",
    });
  }

  // In-universe order, not alphabetical — a reader picking a story wants the
  // canon's internal chronology, not a dictionary sort.
  return IN_UNIVERSE_ORDER.map((slug) => bySlug.get(slug)).filter(
    (s): s is StoryMeta => s !== undefined
  );
}

// ── Full story data ─────────────────────────────────────────────────────────

export async function getStoryData(story: string): Promise<{
  lexical: LexicalGraph;
  objective: ObjectiveGraph;
} | null> {
  const query = getQuery();

  const [storyRow] = await query<NodeRow>(
    `SELECT id, kind, subkind, name, pos, props FROM nodes
      WHERE story = $1 AND kind = 'story'`,
    [story]
  );
  if (!storyRow) return null;

  const granularity = ((storyRow.props.granularity as string) ??
    "sentence") as LexicalGraph["granularity"];

  const sectionRows = await query<NodeRow>(
    `SELECT id, kind, subkind, name, pos, props FROM nodes
      WHERE story = $1 AND kind = 'section' ORDER BY pos`,
    [story]
  );
  const sections: SectionMeta[] = sectionRows.map((r) => ({
    id: r.id,
    index: r.pos ?? 0,
    title: r.name ?? "",
    wordCount: (r.props.wordCount as number) ?? 0,
  }));

  const lexicalRows = await query<NodeRow>(
    `SELECT id, kind, subkind, name, pos, props FROM nodes
      WHERE story = $1 AND kind = 'lexical' ORDER BY pos`,
    [story]
  );
  const nodes: LexicalNode[] = lexicalRows.map((r) => ({
    id: r.id,
    section: (r.props.section as string) ?? "",
    position: r.pos ?? 0,
    text: (r.props.text as string) ?? "",
    entities: (r.props.entities as string[] | null) ?? [],
  }));

  const entityRows = await query<NodeRow>(
    `SELECT id, kind, subkind, name, pos, props FROM nodes
      WHERE story = $1 AND kind = 'entity' ORDER BY id`,
    [story]
  );
  const entities: Entity[] = entityRows.map(toEntity);

  const eventRows = await query<EventRow>(`${EVENT_SELECT} ORDER BY e.pos, e.id`, [story]);
  // Wrapped, not passed by reference: Array.map supplies the index as the
  // second argument, which would land in `withPerforms` and silently strip
  // `performs` from the first event of every story.
  const events: ObjectiveEvent[] = eventRows.map((r) => toEvent(r));

  const stateRows = await query<{
    from_id: string; to_id: string; rel_type: string;
    valid_from: string | null; valid_until: string | null;
  }>(
    `SELECT from_id, to_id, rel_type,
            props->>'validFrom'  AS valid_from,
            props->>'validUntil' AS valid_until
       FROM edges
      WHERE story = $1 AND rel_type IN ('IS_INSIDE', 'LOCATED_AT', 'OWNS')
      ORDER BY from_id, to_id, rel_type, valid_from`,
    [story]
  );
  const stateEdges: StateEdge[] = stateRows.map((r, i) => ({
    id: `state_${i + 1}`,
    from: r.from_id,
    to: r.to_id,
    type: r.rel_type as StateEdge["type"],
    valid_from: r.valid_from ?? "",
    valid_until: r.valid_until ?? undefined,
    caused_by: [],
  }));

  const mentionRows = await query<{
    entity: string; section: string; mention_count: number | null; sentence_ids: string[] | null;
  }>(
    `SELECT e.from_id AS entity, e.to_id AS section,
            (e.props->>'mentionCount')::int AS mention_count,
            ARRAY(SELECT jsonb_array_elements_text(e.props->'sentenceIds')) AS sentence_ids
       FROM edges e
       JOIN nodes s ON s.story = e.story AND s.id = e.to_id
      WHERE e.story = $1 AND e.rel_type = 'MENTIONED_IN'
      ORDER BY s.pos`,
    [story]
  );
  const mentions: Mention[] = mentionRows.map((r) => ({
    entity: r.entity,
    section: r.section,
    mention_count: r.mention_count ?? 0,
    sentence_ids: r.sentence_ids ?? [],
  }));

  const clueRows = await query<{
    object: string; case_id: string; discovered_by: string | null;
    discovered_in_section: string | null; significance: string | null; source_nodes: string[] | null;
  }>(
    `SELECT from_id AS object, to_id AS case_id,
            props->>'discoveredBy'        AS discovered_by,
            props->>'discoveredInSection' AS discovered_in_section,
            props->>'significance'        AS significance,
            ARRAY(SELECT jsonb_array_elements_text(props->'sourceNodes')) AS source_nodes
       FROM edges
      WHERE story = $1 AND rel_type = 'CLUE_FOR'
      ORDER BY valid_from_section`,
    [story]
  );
  const clues: Clue[] = clueRows.map((r) => ({
    object: r.object,
    case: r.case_id,
    discovered_by: r.discovered_by ?? "",
    discovered_in_section: r.discovered_in_section ?? "",
    significance: r.significance ?? "",
    source_nodes: r.source_nodes ?? [],
  }));

  const memberRows = await query<{
    character: string; organisation: string; valid_from: string | null; valid_until: string | null;
  }>(
    `SELECT from_id AS character, to_id AS organisation,
            props->>'validFrom'  AS valid_from,
            props->>'validUntil' AS valid_until
       FROM edges
      WHERE story = $1 AND rel_type = 'MEMBER_OF'
      ORDER BY from_id, to_id`,
    [story]
  );
  const memberOf: MemberOf[] = memberRows.map((r) => ({
    character: r.character,
    organisation: r.organisation,
    valid_from: r.valid_from ?? undefined,
    valid_until: r.valid_until ?? undefined,
  }));

  return {
    lexical: { granularity, sections, nodes },
    objective: { entities, events, stateEdges, mentions, clues, memberOf },
  };
}

// ── Entity state at a point in time ─────────────────────────────────────────
// The validity window, straight off the promoted columns: inclusive lower
// bound, exclusive upper, NULL upper meaning "still true at the story's end".

export async function getEntityStateAt(
  story: string,
  entityId: string,
  sectionIndex: number
): Promise<{ type: string; targetId: string; targetLabel: string }[]> {
  const query = getQuery();

  const rows = await query<{ type: string; target_id: string; target_label: string | null }>(
    `SELECT e.rel_type AS type, e.to_id AS target_id, t.name AS target_label
       FROM edges e
       JOIN nodes t ON t.story = e.story AND t.id = e.to_id
      WHERE e.story = $1
        AND e.from_id = $2
        AND e.rel_type IN ('IS_INSIDE', 'LOCATED_AT', 'OWNS')
        AND e.valid_from_section <= $3
        AND (e.valid_to_section IS NULL OR e.valid_to_section > $3)
      ORDER BY e.rel_type, e.to_id`,
    [story, entityId, sectionIndex]
  );

  return rows.map((r) => ({
    type: r.type,
    targetId: r.target_id,
    targetLabel: r.target_label ?? "",
  }));
}
