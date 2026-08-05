/**
 * Check the SQL query layer against the Neo4j baseline in data/parity/.
 *
 * Replays every query recorded in the manifest against lib/graph-query.ts (now
 * SQL) and compares canonical hashes. Neo4j is not consulted, and can no longer
 * be: the capture script and the Cypher implementation were deleted in Stage 5,
 * so this baseline is frozen. See data/parity/README.md for what to do when it
 * starts failing — in particular, do NOT recapture it against the SQL
 * implementation, which would be a baseline taken from the system under test.
 *
 * Also asserts the orderings that parity-canonical.ts deliberately normalises
 * away. Those are sorted before hashing because neither system guaranteed them,
 * but the SQL side does now guarantee them, and that guarantee should be
 * checked rather than assumed.
 *
 *   npm run parity:check
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { listStories, getStoryData, getCharacterContext, getEntityStateAt } from "../lib/graph-query";
import { hash } from "./parity-canonical";

type Entry = {
  query: string;
  args: Record<string, unknown>;
  hash: string;
  summary?: Record<string, number>;
};

const MANIFEST = path.join(process.cwd(), "data/parity/manifest.json");

let checked = 0;
let failed = 0;
const failures: string[] = [];

function compare(entry: Entry, actual: unknown) {
  checked++;
  const got = hash(actual);
  if (got === entry.hash) return;
  failed++;
  const args = JSON.stringify(entry.args);
  failures.push(`${entry.query}(${args})\n      baseline ${entry.hash}  actual ${got}`);
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    capturedAt: string;
    entries: Entry[];
  };

  console.log(`Baseline captured ${manifest.capturedAt} · ${manifest.entries.length} queries\n`);

  // Cache story payloads: getStoryData is the expensive one and several
  // structural checks reuse it.
  const storyCache = new Map<string, Awaited<ReturnType<typeof getStoryData>>>();

  for (const entry of manifest.entries) {
    const a = entry.args as { story?: string; characterId?: string; sectionId?: string; entityId?: string; sectionIndex?: number };

    switch (entry.query) {
      case "listStories":
        compare(entry, await listStories());
        break;

      case "getStoryData": {
        const data = await getStoryData(a.story!);
        storyCache.set(a.story!, data);
        compare(entry, data);
        break;
      }

      case "getCharacterContext":
        compare(entry, await getCharacterContext(a.story!, a.characterId!, a.sectionId!));
        break;

      case "getEntityStateAt":
        compare(entry, { entityState: await getEntityStateAt(a.story!, a.entityId!, a.sectionIndex!) });
        break;

      default:
        throw new Error(`Unknown query in manifest: ${entry.query}`);
    }
  }

  console.log(`Hash parity: ${checked - failed}/${checked} queries match`);
  if (failed) {
    console.log("");
    for (const f of failures.slice(0, 20)) console.log(`  ✗ ${f}`);
    if (failures.length > 20) console.log(`  … and ${failures.length - 20} more`);
  }

  // ── Structural checks ─────────────────────────────────────────────────────
  // The orderings the canonicaliser sorts away, asserted directly.
  console.log("");
  let structural = 0;
  let structuralFailed = 0;

  for (const [slug, data] of storyCache) {
    if (!data) continue;

    const check = (label: string, ok: boolean) => {
      structural++;
      if (!ok) {
        structuralFailed++;
        console.log(`  ✗ ${slug}: ${label}`);
      }
    };

    check(
      "sections ordered by index",
      data.lexical.sections.every((s, i, arr) => i === 0 || arr[i - 1].index <= s.index)
    );
    check(
      "lexical nodes ordered by position",
      data.lexical.nodes.every((n, i, arr) => i === 0 || arr[i - 1].position <= n.position)
    );

    // Events must come back in section order. The hash can't see this because
    // ties were arbitrary in Neo4j, so it is checked here instead.
    const sectionIndex = new Map(data.lexical.sections.map((s) => [s.id, s.index]));
    const eventPositions = data.objective.events.map((e) => sectionIndex.get(e.section) ?? -1);
    check(
      "events ordered by section index",
      eventPositions.every((p, i, arr) => i === 0 || arr[i - 1] <= p)
    );
  }

  console.log(`Structural: ${structural - structuralFailed}/${structural} ordering checks pass`);
  console.log("");

  if (failed || structuralFailed) {
    console.error(`compare-parity: FAILED — ${failed} hash, ${structuralFailed} structural`);
    process.exit(1);
  }
  console.log("compare-parity: SQL output is identical to the Neo4j baseline");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("compare-parity: failed");
    console.error(err);
    process.exit(1);
  });
