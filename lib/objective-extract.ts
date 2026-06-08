import * as fs from "fs";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type {
  Entity,
  EntityType,
  LexicalGraph,
  Mention,
  Clue,
  MemberOf,
  ObjectiveEvent,
  ObjectiveGraph,
  StateEdge,
} from "./types";

// ── Forbidden terms in Layer 2 (validator) ────────────────────────────────

const FORBIDDEN_TERMS = ["knownBy", "BELIEVES", "KNOWS", "DOES_NOT_KNOW", "perceives", "thinks_that"];

export function validateObjectiveGraph(graph: ObjectiveGraph): string[] {
  const errors: string[] = [];
  const json = JSON.stringify(graph);
  for (const term of FORBIDDEN_TERMS) {
    if (json.includes(term)) errors.push(`Layer 2 contains forbidden term: ${term}`);
  }
  // Every state edge needs caused_by + valid_from
  for (const edge of graph.stateEdges) {
    if (!edge.valid_from) errors.push(`StateEdge ${edge.id} missing valid_from`);
    if (!edge.caused_by || edge.caused_by.length === 0) errors.push(`StateEdge ${edge.id} missing caused_by`);
  }
  // Every event needs source_nodes
  for (const event of graph.events) {
    if (!event.source_nodes || event.source_nodes.length === 0) {
      errors.push(`Event ${event.id} missing source_nodes`);
    }
  }

  // ── Reference integrity for extended types ────────────────────────────
  const entityIds = new Set(graph.entities.map((e) => e.id));
  const caseIds = new Set(graph.entities.filter((e) => e.type === "case").map((e) => e.id));
  const orgIds = new Set(graph.entities.filter((e) => e.type === "organisation").map((e) => e.id));

  // Every CLUE_FOR must reference a valid case and object
  for (const clue of graph.clues) {
    if (!caseIds.has(clue.case)) errors.push(`Clue references unknown case: ${clue.case}`);
    if (!entityIds.has(clue.object)) errors.push(`Clue references unknown object: ${clue.object}`);
    if (!entityIds.has(clue.discovered_by)) errors.push(`Clue references unknown discoverer: ${clue.discovered_by}`);
    if (!clue.source_nodes || clue.source_nodes.length === 0) errors.push(`Clue for ${clue.object}→${clue.case} missing source_nodes`);
  }

  // Every MEMBER_OF must reference a valid organisation
  for (const m of graph.memberOf) {
    if (!orgIds.has(m.organisation)) errors.push(`MemberOf references unknown organisation: ${m.organisation}`);
    if (!entityIds.has(m.character)) errors.push(`MemberOf references unknown character: ${m.character}`);
  }

  // Every document with from/to must reference valid entities
  for (const e of graph.entities) {
    if (e.type === "document") {
      if (e.from && !entityIds.has(e.from)) errors.push(`Document ${e.id} references unknown sender: ${e.from}`);
      if (e.to && !entityIds.has(e.to)) errors.push(`Document ${e.id} references unknown recipient: ${e.to}`);
    }
  }

  // Every mention must reference a valid entity
  for (const m of graph.mentions) {
    if (!entityIds.has(m.entity)) errors.push(`Mention references unknown entity: ${m.entity}`);
  }

  return errors;
}

// ── LLM extraction prompt ─────────────────────────────────────────────────

interface RawMention { entity: string; sentence_ids: string[] }
interface RawClue { object: string; case: string; discovered_by: string; significance: string; source_nodes: string[] }
interface RawMemberOf { character: string; organisation: string }

interface SectionExtraction {
  newEntities: Entity[];
  events: ObjectiveEvent[];
  stateChanges: Array<{
    from: string;
    to: string;
    type: "IS_INSIDE" | "LOCATED_AT" | "OWNS";
    caused_by_event: string;
  }>;
  mentions: RawMention[];
  clues: RawClue[];
  memberOf: RawMemberOf[];
}

