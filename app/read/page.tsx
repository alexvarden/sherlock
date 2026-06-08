export const dynamic = "force-dynamic";

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import path from "path";
import Link from "next/link";
import CraneHeader from "@/components/CraneHeader";
import CraneFooter from "@/components/CraneFooter";
import StoryReader from "@/components/StoryReader";
import type { Entity, LexicalGraph, ObjectiveGraph, StoryMeta } from "@/lib/types";

function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

// Only include stories that have a lexical.json ready to read
function listReadableStories(): StoryMeta[] {
  const dir = path.join(process.cwd(), "data/processed");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => {
      const d = path.join(dir, name);
      return (
        statSync(d).isDirectory() &&
        existsSync(path.join(d, "lexical.json"))
      );
    })
    .flatMap((name) => {
      const meta = readJson<StoryMeta>(path.join(dir, name, "meta.json"));
      return meta ? [meta] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function StorySelectorPage({ stories }: { stories: StoryMeta[] }) {
  return (
    <div className="min-h-screen bg-dark-950 text-dark-100 flex flex-col">
      <CraneHeader crumbs={[{ label: "Read" }]} />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-8 max-w-lg px-6">
          <div>
            <h1 className="text-2xl font-semibold mb-2">Choose a story</h1>
            {stories.length === 0 && (
              <p className="text-dark-400 text-sm">
                No stories are ready to read yet. Run{" "}
                <code className="bg-dark-800 text-crimson-300 font-mono px-1.5 py-0.5 rounded text-xs">npm run ingest</code>{" "}
                first.
              </p>
            )}
          </div>
          {stories.length > 0 && (
            <div className="grid gap-3">
              {stories.map((s) => (
                <Link
                  key={s.slug}
                  href={`/read?story=${s.slug}`}
                  className="block px-6 py-5 bg-dark-900/80 hover:bg-dark-850 border border-dark-800 hover:border-crimson-800/50 rounded-2xl transition-all duration-200 hover:-translate-y-px text-left group"
                >
                  <p className="font-medium text-dark-100 group-hover:text-white transition-colors">{s.name}</p>
                  <p className="text-xs text-dark-600 mt-0.5 font-mono">{s.slug}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      <CraneFooter />
    </div>
  );
}

export default async function ReadPage({
  searchParams,
}: {
  searchParams: Promise<{ story?: string }>;
}) {
  const { story: slug } = await searchParams;
  const stories = listReadableStories();

  // No slug → show picker
  if (!slug) return <StorySelectorPage stories={stories} />;

  const meta = stories.find((s) => s.slug === slug);

  // Unknown/unready slug → show picker with a note
  if (!meta) return <StorySelectorPage stories={stories} />;

  const storyDir = path.join(process.cwd(), "data/processed", meta.slug);
  const lexical = readJson<LexicalGraph>(path.join(storyDir, "lexical.json"))!;
  const objective = readJson<ObjectiveGraph>(path.join(storyDir, "objective-graph.json"));

  // Build per-section character presence from objective events
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

  return (
    <div className="min-h-screen bg-dark-950 text-dark-100">
      <CraneHeader
        crumbs={[
          { label: "Read", href: "/read" },
          { label: meta.name },
        ]}
        right={
          <Link
            href={`/graph?story=${meta.slug}`}
            className="text-xs text-dark-400 hover:text-dark-200 px-3 py-1.5 border border-dark-800 rounded hover:border-dark-600 transition-colors"
          >
            Knowledge graph →
          </Link>
        }
      >
        {stories.length > 1 && (
          <div className="flex gap-1 ml-3">
            {stories.map((s) => (
              <Link
                key={s.slug}
                href={`/read?story=${s.slug}`}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  s.slug === meta.slug
                    ? "bg-dark-800 text-dark-100"
                    : "text-dark-500 hover:text-dark-200"
                }`}
              >
                {s.name}
              </Link>
            ))}
          </div>
        )}
      </CraneHeader>

      <StoryReader
        slug={meta.slug}
        lexical={lexical}
        charactersBySection={charactersBySection}
      />
    </div>
  );
}
