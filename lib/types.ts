// ── Shared schemas for the three-layer narrative pipeline ───────────────────
// See docs/ingest-architecture.md for design rationale.

// ── Layer 1: Lexical ──────────────────────────────────────────────────────

export interface LexicalNode {
  id: string;          // "sentence_12" or "para_3"
  section: string;     // "section_1"
  position: number;    // global ordering across the story
  text: string;
  entities: string[];  // entity ids mentioned (filled by Layer 2 extraction)
}

export interface SectionMeta {
  id: string;          // "section_1"
  index: number;
  title: string;
  wordCount: number;
}

export interface LexicalGraph {
  granularity: "sentence" | "paragraph";
  sections: SectionMeta[];
  nodes: LexicalNode[];
}

// ── Layer 2: Objective ────────────────────────────────────────────────────

export type EntityType = "character" | "object" | "location" | "case" | "document" | "organisation";

export type CrimeType = "murder" | "theft" | "blackmail" | "forgery" | "kidnapping" | "disappearance" | "other";
export type CaseOutcome = "solved" | "unsolved" | "unresolved";
export type DocumentType = "letter" | "telegram" | "newspaper" | "note" | "cipher" | "manuscript";
export type OrgType = "law_enforcement" | "criminal_network" | "club" | "religious" | "commercial" | "other";

export interface Entity {
  id: string;
  type: EntityType;
  label: string;
  description?: string;
  firstSection: string;
  // case-specific fields
  source?: string;            // novel/story slug
  client?: string;            // character_id
  crime_type?: CrimeType;
  outcome?: CaseOutcome;
  primary_location?: string;  // location entity_id
  // document-specific fields
  document_type?: DocumentType;
  from?: string;              // entity_id (sender)
  to?: string;                // entity_id (recipient)
  content_summary?: string;
  // organisation-specific fields
  org_type?: OrgType;
}

export type EventEdgeType =
  | "IS_INSIDE"
  | "LOCATED_AT"
  | "OWNS"
  | "MOVES"
  | "PERFORMS"
  | "AFFECTS"
  | "COMMUNICATES";

export interface ObjectiveEvent {
  id: string;
  type: "event";
  label: string;
  section: string;
  source_nodes: string[];   // lexical_node ids
  participants: string[];   // entity ids present at the event
  performs?: string[];      // entity ids that performed the action
  // For COMMUNICATES events:
  communicates?: {
    speaker: string;
    recipients: string[];
    content: string;        // the claim made (may be true or false)
  };
}

export interface StateEdge {
  id: string;
  from: string;             // entity id
  to: string;               // entity id
  type: Exclude<EventEdgeType, "PERFORMS" | "MOVES" | "AFFECTS" | "COMMUNICATES">;
  valid_from: string;       // event_id that began this state
  valid_until?: string;     // event_id that ended this state (omitted if still valid at story end)
  caused_by: string[];      // event_ids
}

export interface Mention {
  entity: string;             // entity_id
  section: string;            // section_id
  mention_count: number;
  sentence_ids: string[];     // lexical_node ids
}

export interface Clue {
  object: string;             // object entity_id
  case: string;               // case entity_id
  discovered_by: string;      // character entity_id
  discovered_in_section: string;
  significance: string;       // the inference attributed to a character
  source_nodes: string[];     // lexical_node ids
}

export interface MemberOf {
  character: string;          // character entity_id
  organisation: string;       // organisation entity_id
  valid_from?: string;        // event_id
  valid_until?: string;       // event_id
}

export interface ObjectiveGraph {
  entities: Entity[];
  events: ObjectiveEvent[];
  stateEdges: StateEdge[];
  mentions: Mention[];
  clues: Clue[];
  memberOf: MemberOf[];
}

// ── Layer 3: Derived character states ─────────────────────────────────────

export type Modality = "OBSERVED" | "TOLD" | "INFERRED" | "ASSUMED";

export interface KnowledgeItem {
  id: string;
  description: string;            // human-readable for UI; resolved from event labels
  modality: Modality;
  confidence: number;             // 0–1
  based_on_events: string[];      // event_ids grounding this knowledge
}

export interface CharacterState {
  character: string;              // entity id
  section: string;                // section_id
  observations: KnowledgeItem[];
  beliefs: KnowledgeItem[];       // derived from TOLD events; may be false
  deductions: KnowledgeItem[];    // INFERRED — populated at query-time by LLM (empty in v1 deterministic builder)
  emotional_state?: string;
}

// ── Story metadata ────────────────────────────────────────────────────────

export interface StoryMeta {
  slug: string;
  name: string;
  sourceFile: string;
}

// ── Demo examples ─────────────────────────────────────────────────────────

export interface DemoExample {
  id: string;
  character: string;
  section: string;
  question: string;
  expectedTheme?: string;         // hand-curated note for the curator's eye
}
