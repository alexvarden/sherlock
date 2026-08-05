/**
 * Capture the Neo4j query-layer baseline as committed fixtures.
 *
 * Aura is paused, so the local Neo4j container is the only surviving baseline
 * for the Postgres migration — and Stage 5 deletes the Neo4j code entirely.
 * This freezes what the current query layer returns, so Stage 2 can prove the
 * SQL rewrite is equivalent long after there is anything left to compare
 * against.
 *
 * What gets written to data/parity/:
 *
 *   manifest.json   every query, its arguments, and a hash of its result
 *   stories.json    listStories() in full (small, and load-bearing —
 *                   it encodes the canon filter and in-universe ordering)
 *   full/*.json     complete payloads for three representative works
 *
 * Hashes cover all 17 works; full payloads are limited to three because
 * getStoryData returns every sentence of the corpus, and committing all of it
 * would add tens of megabytes to a public repo for no extra signal. When a
 * hash fails, the full payload for that work can be regenerated on the spot
 * from data/processed — which is the source of truth either way.
 *
 *   npm run parity:capture
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CANON_SLUGS } from "../lib/canon-types";
import { listStories, getStoryData, getCharacterContext, getEntityStateAt } from "./legacy-neo4j-query";
import { canonicalJson, hash } from "./parity-canonical";

const OUT = path.join(process.cwd(), "data/parity");

// One novel, one short story, and the recalibrated work — the three shapes
// most likely to expose a difference.
const FULL_PAYLOAD_SLUGS = ["hound-of-the-baskervilles", "silver-blaze", "a-case-of-identity"];

type Entry = { query: string; args: Record<string, unknown>; hash: string; summary?: Record<string, number> };

async function main() {
  mkdirSync(path.join(OUT, "full"), { recursive: true });
  const entries: Entry[] = [];

  // ── listStories ──────────────────────────────────────────────────
  const stories = await listStories();
  writeFileSync(path.join(OUT, "stories.json"), canonicalJson(stories) + "\n");
  entries.push({ query: "listStories", args: {}, hash: hash(stories) });
  console.log(`listStories… ${stories.length} works`);

  for (const slug of CANON_SLUGS) {
    // ── getStoryData ────────────────────────────────────────────────────────
    const data = await getStoryData(slug);
    if (!data) {
      console.warn(`  ⚠ ${slug}: getStoryData returned null — skipping`);
      continue;
    }

    entries.push({
      query: "getStoryData",
      args: { story: slug },
      hash: hash(data),
      summary: {
        sections: data.lexical.sections.length,
        nodes: data.lexical.nodes.length,
        entities: data.objective.entities.length,
        events: data.objective.events.length,
        stateEdges: data.objective.stateEdges.length,
        mentions: data.objective.mentions.length,
        clues: data.objective.clues.length,
        memberOf: data.objective.memberOf.length,
      },
    });

    if (FULL_PAYLOAD_SLUGS.includes(slug)) {
      writeFileSync(path.join(OUT, "full", `${slug}.json`), canonicalJson(data) + "\n");
    }

    // ── getCharacterContext ─────────────────────────────────────────────────
    // Deterministic sample: the two alphabetically-first characters, at the
    // first, middle and last section. The section sweep is the point — it is
    // the temporal cutoff that the whole perspective model rests on.
    const characters = data.objective.entities
      .filter((e) => e.type === "character")
      .map((e) => e.id)
      .sort()
      .slice(0, 2);

    const sections = data.lexical.sections;
    const sampleSections = [
      sections[0],
      sections[Math.floor(sections.length / 2)],
      sections[sections.length - 1],
    ].filter(Boolean);

    for (const characterId of characters) {
      for (const section of sampleSections) {
        const ctx = await getCharacterContext(slug, characterId, section.id);
        entries.push({
          query: "getCharacterContext",
          args: { story: slug, characterId, sectionId: section.id },
          hash: hash(ctx),
          summary: {
            observations: ctx.state.observations.length,
            beliefs: ctx.state.beliefs.length,
            visibleEvents: ctx.visibleEvents.length,
          },
        });
      }
    }

    // ── getEntityStateAt ────────────────────────────────────────────────────
    // Entities that actually carry state edges, at a sweep of section indices,
    // so the validity-window boundaries are exercised rather than just the
    // middle of a window.
    const stateful = [...new Set(data.objective.stateEdges.map((e) => e.from))].sort().slice(0, 3);
    const indices = [0, Math.floor(sections.length / 2), sections.length - 1];

    for (const entityId of stateful) {
      for (const idx of indices) {
        const state = await getEntityStateAt(slug, entityId, idx);
        entries.push({
          query: "getEntityStateAt",
          args: { story: slug, entityId, sectionIndex: idx },
          hash: hash({ entityState: state }),
          summary: { results: state.length },
        });
      }
    }

    console.log(`${slug}… ${data.lexical.nodes.length} lexical · ${data.objective.events.length} events`);
  }

  writeFileSync(
    path.join(OUT, "manifest.json"),
    canonicalJson({
      capturedAt: new Date().toISOString().slice(0, 10),
      source: "local Neo4j (bolt://localhost:7687)",
      note: "Baseline for the Neo4j -> Neon Postgres migration. Regenerate only if the canon data changes.",
      entries,
    }) + "\n"
  );

  console.log("");
  console.log(`Captured ${entries.length} query results to data/parity/`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("capture-parity: failed");
    console.error(err);
    process.exit(1);
  });
