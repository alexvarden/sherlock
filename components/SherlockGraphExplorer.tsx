import Link from "next/link";
import CraneHeader from "./CraneHeader";
import KnowledgeGraphViewer from "./KnowledgeGraphViewer";
import StorySwitcher from "./StorySwitcher";
import IngestButton from "./IngestButton";
import { listStoriesFromNeo4j, getStoryData } from "../lib/graph-query";
import { NOVEL_SLUGS } from "../lib/canon-types";
import { entityTypes, edgeTypes } from "../lib/graph-schema";
import type { StoryMeta } from "../lib/types";

// Single source of truth for the `/graph` tool. Both the standalone sherlock
// app and crane-ai render this component — each supplies its own chrome
// (dev nav here, the real site Header/Footer there) via `devTools`/`homeHref`.
// See vault: 07-projects/sherlock/tasks/graph-presentability-pass.md.
export default async function SherlockGraphExplorer({
  searchParams,
  basePath = "/graph",
  homeHref = "/",
  devTools = false,
  fullHeight = true,
  showLogo = true,
}: {
  searchParams: { story?: string; section?: string; character?: string };
  basePath?: string;
  homeHref?: string;
  devTools?: boolean;
  // True (default) for a standalone, full-viewport `h-screen` mount — the
  // sherlock dev app's own /graph. Pass false when a host renders its own
  // nav above this component (crane-ai's Header) — the component then fills
  // whatever bounded-height container the host wraps it in (`h-full`).
  fullHeight?: boolean;
  // False when a host already renders its own site branding above this
  // component — suppresses CraneHeader's own crane-ai.co.uk logo/link.
  showLogo?: boolean;
}) {
  const { story: slug, section: initialSection, character: initialCharacter } = searchParams;
  const heightClass = fullHeight ? "h-screen" : "h-full";

  let stories: StoryMeta[] = [];
  let unavailable: string | null = null;

  try {
    stories = await listStoriesFromNeo4j();
  } catch {
    unavailable = devTools
      ? "Cannot reach Neo4j. Make sure the container is running: docker compose up -d"
      : "The graph database is unavailable right now. Please try again shortly.";
  }

  if (unavailable) {
    return (
      <div className={`flex items-center justify-center ${heightClass} bg-dark-950 text-dark-300`}>
        <div className="text-center space-y-4 max-w-md">
          <h1 className="text-2xl font-semibold text-crimson-400">Graph unavailable</h1>
          <p className="text-dark-400">{unavailable}</p>
          {devTools && (
            <pre className="text-left bg-dark-900 border border-dark-800 text-crimson-300 font-mono text-sm p-4 rounded-xl">
              docker compose up -d
            </pre>
          )}
        </div>
      </div>
    );
  }

  if (stories.length === 0) {
    return (
      <div className={`flex items-center justify-center ${heightClass} bg-dark-950 text-dark-300`}>
        <div className="text-center space-y-4 max-w-sm">
          <h1 className="text-2xl font-semibold">No stories yet</h1>
          <p className="text-dark-400">
            {devTools
              ? "Ingest a story then migrate it into the graph."
              : "The canon hasn't been loaded into the graph yet."}
          </p>
          {devTools && (
            <pre className="text-left bg-dark-900 border border-dark-800 text-crimson-300 font-mono text-sm p-4 rounded-xl">
              npm run ingest{"\n"}npm run migrate
            </pre>
          )}
        </div>
      </div>
    );
  }

  const meta = stories.find((s) => s.slug === slug);
  if (!meta)
    return (
      <StoryPicker
        stories={stories}
        basePath={basePath}
        homeHref={homeHref}
        heightClass={heightClass}
        showLogo={showLogo}
      />
    );

  const data = await getStoryData(meta.slug);
  if (!data) {
    return (
      <StoryPicker
        stories={stories}
        basePath={basePath}
        homeHref={homeHref}
        heightClass={heightClass}
        showLogo={showLogo}
        error={
          devTools
            ? `"${meta.name}" is not in Neo4j yet. Run: npm run ingest -- ${meta.slug} && npm run migrate`
            : `"${meta.name}" isn't in the graph yet.`
        }
      />
    );
  }

  const { lexical, objective } = data;

  return (
    <div className={`${heightClass} flex flex-col`}>
      <CraneHeader
        homeHref={homeHref}
        crumbs={[{ label: "Graph" }]}
        showLogo={showLogo}
        right={
          <div className="flex items-center gap-3 text-xs text-dark-500">
            <span>{lexical.sections.length} sections</span>
            <span>·</span>
            <span>
              {lexical.nodes.length} {lexical.granularity}s
            </span>
            <span>·</span>
            <span>{objective.entities.length} entities</span>
            <span>·</span>
            <span>{objective.events.length} events</span>
            <GraphLegend />
          </div>
        }
      >
        <div className="flex items-center gap-2 ml-3">
          <StorySwitcher current={meta} stories={stories} basePath={basePath} />
          {devTools && <IngestButton slug={meta.slug} sourceFile={meta.sourceFile} />}
        </div>
      </CraneHeader>
      <div className="flex-1 overflow-hidden">
        <KnowledgeGraphViewer
          key={meta.slug}
          slug={meta.slug}
          lexical={lexical}
          objective={objective}
          initialSection={initialSection}
          initialCharacter={initialCharacter}
        />
      </div>
    </div>
  );
}

