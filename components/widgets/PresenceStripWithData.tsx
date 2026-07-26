"use client";

import PresenceStrip from "./PresenceStrip";
import presenceData from "../../lib/derived/presence-strip-data";
import type { WorkSummary } from "../../lib/canon-types";

// Binds the strip to the derived presence payload. Kept as its own module so
// the payload is bundled into this lazily-loaded chunk (see PresenceStripLazy)
// rather than the article's critical path.
export default function PresenceStripWithData({ works }: { works: WorkSummary[] }) {
  return <PresenceStrip works={works} entities={presenceData.entities} presence={presenceData.presence} />;
}
