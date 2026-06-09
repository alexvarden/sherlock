// ── Server-only data barrel for the Post 0 article page ──────────────────
// Exposed as `@crane/sherlock/data`. These loaders read static JSON from
// data/processed via fs — never import this from a client component. The
// widgets (the package's "." entry) are the client-side counterpart.

export { loadCanonData } from "./canon-aggregate";
export {
  loadSamplePassage,
  loadReconciliationData,
  loadCypherDemos,
} from "./post0-data";

export type {
  PassageData,
  ReconciliationData,
  CypherDemo,
} from "./post0-data";
export type { CanonData } from "./canon-types";
