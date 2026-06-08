export const dynamic = "force-dynamic";

import Link from "next/link";
import CraneHeader from "@/components/CraneHeader";
import KnowledgeGraphViewer from "@/components/KnowledgeGraphViewer";
import StorySwitcher from "@/components/StorySwitcher";
import IngestButton from "@/components/IngestButton";
import { listStoriesFromNeo4j, getStoryData } from "@/lib/graph-query";
import type { StoryMeta } from "@/lib/types";

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ story?: string; section?: string; character?: string }>;
}) {
  const { story: slug, section: initialSection, character: initialCharacter } = await searchParams;

  let stories: StoryMeta[] = [];
  let neo4jError: string | null = null;

  try {
    stories = await listStoriesFromNeo4j();
  } catch {
    neo4jError = "Cannot reach Neo4j. Make sure the container is running: docker compose up -d";
  }

  if (neo4jError) {
    return (
      <div className="flex items-center justify-center h-screen bg-dark-950 text-dark-300">
        <div className="text-center space-y-4 max-w-md">
          <h1 className="text-2xl font-semibold text-crimson-400">Neo4j unavailable</h1>
          <p className="text-dark-400">{neo4jError}</p>
          <pre className="text-left bg-dark-900 border border-dark-800 text-crimson-300 font-mono text-sm p-4 rounded-xl">docker compose up -d</pre>
        </div>
      </div>
    );
  }

  if (stories.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-dark-950 text-dark-300">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-semibold">No stories in Neo4j yet</h1>
          <p className="text-dark-400 max-w-sm">Ingest a story then migrate it into the graph.</p>
          <pre className="text-left bg-dark-900 border border-dark-800 text-crimson-300 font-mono text-sm p-4 rounded-xl">
            npm run ingest{"\n"}npm run migrate
          </pre>
        </div>
      </div>
    );
  }

  const meta = stories.find((s) => s.slug === slug);
  if (!meta) return <StoryPicker stories={stories} />;

  const data = await getStoryData(meta.slug);

  if (!data) {
    return (
      <StoryPicker
        stories={stories}
        error={`"${meta.name}" is not in Neo4j yet. Run: npm run ingest -- ${meta.slug} && npm run migrate`}
      />
    );
  }

  const { lexical, objective } = data;

  return (
    <div className="h-screen flex flex-col">
      <CraneHeader
        crumbs={[{ label: "Graph" }]}
        right={
          <div className="flex items-center gap-3 text-xs text-dark-500">
            <span>{lexical.sections.length} sections</span>
            <span>·</span>
            <span>{lexical.nodes.length} {lexical.granularity}s</span>
            <span>·</span>
            <span>{objective.entities.length} entities</span>
            <span>·</span>
            <span>{objective.events.length} events</span>
          </div>
        }
      >
        <div className="flex items-center gap-2 ml-3">
          <StorySwitcher current={meta} stories={stories} />
          <IngestButton slug={meta.slug} sourceFile={meta.sourceFile} />
        </div>
      </CraneHeader>
      <div className="flex-1 overflow-hidden">
        <KnowledgeGraphViewer key={meta.slug} slug={meta.slug} lexical={lexical} objective={objective} initialSection={initialSection} initialCharacter={initialCharacter} />
      </div>
    </div>
  );
}

function StoryPicker({ stories, error }: { stories: StoryMeta[]; error?: string }) {
  return (
    <div className="h-screen flex flex-col bg-dark-950 text-dark-300">
      <CraneHeader crumbs={[{ label: "Graph" }]} />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md w-full px-6">
          <h1 className="text-2xl font-semibold text-dark-100">Choose a story</h1>
          {error && <p className="text-crimson-400 text-sm">{error}</p>}
          <div className="space-y-2">
            {stories.map((s) => (
              <Link
                key={s.slug}
                href={`/graph?story=${s.slug}`}
                className="flex items-center justify-between w-full px-6 py-5 bg-dark-900/80 hover:bg-dark-850 border border-dark-800 hover:border-crimson-800/50 rounded-2xl transition-all duration-200 hover:-translate-y-px group"
              >
                <span className="font-medium text-dark-200 group-hover:text-white">{s.name}</span>
                <span className="text-xs text-dark-600 group-hover:text-dark-400 font-mono">{s.slug}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
