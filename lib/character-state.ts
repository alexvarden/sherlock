import type {
  CharacterState,
  KnowledgeItem,
  ObjectiveGraph,
  ObjectiveEvent,
  SectionMeta,
} from "./types";

// ── Section ordering helper ───────────────────────────────────────────────

function sectionIndex(sections: SectionMeta[], id: string): number {
  return sections.findIndex((s) => s.id === id);
}

// ── Filter events visible up to (and including) a section ────────────────

export function getEventsUpTo(
  graph: ObjectiveGraph,
  sections: SectionMeta[],
  upToSection: string
): ObjectiveEvent[] {
  const cutoff = sectionIndex(sections, upToSection);
  if (cutoff < 0) return [];
  return graph.events.filter((e) => sectionIndex(sections, e.section) <= cutoff);
}

// ── Build a deterministic character state ─────────────────────────────────
// v1: derives OBSERVED + TOLD only. INFERRED/ASSUMED are populated at
// query-time by the LLM (Stage D), not here.

export function buildCharacterState(
  characterId: string,
  sectionId: string,
  graph: ObjectiveGraph,
  sections: SectionMeta[]
): CharacterState {
  const events = getEventsUpTo(graph, sections, sectionId);

  const observations: KnowledgeItem[] = [];
  const beliefs: KnowledgeItem[] = [];

  for (const event of events) {
    const wasPresent = event.participants.includes(characterId);
    if (wasPresent) {
      observations.push({
        id: `obs_${event.id}_${characterId}`,
        description: event.label,
        modality: "OBSERVED",
        confidence: 1.0,
        based_on_events: [event.id],
      });
    }

    if (event.communicates && event.communicates.recipients.includes(characterId)) {
      // Even if the character was also present, the communicated content is a
      // separate piece of knowledge — they may have been told something they
      // didn't directly observe (or that contradicts observation).
      beliefs.push({
        id: `belief_${event.id}_${characterId}`,
        description: event.communicates.content,
        modality: "TOLD",
        confidence: 0.7,
        based_on_events: [event.id],
      });
    }
  }

  return {
    character: characterId,
    section: sectionId,
    observations,
    beliefs,
    deductions: [],
  };
}

// ── Resolve which entities are characters ─────────────────────────────────

export function listCharacters(graph: ObjectiveGraph): string[] {
  return graph.entities.filter((e) => e.type === "character").map((e) => e.id);
}
