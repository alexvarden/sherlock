// ── Server-only data loader for the /read (interactive reader) tool ──────────
// Exposed as `@crane/sherlock/read-data`. Reads static JSON from data/processed
// via fs, resolved relative to THIS module (not process.cwd()), so it works when
// consumed from a host app (crane-ai). Never import from a client component.
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Entity, LexicalGraph, ObjectiveGraph, StoryMeta } from "./types";

const DATA_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "processed");

function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

/** Stories that have a lexical.json ready to read. */
export function listReadableStories(): StoryMeta[] {
  if (!existsSync(DATA_ROOT)) return [];
  return readdirSync(DATA_ROOT)
    .filter((name) => {
      const d = path.join(DATA_ROOT, name);
      return statSync(d).isDirectory() && existsSync(path.join(d, "lexical.json"));
    })
    .flatMap((name) => {
      const meta = readJson<StoryMeta>(path.join(DATA_ROOT, name, "meta.json"));
      return meta ? [meta] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface ReadData {
  meta: StoryMeta;
  lexical: LexicalGraph;
  charactersBySection: Record<string, Entity[]>;
}

/** Full reader payload for one story: lexical text + per-section character presence. */
export function getReadData(slug: string): ReadData | null {
  const stories = listReadableStories();
  const meta = stories.find((s) => s.slug === slug);
  if (!meta) return null;

  const storyDir = path.join(DATA_ROOT, meta.slug);
  const lexical = readJson<LexicalGraph>(path.join(storyDir, "lexical.json"));
  if (!lexical) return null;
  const objective = readJson<ObjectiveGraph>(path.join(storyDir, "objective-graph.json"));

  const charactersBySection: Record<string, Entity[]> = {};
  if (objective) {
    const charMap = new Map(
      objective.entities.filter((e) => e.type === "character").map((e) => [e.id, e])
    );
    for (const event of objective.events) {
      const bucket = (charactersBySection[event.section] ??= []);
      for (const pid of event.participants) {
        const char = charMap.get(pid);
        if (char && !bucket.find((c) => c.id === pid)) bucket.push(char);
      }
    }
  }

  return { meta, lexical, charactersBySection };
}
