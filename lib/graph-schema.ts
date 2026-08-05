// Schema-as-data. The viewer + migration read from these tables instead of
// hard-coding entity/edge types in switch statements. Adding a new type is a
// single entry here (plus the matching field in `Entity` / `ObjectiveGraph`
// if it carries new properties).

import type { EntityType } from "./types";

// ── Entity types ──────────────────────────────────────────────────────────

export interface EntityTypeSpec {
  id: EntityType;
  label: string;       // UI label shown in filter pills and detail panel
  color: string;       // hex — used for node fill, type pill, edge-anchor accents
  radius: number;      // d3 force-simulation circle radius
}

export const entityTypes: EntityTypeSpec[] = [
  { id: "character",    label: "Character",    color: "#e11d48", radius: 18 },
  { id: "location",     label: "Location",     color: "#a855f7", radius: 12 },
  { id: "object",       label: "Object",       color: "#6b7280", radius: 12 },
  { id: "case",         label: "Case",         color: "#f59e0b", radius: 14 },
  { id: "document",     label: "Document",     color: "#06b6d4", radius: 12 },
  { id: "organisation", label: "Organisation", color: "#10b981", radius: 14 },
];

export const entityTypeById: Map<EntityType, EntityTypeSpec> =
  new Map(entityTypes.map((t) => [t.id, t]));

// ── Edge types ────────────────────────────────────────────────────────────
// `kind` is the discriminator on `SimLink` in the viewer. Each spec carries
// the active and (optionally) past visual styling. If `pastColor` is omitted
// the active styling is used regardless of validity window.

export type LinkKind = "state" | "participation" | "communicates" | "clue" | "member";

export interface EdgeTypeSpec {
  kind: LinkKind;
  label: string;
  color: string;
  pastColor?: string;
  width: number;
  dash?: string;        // SVG dasharray, "none" or omitted = solid
  pastDash?: string;
  opacity: number;
  pastOpacity?: number;
  arrow: boolean;       // whether to draw an arrowhead
  forceDistance: number; // d3 link distance
}

export const edgeTypes: Record<LinkKind, EdgeTypeSpec> = {
  state: {
    kind: "state",
    label: "State",
    color: "#a19a9a",
    pastColor: "#262323",
    width: 2,
    dash: "none",
    pastDash: "4,3",
    opacity: 0.85,
    pastOpacity: 0.35,
    arrow: true,
    forceDistance: 140,
  },
  participation: {
    kind: "participation",
    label: "Witness",
    color: "#6b6464",
    width: 1.4,
    dash: "2,3",
    opacity: 0.75,
    arrow: false,
    forceDistance: 70,
  },
  communicates: {
    kind: "communicates",
    label: "Communicates",
    color: "#F1C40F",
    width: 1.6,
    opacity: 0.9,
    arrow: true,
    forceDistance: 110,
  },
  clue: {
    kind: "clue",
    label: "Clue",
    color: "#f59e0b",
    width: 1.8,
    dash: "6,2",
    opacity: 0.9,
    arrow: true,
    forceDistance: 120,
  },
  member: {
    kind: "member",
    label: "Member",
    color: "#10b981",
    pastColor: "#1f3a30",
    width: 1.6,
    dash: "none",
    pastDash: "4,3",
    opacity: 0.85,
    pastOpacity: 0.4,
    arrow: true,
    forceDistance: 120,
  },
};

// ── Helpers for the viewer ────────────────────────────────────────────────

export function edgeStroke(kind: LinkKind, active: boolean): string {
  const s = edgeTypes[kind];
  return !active && s.pastColor ? s.pastColor : s.color;
}

export function edgeOpacity(kind: LinkKind, active: boolean): number {
  const s = edgeTypes[kind];
  return !active && s.pastOpacity !== undefined ? s.pastOpacity : s.opacity;
}

export function edgeDash(kind: LinkKind, active: boolean): string | null {
  const s = edgeTypes[kind];
  const d = !active && s.pastDash !== undefined ? s.pastDash : s.dash;
  return d && d !== "none" ? d : null;
}