async function extractSection(
  llm: BaseChatModel,
  sectionId: string,
  sectionLexicalNodes: { id: string; text: string }[],
  knownEntities: Entity[]
): Promise<SectionExtraction> {
  const lexicalText = sectionLexicalNodes.map((n) => `[${n.id}] ${n.text}`).join("\n");
  const knownList = knownEntities.length
    ? knownEntities.map((e) => `  - ${e.id}: ${e.label} (${e.type})`).join("\n")
    : "  (none yet)";

  const system = `You extract OBJECTIVE narrative facts from story text.
You produce a strict layer of "what objectively happens" — never beliefs, knowledge, or perceptions.
Return ONLY valid JSON. No markdown, no commentary.`;

  const prompt = `Extract entities, events, state changes, mentions, clues, and memberships from this section.

SECTION: ${sectionId}

LEXICAL NODES (each line is a sentence with its lexical id in brackets):
${lexicalText}

ENTITIES ALREADY KNOWN (reuse ids — do not invent new ids for these):
${knownList}

Return JSON with this exact shape:
{
  "newEntities": [
    {
      "id": "snake_case_id",
      "type": "character" | "object" | "location" | "case" | "document" | "organisation",
      "label": "Human readable name",
      "description": "Brief",
      --- type-specific fields (include ONLY for the matching type) ---
      "source": "story-slug",                            // case only
      "client": "character_id",                           // case only
      "crime_type": "murder"|"theft"|"blackmail"|"forgery"|"kidnapping"|"disappearance"|"other",  // case only
      "outcome": "solved"|"unsolved"|"unresolved",        // case only
      "primary_location": "location_id",                  // case only
      "document_type": "letter"|"telegram"|"newspaper"|"note"|"cipher"|"manuscript",  // document only
      "from": "entity_id",                                // document only (sender)
      "to": "entity_id",                                  // document only (recipient)
      "content_summary": "what the document says",        // document only
      "org_type": "law_enforcement"|"criminal_network"|"club"|"religious"|"commercial"|"other"  // organisation only
    }
  ],
  "events": [
    {
      "id": "event_<sectionnum>_<n>",
      "label": "What happens, third-person, present tense",
      "source_nodes": ["sentence_5", "sentence_6"],
      "participants": ["entity_id_1", "entity_id_2"],
      "performs": ["entity_id_who_did_it"],
      "communicates": {
        "speaker": "entity_id",
        "recipients": ["entity_id"],
        "content": "the literal claim made"
      }
    }
  ],
  "stateChanges": [
    {
      "from": "entity_id",
      "to": "entity_id",
      "type": "IS_INSIDE" | "LOCATED_AT" | "OWNS",
      "caused_by_event": "event_id"
    }
  ],
  "mentions": [
    {
      "entity": "entity_id",
      "sentence_ids": ["sentence_5", "sentence_12"]
    }
  ],
  "clues": [
    {
      "object": "object_entity_id",
      "case": "case_entity_id",
      "discovered_by": "character_entity_id",
      "significance": "Holmes inferred X from Y (past-tense, attributed to a specific character)",
      "source_nodes": ["sentence_10"]
    }
  ],
  "memberOf": [
    {
      "character": "character_entity_id",
      "organisation": "organisation_entity_id"
    }
  ]
}

RULES:
1. Only include entities that ACTUALLY APPEAR or are referred to by name in this section.
2. "participants" lists every entity present at the event (witnesses included). "performs" lists who actively did it.
3. For speech acts (X tells Y, X says to Y, X explains to Y...), include "communicates": speaker, recipients, and the literal content of what was said. The communication itself is an objective event regardless of whether the content is true.
4. NEVER include fields like knownBy, believes, thinks. The graph stores reality, not knowledge.
5. Only include "communicates" on events that are speech acts. Omit the field otherwise.
6. Only include "performs" if there's a clear actor. Omit otherwise.
7. Do NOT include "newEntities" entries for entities listed under "ENTITIES ALREADY KNOWN" — just reuse their ids in events.

EXTENDED ENTITY TYPES:
8. "case": Emit ONE per story/novel in the section that first names it. Represents the investigation. Subsequent sections reuse the id.
   ⚠️ CRITICAL: If you emit ANY clues in this section, you MUST first create the case entity in newEntities.
9. "document": Letters, telegrams, newspaper cuttings, notes, ciphers. Include from/to when identifiable.
   content_summary is what the document SAYS, not what any character thinks it means.
10. "organisation": Scotland Yard, Baker Street Irregulars, clubs, criminal networks, etc. Do NOT squash into "character".
    ⚠️ CRITICAL: If you emit ANY memberOf entries in this section, you MUST first create the organisation entity in newEntities.

MENTIONS:
11. List every entity that is NAMED in this section (whether or not it acts). Include the sentence_ids where the name appears. This captures "named-but-not-present" references (e.g. Moriarty discussed but not on-page).

CLUES:
12. When a physical object becomes evidence for a case, emit a clue entry. "significance" must be the inference ATTRIBUTED TO A SPECIFIC CHARACTER ("Holmes inferred the cab's wheelbase from the rut spacing"), NOT a free-floating claim. Past tense, no belief language.
    ⚠️ The "case" field MUST reference a case entity_id that you created in newEntities (or that already exists in ENTITIES ALREADY KNOWN).

MEMBERSHIPS:
13. When a character is identified as belonging to an organisation, emit a memberOf entry.
    ⚠️ The "organisation" field MUST reference an organisation entity_id that you created in newEntities (or that already exists in ENTITIES ALREADY KNOWN).

STATE CHANGES — CRITICAL:
A "state change" is the START of a new factual relationship between two entities. Emit one EVERY time an entity enters a new container, location, or owner — INCLUDING the very first time (initial placement counts).

Schema:
  - IS_INSIDE: an object enters a container. from=object, to=container. (e.g. marble entering a basket)
  - LOCATED_AT: a character or object is at a location. from=character_or_object, to=location.
  - OWNS: a character takes ownership. from=character, to=object.

Always emit a state change when:
  - An object is placed in/on/inside something → IS_INSIDE
  - A character enters/leaves/arrives at a location → LOCATED_AT (emit one for each move)
  - A character takes / is given / acquires an object → OWNS

Example (Sally-Anne false-belief task):
  Text: "Sally placed the marble inside her red basket. Anne moved the marble into her blue box."
  Events:
    event_1: "Sally places marble in red basket" (performs=[sally], participants=[sally, marble, red_basket])
    event_2: "Anne moves marble from red basket to blue box" (performs=[anne], participants=[anne, marble, red_basket, blue_box])
  State changes:
    { from: "marble", to: "red_basket", type: "IS_INSIDE", caused_by_event: "event_1" }
    { from: "marble", to: "blue_box",   type: "IS_INSIDE", caused_by_event: "event_2" }
  ✅ The system will automatically close the first edge when the second begins. You do NOT emit valid_until.
  ❌ DO NOT emit "red_basket IS_INSIDE blue_box" — that says the basket is inside the box, which is false.
  ❌ DO NOT emit cognitive state ("Sally thinks marble is in basket") — that's Layer 3.

NEVER emit a state change about an inanimate fixture (e.g. "garden LOCATED_AT house"). State changes are about entities that move/transfer between places, containers, or owners.`;

  const response = await llm.invoke([new SystemMessage(system), new HumanMessage(prompt)]);
  const raw = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    const newEntities: Entity[] = (parsed.newEntities ?? []).map((e: Record<string, unknown>) => {
      const base = {
        id: String(e.id),
        type: (e.type as EntityType) || "object",
        label: String(e.label ?? e.id),
        description: typeof e.description === "string" ? e.description : "",
        firstSection: sectionId,
      };
      // case-specific fields
      if (base.type === "case") {
        return {
          ...base,
          ...(e.source ? { source: String(e.source) } : {}),
          ...(e.client ? { client: String(e.client) } : {}),
          ...(e.crime_type ? { crime_type: String(e.crime_type) as Entity["crime_type"] } : {}),
          ...(e.outcome ? { outcome: String(e.outcome) as Entity["outcome"] } : {}),
          ...(e.primary_location ? { primary_location: String(e.primary_location) } : {}),
        };
      }
      // document-specific fields
      if (base.type === "document") {
        return {
          ...base,
          ...(e.document_type ? { document_type: String(e.document_type) as Entity["document_type"] } : {}),
          ...(e.from ? { from: String(e.from) } : {}),
          ...(e.to ? { to: String(e.to) } : {}),
          ...(e.content_summary ? { content_summary: String(e.content_summary) } : {}),
        };
      }
      // organisation-specific fields
      if (base.type === "organisation") {
        return {
          ...base,
          ...(e.org_type ? { org_type: String(e.org_type) as Entity["org_type"] } : {}),
        };
      }
      return base;
    });
    const events: ObjectiveEvent[] = (parsed.events ?? []).map((ev: Record<string, unknown>) => ({
      id: String(ev.id),
      type: "event" as const,
      label: String(ev.label ?? ev.id),
      section: sectionId,
      source_nodes: Array.isArray(ev.source_nodes) ? (ev.source_nodes as string[]) : [],
      participants: Array.isArray(ev.participants) ? (ev.participants as string[]) : [],
      performs: Array.isArray(ev.performs) ? (ev.performs as string[]) : undefined,
      communicates: ev.communicates && typeof ev.communicates === "object"
        ? {
            speaker: String((ev.communicates as Record<string, unknown>).speaker ?? ""),
            recipients: Array.isArray((ev.communicates as Record<string, unknown>).recipients)
              ? ((ev.communicates as Record<string, unknown>).recipients as string[])
              : [],
            content: String((ev.communicates as Record<string, unknown>).content ?? ""),
          }
        : undefined,
    }));
    const stateChanges = (parsed.stateChanges ?? []).map((sc: Record<string, unknown>) => ({
      from: String(sc.from),
      to: String(sc.to),
      type: sc.type as "IS_INSIDE" | "LOCATED_AT" | "OWNS",
      caused_by_event: String(sc.caused_by_event),
    }));
    const mentions: RawMention[] = (parsed.mentions ?? []).map((m: Record<string, unknown>) => ({
      entity: String(m.entity),
      sentence_ids: Array.isArray(m.sentence_ids) ? (m.sentence_ids as string[]) : [],
    }));
    const clues: RawClue[] = (parsed.clues ?? []).map((c: Record<string, unknown>) => ({
      object: String(c.object),
      case: String(c.case),
      discovered_by: String(c.discovered_by),
      significance: String(c.significance ?? ""),
      source_nodes: Array.isArray(c.source_nodes) ? (c.source_nodes as string[]) : [],
    }));
    const memberOf: RawMemberOf[] = (parsed.memberOf ?? []).map((m: Record<string, unknown>) => ({
      character: String(m.character),
      organisation: String(m.organisation),
    }));
    return { newEntities, events, stateChanges, mentions, clues, memberOf };
  } catch {
    console.error(`Failed to parse extraction for ${sectionId}:`, cleaned.slice(0, 400));
    return { newEntities: [], events: [], stateChanges: [], mentions: [], clues: [], memberOf: [] };
  }
}

