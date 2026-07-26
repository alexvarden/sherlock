// ── Server-only data loader for the /demo (Character Q&A) tool ───────────────
// Exposed as `@crane/sherlock/demo-data`. Reads static JSON from data/processed
// via fs, resolved relative to THIS module (not process.cwd()), so it works when
// consumed from a host app (crane-ai) whose cwd is apps/web. Never import from a
// client component. Mirrors the DATA_ROOT pattern in post0-data.ts.
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { DemoExample, LexicalGraph, ObjectiveGraph, StoryMeta } from "./types";

const DATA_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "processed");

function readJsonIfExists<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export interface StoryWithExamples {
  meta: StoryMeta;
  examples: DemoExample[];
  lexical: LexicalGraph | null;
  objective: ObjectiveGraph | null;
}

/** Stories that ship a non-empty examples.json, with their graph data. */
export function listStoriesWithExamples(): StoryWithExamples[] {
  if (!existsSync(DATA_ROOT)) return [];
  return readdirSync(DATA_ROOT)
    .filter((name) => statSync(path.join(DATA_ROOT, name)).isDirectory())
    .flatMap((name) => {
      const storyDir = path.join(DATA_ROOT, name);
      const meta = readJsonIfExists<StoryMeta>(path.join(storyDir, "meta.json"));
      const examples = readJsonIfExists<DemoExample[]>(path.join(storyDir, "examples.json"));
      if (!meta || !examples || examples.length === 0) return [];
      return [
        {
          meta,
          examples,
          lexical: readJsonIfExists<LexicalGraph>(path.join(storyDir, "lexical.json")),
          objective: readJsonIfExists<ObjectiveGraph>(path.join(storyDir, "objective-graph.json")),
        },
      ];
    })
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name));
}
