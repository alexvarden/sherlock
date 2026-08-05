// ── Server-only data barrel for the-game-is-afoot article page ───────────
// Exposed as `@crane/sherlock/data`. These loaders read static JSON from
// data/processed via fs — never import this from a client component. The
// widgets (the package's "." entry) are the client-side counterpart.

export { loadCanonData } from "./canon-aggregate";
export {
  loadSamplePassage,
  loadReconciliationData,
  loadSqlDemos,
  loadSampleClue,
  loadGraphViewerData,
} from "./game-is-afoot-data";

export type {
  PassageData,
  ReconciliationData,
  SqlDemo,
  SampleClue,
  GraphViewerData,
} from "./game-is-afoot-data";
export type { CanonData } from "./canon-types";