export interface SectionProgress {
  index: number;
  total: number;
  sectionId: string;
  nodeCount: number;
  newEntities: number;
  totalEntities: number;
  sectionEvents: number;
  totalEvents: number;
  sectionStates: number;
  totalStates: number;
  elapsedMs: number;
}

type RawStateChange = { from: string; to: string; type: "IS_INSIDE" | "LOCATED_AT" | "OWNS"; caused_by_event: string; section: string };

interface Checkpoint {
  completedSections: string[];
  entities: Entity[];
  events: ObjectiveEvent[];
  stateChanges: RawStateChange[];
  mentions: Mention[];
  clues: Clue[];
  memberOf: MemberOf[];
}

export interface BuildObjectiveGraphOptions {
  onProgress?: (p: SectionProgress) => void;
  checkpointPath?: string;
}

// ── Build the full objective graph from a lexical graph ───────────────────

export async function buildObjectiveGraph(
  llm: BaseChatModel,
  lexical: LexicalGraph,
  options: BuildObjectiveGraphOptions | ((p: SectionProgress) => void) = {}
): Promise<ObjectiveGraph> {
  // Accept legacy positional callback for backwards compat
  const opts: BuildObjectiveGraphOptions =
    typeof options === "function" ? { onProgress: options } : options;
  const { onProgress, checkpointPath } = opts;

  const entities = new Map<string, Entity>();
  const events: ObjectiveEvent[] = [];
  const stateChanges: RawStateChange[] = [];
  const allMentions: Mention[] = [];
  const allClues: Clue[] = [];
  const allMemberOf: MemberOf[] = [];
  const completedSections = new Set<string>();

  // ── Restore from checkpoint if present ──────────────────────────────────
  if (checkpointPath && fs.existsSync(checkpointPath)) {
    const cp = JSON.parse(fs.readFileSync(checkpointPath, "utf-8")) as Checkpoint;
    for (const e of cp.entities) entities.set(e.id, e);
    events.push(...cp.events);
    stateChanges.push(...cp.stateChanges);
    allMentions.push(...(cp.mentions ?? []));
    allClues.push(...(cp.clues ?? []));
    allMemberOf.push(...(cp.memberOf ?? []));
    for (const s of cp.completedSections) completedSections.add(s);

    // Heal any dangling mention references inherited from older checkpoints
    // (mentions written before auto-promotion was added).
    const guessMentionType = (id: string): Entity["type"] => {
      if (id.startsWith("location_")) return "location";
      if (id.startsWith("object_")) return "object";
      if (id.startsWith("organisation_") || id.startsWith("organization_")) return "organisation";
      if (id.startsWith("document_")) return "document";
      if (id.startsWith("case_")) return "case";
      return "character";
    };
    for (const m of allMentions) {
      if (!entities.has(m.entity)) {
        entities.set(m.entity, {
          id: m.entity,
          type: guessMentionType(m.entity),
          label: m.entity.replace(/^[a-z]+_/, "").replace(/_/g, " "),
          firstSection: m.section,
        });
      }
    }
  }

  const activeSections = lexical.sections.filter(
    (s) => lexical.nodes.some((n) => n.section === s.id)
  );
  const pendingSections = activeSections.filter((s) => !completedSections.has(s.id));
  const total = activeSections.length;
  let doneCount = completedSections.size;

  for (const section of pendingSections) {
    const sectionNodes = lexical.nodes.filter((n) => n.section === section.id);

    const t0 = Date.now();
    const extraction = await extractSection(
      llm,
      section.id,
      sectionNodes.map((n) => ({ id: n.id, text: n.text })),
      Array.from(entities.values())
    );
    const elapsedMs = Date.now() - t0;

    let newEntityCount = 0;
    for (const e of extraction.newEntities) {
      if (!entities.has(e.id)) { entities.set(e.id, e); newEntityCount++; }
    }

    // Auto-create stub entities for dangling references in clues/memberOf.
    // The LLM may reference well-known things (e.g. "military", "scotland_yard")
    // without explicitly emitting them in newEntities.
    const ensureEntity = (id: string, type: Entity["type"], label?: string) => {
      if (id && !entities.has(id)) {
        const stub: Entity = { id, type, label: label ?? id.replace(/_/g, " "), firstSection: section.id };
        entities.set(id, stub);
        newEntityCount++;
      }
    };
    for (const c of extraction.clues) {
      ensureEntity(c.case, "case");
      ensureEntity(c.object, "object");
      ensureEntity(c.discovered_by, "character");
    }
    for (const m of extraction.memberOf) {
      ensureEntity(m.organisation, "organisation");
      ensureEntity(m.character, "character");
    }
    // Mentions can name entities the LLM didn't formally introduce.
    // Guess the type from id prefix when present; default to character.
    const guessMentionType = (id: string): Entity["type"] => {
      if (id.startsWith("location_")) return "location";
      if (id.startsWith("object_")) return "object";
      if (id.startsWith("organisation_") || id.startsWith("organization_")) return "organisation";
      if (id.startsWith("document_")) return "document";
      if (id.startsWith("case_")) return "case";
      return "character";
    };
    for (const m of extraction.mentions) ensureEntity(m.entity, guessMentionType(m.entity));

    for (const ev of extraction.events) events.push(ev);
    for (const sc of extraction.stateChanges) stateChanges.push({ ...sc, section: section.id });
    for (const m of extraction.mentions) {
      allMentions.push({ entity: m.entity, section: section.id, mention_count: m.sentence_ids.length, sentence_ids: m.sentence_ids });
    }
    for (const c of extraction.clues) {
      allClues.push({ object: c.object, case: c.case, discovered_by: c.discovered_by, discovered_in_section: section.id, significance: c.significance, source_nodes: c.source_nodes });
    }
    for (const m of extraction.memberOf) {
      allMemberOf.push({ character: m.character, organisation: m.organisation });
    }
    completedSections.add(section.id);
    doneCount++;

    // Write checkpoint after every section
    if (checkpointPath) {
      const cp: Checkpoint = {
        completedSections: Array.from(completedSections),
        entities: Array.from(entities.values()),
        events,
        stateChanges,
        mentions: allMentions,
        clues: allClues,
        memberOf: allMemberOf,
      };
      fs.writeFileSync(checkpointPath, JSON.stringify(cp, null, 2));
    }

    onProgress?.({
      index: doneCount,
      total,
      sectionId: section.id,
      nodeCount: sectionNodes.length,
      newEntities: newEntityCount,
      totalEntities: entities.size,
      sectionEvents: extraction.events.length,
      totalEvents: events.length,
      sectionStates: extraction.stateChanges.length,
      totalStates: stateChanges.length,
      elapsedMs,
    });
  }

  // ── Resolve state changes into validity windows ──────────────────────────
  // For each (from, to_or_target) pair of the same type, the latest one
  // remains open; previous ones close at the next state change.
  const stateEdges: StateEdge[] = [];

  // Group by (from, type) since e.g. marble can only be IS_INSIDE one thing at a time
  const byFromType = new Map<string, typeof stateChanges>();
  for (const sc of stateChanges) {
    const key = `${sc.from}::${sc.type}`;
    const arr = byFromType.get(key) ?? [];
    arr.push(sc);
    byFromType.set(key, arr);
  }

  let edgeCounter = 0;
  for (const [, changes] of byFromType) {
    // Already in document order because we iterated sections in order
    for (let i = 0; i < changes.length; i++) {
      const cur = changes[i];
      const next = changes[i + 1];
      stateEdges.push({
        id: `state_${++edgeCounter}`,
        from: cur.from,
        to: cur.to,
        type: cur.type,
        valid_from: cur.caused_by_event,
        valid_until: next?.caused_by_event,
        caused_by: [cur.caused_by_event],
      });
    }
  }

  // Deduplicate memberOf (same character+org pair emitted in multiple sections)
  const memberOfSet = new Set<string>();
  const dedupedMemberOf: MemberOf[] = [];
  for (const m of allMemberOf) {
    const key = `${m.character}::${m.organisation}`;
    if (!memberOfSet.has(key)) {
      memberOfSet.add(key);
      dedupedMemberOf.push(m);
    }
  }

  return {
    entities: Array.from(entities.values()),
    events,
    stateEdges,
    mentions: allMentions,
    clues: allClues,
    memberOf: dedupedMemberOf,
  };
}
