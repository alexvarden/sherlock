export const dynamic = "force-dynamic";

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import path from "path";
import Link from "next/link";
import CraneHeader from "@/components/CraneHeader";
import CraneFooter from "@/components/CraneFooter";
import DemoExampleRunner from "@/components/DemoExampleRunner";
import type { DemoExample, LexicalGraph, ObjectiveGraph, StoryMeta } from "@/lib/types";

function readJsonIfExists<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

interface StoryWithExamples {
  meta: StoryMeta;
  examples: DemoExample[];
  lexical: LexicalGraph | null;
  objective: ObjectiveGraph | null;
}

function listStoriesWithExamples(): StoryWithExamples[] {
  const dir = path.join(process.cwd(), "data/processed");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .flatMap((name) => {
      const storyDir = path.join(dir, name);
      const meta = readJsonIfExists<StoryMeta>(path.join(storyDir, "meta.json"));
      const examples = readJsonIfExists<DemoExample[]>(path.join(storyDir, "examples.json"));
      if (!meta || !examples || examples.length === 0) return [];
      return [{
        meta,
        examples,
        lexical: readJsonIfExists<LexicalGraph>(path.join(storyDir, "lexical.json")),
        objective: readJsonIfExists<ObjectiveGraph>(path.join(storyDir, "objective-graph.json")),
      }];
    })
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name));
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ story?: string }>;
}) {
  const { story: slug } = await searchParams;
  const stories = listStoriesWithExamples();

  if (stories.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-dark-950 text-dark-300">
        <div className="text-center space-y-4 max-w-md">
          <h1 className="text-2xl font-semibold">No demo examples yet</h1>
          <p className="text-dark-400">
            Add an <code className="bg-dark-800 text-crimson-300 font-mono px-1.5 py-0.5 rounded">examples.json</code> file to a processed story directory.
          </p>
        </div>
      </div>
    );
  }

  const selected = stories.find((s) => s.meta.slug === slug) ?? stories[0];

  return (
    <div className="min-h-screen bg-dark-950 text-dark-100">
      <CraneHeader
        crumbs={[{ label: "Q&A" }]}
        right={
          <Link
            href={`/graph?story=${selected.meta.slug}`}
            className="text-xs text-dark-400 hover:text-dark-200 px-3 py-1.5 border border-dark-800 rounded hover:border-dark-600 transition-colors"
          >
            View graph →
          </Link>
        }
      />

      <div className="max-w-7xl mx-auto px-8 py-16 space-y-12">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight mb-3">Character Q&A — graph-grounded RAG</h1>
          <p className="text-dark-400 leading-relaxed max-w-2xl">
            Each example below asks a character a question at a specific point in the story.
            The character can only answer based on what they observed or were told <em>up to that section</em>.
            No vector search — retrieval is graph traversal filtered by character + time.
          </p>
        </div>

        {/* Story tabs */}
        {stories.length > 1 && (
          <div className="flex gap-2 border-b border-dark-800">
            {stories.map((s) => (
              <Link
                key={s.meta.slug}
                href={`/demo?story=${s.meta.slug}`}
                className={`px-4 py-2 text-sm transition-colors ${
                  s.meta.slug === selected.meta.slug
                    ? "text-crimson-300 border-b-2 border-crimson-500 -mb-px"
                    : "text-dark-500 hover:text-dark-200"
                }`}
              >
                {s.meta.name}
                <span className="ml-1.5 text-xs text-dark-600">{s.examples.length}</span>
              </Link>
            ))}
          </div>
        )}

        {!selected.objective ? (
          <div className="bg-crimson-950/40 border border-crimson-900/60 rounded-xl px-4 py-3 text-sm text-crimson-200">
            <p>This story has examples but no objective graph yet.</p>
            <pre className="mt-2 text-xs font-mono">npm run ingest -- {selected.meta.slug}</pre>
          </div>
        ) : (
          <div className="space-y-8">
            {selected.examples.map((ex) => (
              <DemoExampleRunner
                key={ex.id}
                slug={selected.meta.slug}
                example={ex}
                objective={selected.objective!}
                lexical={selected.lexical}
              />
            ))}
          </div>
        )}
      </div>

      <CraneFooter />
    </div>
  );
}