function StoryPicker({
  stories,
  basePath,
  homeHref,
  error,
  heightClass,
  showLogo,
}: {
  stories: StoryMeta[];
  basePath: string;
  homeHref: string;
  error?: string;
  heightClass: string;
  showLogo: boolean;
}) {
  return (
    <div className={`${heightClass} flex flex-col bg-dark-950 text-dark-300 overflow-y-auto`}>
      <CraneHeader homeHref={homeHref} crumbs={[{ label: "Graph" }]} showLogo={showLogo} />
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="text-center space-y-8 max-w-md w-full px-6">
          <div>
            <p className="mono text-xs uppercase tracking-[0.2em] text-crimson-400">
              Interactive · Sherlock
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold mt-3 text-dark-100">
              The knowledge graph
            </h1>
            <p className="text-sm mt-3 leading-relaxed text-dark-400">
              Every sentence in Doyle&apos;s canon, positioned and linked to the entities and
              events extracted from it. Pick a story below — nodes are characters, locations,
              objects, cases, documents, and organisations; edges are how they connect. Read the
              method in{" "}
              <Link
                href="/article/the-game-is-afoot"
                className="text-crimson-400 hover:text-crimson-300 underline"
              >
                the game is afoot
              </Link>
              .
            </p>
          </div>

          {error && <p className="text-crimson-400 text-sm">{error}</p>}

          <div className="space-y-2">
            {stories.map((s) => (
              <Link
                key={s.slug}
                href={`${basePath}?story=${s.slug}`}
                className="flex items-center justify-between w-full px-6 py-5 bg-dark-900/80 hover:bg-dark-850 border border-dark-800 hover:border-crimson-800/50 rounded-2xl transition-all duration-200 hover:-translate-y-px group"
              >
                <span className="font-medium text-dark-200 group-hover:text-white">
                  {s.name}
                </span>
                <span className="flex items-center gap-2">
                  {NOVEL_SLUGS.includes(s.slug) && (
                    <span className="mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-dark-800 text-dark-500 border border-dark-700">
                      Novel
                    </span>
                  )}
                  <span className="text-xs text-dark-600 group-hover:text-dark-400 font-mono">
                    {s.slug}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Legend sourced from lib/graph-schema.ts so it can never drift from the
// colours the viewer actually renders.
function GraphLegend() {
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer select-none px-2 py-0.5 rounded border border-dark-700 text-dark-400 hover:border-dark-500 hover:text-dark-100 transition-colors">
        How to read this
      </summary>
      <div className="absolute right-0 top-full mt-2 w-72 p-4 rounded-xl bg-dark-900 border border-dark-700 shadow-xl z-20 text-left space-y-3 normal-case tracking-normal">
        <div>
          <p className="text-dark-100 font-medium mb-1.5">Nodes</p>
          <ul className="space-y-1">
            {entityTypes.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: t.color }}
                />
                <span className="text-dark-300">{t.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-dark-100 font-medium mb-1.5">Edges</p>
          <ul className="space-y-1">
            {Object.values(edgeTypes).map((e) => (
              <li key={e.kind} className="flex items-center gap-2">
                <span
                  className="inline-block w-4 h-0.5 shrink-0"
                  style={{ background: e.color }}
                />
                <span className="text-dark-300">{e.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-dark-500 pt-2 border-t border-dark-800 leading-relaxed">
          Drag the timeline to scrub sections. Pick a character to filter the graph to only
          what they&apos;ve witnessed by that point in the story.
        </p>
      </div>
    </details>
  );
}
