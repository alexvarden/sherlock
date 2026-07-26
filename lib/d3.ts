// ── Slim d3 barrel ────────────────────────────────────────────────────────
// The widgets import `* as d3` from here instead of the "d3" metapackage so
// the client bundle only carries the submodules we actually use. Importing
// "d3-transition" for its side effect patches selection.transition() in.
export * from "d3-selection";
export * from "d3-transition";
export * from "d3-force";
export * from "d3-zoom";
export * from "d3-drag";
export * from "d3-scale";
export * from "d3-axis";
export * from "d3-hierarchy";
export * from "d3-shape";
export * from "d3-array";
