// ── Shared types + constants for canon analysis ─────────────────────────
// Safe to import from client components — no Node-only dependencies.

export const CANON_SLUGS = [
  "a-study-in-scarlet",
  "sign-of-the-four",
  "silver-blaze",
  "yellow-face",
  "stockbrokers-clerk",
  "gloria-scott",
  "musgrave-ritual",
  "reigate-squires",
  "crooked-man",
  "resident-patient",
  "greek-interpreter",
  "naval-treaty",
  "final-problem",
  "cardboard-box",
  "hound-of-the-baskervilles",
  "valley-of-fear",
  "a-case-of-identity",
] as const;

// Publication date with Memoirs slotted between Sign and Hound.
export const IN_UNIVERSE_ORDER: readonly string[] = [
  "a-study-in-scarlet",
  "a-case-of-identity",
  "sign-of-the-four",
  "silver-blaze",
  "cardboard-box",
  "yellow-face",
  "stockbrokers-clerk",
  "gloria-scott",
  "musgrave-ritual",
  "reigate-squires",
  "crooked-man",
  "resident-patient",
  "greek-interpreter",
  "naval-treaty",
  "final-problem",
  "hound-of-the-baskervilles",
  "valley-of-fear",
];

export interface WorkSummary {
  slug: string;
  name: string;
  sentenceCount: number;
  sectionCount: number;
  wordCount: number;
  entityCount: number;
  mentionCount: number;
  eventCount: number;
}

export interface EntitySummary {
  key: string;
  label: string;
  type: string;
  totalMentions: number;
  works: string[];
}

export interface PresenceMark {
  position: number;
  sentenceText: string;
  rawIndex: number;
}

export interface PresenceForEntity {
  byWork: Record<string, PresenceMark[]>;
}

export interface SearchSentence {
  workSlug: string;
  workName: string;
  position: number;
  rawIndex: number;
  text: string;
}

export interface CoOccurrenceEdge {
  a: string;
  b: string;
  weight: number;
}

export interface TrajectorySegment {
  characterKey: string;
  characterLabel: string;
  locationKey: string;
  locationLabel: string;
  fromEventIndex: number;
  toEventIndex: number;
}

export interface TrajectoryWork {
  slug: string;
  name: string;
  eventCount: number;
  segments: TrajectorySegment[];
}

export interface FrequencyNode {
  key: string;
  label: string;
  count: number;
  works: number;
}

export interface FrequencyByType {
  type: string;
  total: number;
  items: FrequencyNode[];
}

export interface CanonData {
  works: WorkSummary[];
  entities: EntitySummary[];
  presence: Record<string, PresenceForEntity>;
  sentences: SearchSentence[];
  coOccurrence: CoOccurrenceEdge[];
  trajectories: TrajectoryWork[];
  frequency: FrequencyByType[];
}
