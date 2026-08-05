/**
 * Debugging companion to compare-parity.ts: when a getStoryData hash fails,
 * this says WHICH collection diverged and shows the first differing element.
 * Not part of the gate; kept because it turns a failing hash into a fix.
 *
 *   npx tsx --env-file=.env scripts/diff-parity.ts silver-blaze
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getStoryData } from "../lib/graph-query";
import { canonicalise, hash } from "./parity-canonical";

const slug = process.argv[2] ?? "silver-blaze";

async function main() {
  const baseline = JSON.parse(
    readFileSync(path.join(process.cwd(), "data/parity/full", `${slug}.json`), "utf8")
  );
  const actual = canonicalise(await getStoryData(slug)) as Record<string, never>;

  const groups: [string, unknown, unknown][] = [
    ["lexical.granularity", baseline.lexical.granularity, (actual as never as { lexical: { granularity: unknown } }).lexical.granularity],
    ["lexical.sections", baseline.lexical.sections, (actual as never as { lexical: { sections: unknown } }).lexical.sections],
    ["lexical.nodes", baseline.lexical.nodes, (actual as never as { lexical: { nodes: unknown } }).lexical.nodes],
  ];

  for (const key of ["entities", "events", "stateEdges", "mentions", "clues", "memberOf"]) {
    groups.push([
      `objective.${key}`,
      baseline.objective[key],
      (actual as never as { objective: Record<string, unknown> }).objective[key],
    ]);
  }

  for (const [label, b, a] of groups) {
    const hb = hash(b);
    const ha = hash(a);
    const bn = Array.isArray(b) ? b.length : "-";
    const an = Array.isArray(a) ? a.length : "-";
    console.log(`${ha === hb ? "✓" : "✗"} ${label.padEnd(22)} baseline ${String(bn).padStart(6)}  actual ${String(an).padStart(6)}`);

    if (ha !== hb && Array.isArray(b) && Array.isArray(a)) {
      // Show the first element that differs.
      const n = Math.max(b.length, a.length);
      for (let i = 0; i < n; i++) {
        const sb = JSON.stringify(b[i]);
        const sa = JSON.stringify(a[i]);
        if (sb !== sa) {
          console.log(`    first diff at [${i}]:`);
          console.log(`      baseline: ${sb}`);
          console.log(`      actual:   ${sa}`);
          break;
        }
      }
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
