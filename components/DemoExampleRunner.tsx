"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { DemoExample, LexicalGraph, ObjectiveGraph } from "@/lib/types";
import { buildCharacterState, getEventsUpTo } from "@/lib/character-state";
import MiniGraph from "@/components/MiniGraph";

const MODALITY_COLORS: Record<string, string> = {
  OBSERVED: "#22c55e",   // green-500
  TOLD: "#f97316",       // orange-500
  INFERRED: "#8b5cf6",   // violet-500
  ASSUMED: "#6b7280",    // gray-500
};

function buildCypherQueries(slug: string, characterId: string, sectionId: string, cutoff: number) {
  const observed = `-- Events this character directly witnessed
MATCH (c:Entity {story: '${slug}', id: '${characterId}'})
      -[:PARTICIPATED_IN]->(e:Event)
WHERE e.sectionIndex <= ${cutoff}
RETURN e
ORDER BY e.sectionIndex`;

  const told = `-- Events this character was told about
MATCH (e:Event {story: '${slug}'})-[:TOLD_TO]->
      (c:Entity {story: '${slug}', id: '${characterId}'})
WHERE e.sectionIndex <= ${cutoff}
RETURN e
ORDER BY e.sectionIndex`;

  const context = `-- All events visible at this section (for system prompt)
MATCH (e:Event {story: '${slug}'})
WHERE e.sectionIndex <= ${cutoff}
OPTIONAL MATCH (p:Entity)-[:PARTICIPATED_IN]->(e)
OPTIONAL MATCH (e)-[:TOLD_TO]->(rec:Entity)
WITH e, collect(DISTINCT p.id) AS participants,
        collect(DISTINCT rec.id) AS recipients
RETURN e, participants, recipients
ORDER BY e.sectionIndex`;

  return { observed, told, context };
}

function CypherBlock({ label, query }: { label: string; query: string }) {
  return (
    <div>
      <p className="text-xs text-dark-500 mb-1">{label}</p>
      <pre className="text-xs font-mono text-emerald-400 bg-dark-950 rounded px-3 py-2.5 overflow-x-auto leading-relaxed whitespace-pre">
        {query}
      </pre>
    </div>
  );
}

export default function DemoExampleRunner({
  slug,
  example,
  objective,
  lexical,
}: {
  slug: string;
  example: DemoExample;
  objective: ObjectiveGraph;
  lexical: LexicalGraph | null;
}) {
  const [open, setOpen] = useState(false);
  const [showCypher, setShowCypher] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const characterEntity = useMemo(
    () => objective.entities.find((e) => e.id === example.character),
    [objective, example.character]
  );

  const sections = lexical?.sections ?? [];

  const sectionIdx = useMemo(
    () => sections.findIndex((s) => s.id === example.section),
    [sections, example.section]
  );

  const state = useMemo(
    () => buildCharacterState(example.character, example.section, objective, sections),
    [example, objective, sections]
  );

  const visibleEvents = useMemo(
    () => getEventsUpTo(objective, sections, example.section),
    [objective, sections, example.section]
  );

  const witnessedEvents = visibleEvents.filter((ev) =>
    ev.participants.includes(example.character)
  );

  const queries = useMemo(
    () => buildCypherQueries(slug, example.character, example.section, sectionIdx),
    [slug, example.character, example.section, sectionIdx]
  );

  async function runQuery() {
    setPending(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          characterId: example.character,
          sectionId: example.section,
          question: example.question,
        }),
      });
      const data = (await res.json()) as { ok: boolean; answer?: string; message?: string };
      if (data.ok && data.answer) {
        setAnswer(data.answer);
      } else {
        setError(data.message ?? "Query failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border border-dark-800 rounded-xl overflow-hidden bg-dark-900/40">
      {/* Header — always visible, click to collapse/expand */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-4 bg-dark-900/60 border-b border-dark-800 text-left hover:bg-dark-900 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs px-2 py-0.5 rounded bg-crimson-900/40 text-crimson-300 font-mono shrink-0">
            {characterEntity?.label ?? example.character}
          </span>
          <span className="text-xs text-dark-500 font-mono shrink-0">@ {example.section}</span>
          <p className="text-sm text-dark-100 leading-relaxed flex-1 text-left">{example.question}</p>
          <span className="text-xs text-dark-500 shrink-0">{open ? "▲" : "▼"}</span>
        </div>
        {answer && !open && (
          <p className="text-xs text-dark-500 mt-2 ml-0 truncate italic">{answer}</p>
        )}
        {example.expectedTheme && !open && (
          <p className="text-xs text-dark-600 mt-1 italic">
            <span className="not-italic">expected:</span> {example.expectedTheme}
          </p>
        )}
      </button>

      {open && (
        <>
          {/* Body: left column (graph + knowledge), right column (response) */}
          {(() => {
            const participantIds = new Set(visibleEvents.flatMap((ev) => ev.participants));
            const graphEntities = objective.entities.filter((e) => participantIds.has(e.id));
            const graphEdges = objective.stateEdges?.filter(
              (se) => participantIds.has(se.from) && participantIds.has(se.to)
            ) ?? [];
            return (
              <div className="grid md:grid-cols-2 gap-px bg-dark-800">
                {/* Left: graph, full height */}
                <div className="bg-dark-950 flex flex-col relative">
                  <div className="flex items-center justify-between px-4 pt-3 pb-1">
                    <p className="text-xs text-dark-500 font-mono uppercase tracking-wider">
                      subgraph · {graphEntities.length} entities · {visibleEvents.length} events
                    </p>
                    <Link
                      href={`/graph?story=${slug}&section=${example.section}&character=${example.character}`}
                      className="text-xs text-crimson-400 hover:text-crimson-300 transition-colors font-medium"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      expand graph ↗
                    </Link>
                  </div>
                  <div className="flex-1">
                    <MiniGraph
                      entities={graphEntities}
                      events={visibleEvents}
                      stateEdges={graphEdges}
                      highlightId={example.character}
                      height={380}
                    />
                  </div>
                </div>

                {/* Right: knowledge (top, scrollable) + response (below) */}
                <div className="bg-dark-950 flex flex-col divide-y divide-dark-800">
                  {/* Knowledge */}
                  <div className="flex flex-col">
                    <h4 className="text-xs font-semibold text-dark-500 uppercase tracking-wider px-5 pt-4 pb-2 shrink-0">
                      Knowledge — {characterEntity?.label ?? example.character}
                    </h4>
                    <div className="overflow-y-auto px-5 pb-4 space-y-3 max-h-44">
                      <div>
                        <p className="text-xs text-dark-500 mb-1.5">
                          Witnessed events ({witnessedEvents.length})
                        </p>
                        {witnessedEvents.length === 0 ? (
                          <p className="text-xs text-dark-600 italic">none</p>
                        ) : (
                          <ul className="text-xs text-dark-400 space-y-1">
                            {witnessedEvents.map((ev) => (
                              <li key={ev.id} className="flex gap-2">
                                <span className="text-dark-600 font-mono shrink-0">{ev.id}</span>
                                <span>{ev.label}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {state.beliefs.length > 0 && (
                        <div>
                          <p className="text-xs text-dark-500 mb-1.5">Told (may be true or false)</p>
                          <ul className="text-xs space-y-1">
                            {state.beliefs.map((b) => (
                              <li key={b.id} className="flex items-start gap-1.5">
                                <span
                                  className="text-xs px-1.5 py-px rounded font-medium shrink-0 mt-0.5"
                                  style={{
                                    backgroundColor: MODALITY_COLORS.TOLD + "22",
                                    color: MODALITY_COLORS.TOLD,
                                  }}
                                >
                                  TOLD
                                </span>
                                <span className="text-dark-400">&ldquo;{b.description}&rdquo;</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="text-xs text-dark-600 pt-2 border-t border-dark-800">
                        {visibleEvents.length} total events visible · witnessed {witnessedEvents.length}
                      </div>
                    </div>
                  </div>

                  {/* Response */}
                  <div className="p-5 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-dark-500 uppercase tracking-wider">
                      Response
                    </h4>
                    <button
                      onClick={runQuery}
                      disabled={pending}
                      className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                        pending
                          ? "bg-dark-800 text-dark-500 cursor-not-allowed"
                          : answer
                          ? "bg-dark-800 text-dark-400 hover:bg-dark-700 border border-dark-700"
                          : "bg-crimson-500 text-white hover:bg-crimson-600"
                      }`}
                    >
                      {pending ? "Running…" : answer ? "Run again" : "Run query"}
                    </button>
                  </div>

                  {error && <p className="text-xs text-crimson-400">{error}</p>}

                  {answer ? (
                    <p className="text-sm text-dark-100 leading-relaxed whitespace-pre-wrap">{answer}</p>
                  ) : (
                    !error && !pending && (
                      <p className="text-xs text-dark-600 italic">
                        Click &ldquo;Run query&rdquo; to ask the character.
                      </p>
                    )
                  )}
                </div>
                </div>
              </div>
            );
          })()}

          {/* Footer: Cypher queries + graph link */}
          <div className="border-t border-dark-800 bg-dark-900/30">
            <div className="flex items-center gap-3 px-5 py-2.5 border-b border-dark-800/60">
              <button
                onClick={() => setShowCypher((v) => !v)}
                className="text-xs text-emerald-500 hover:text-emerald-300 font-mono transition-colors"
              >
                {showCypher ? "▲ hide cypher" : "▼ show cypher"}
              </button>
              <span className="text-dark-700 text-xs">·</span>
              <Link
                href={`/graph?story=${slug}`}
                className="text-xs text-dark-500 hover:text-dark-200 transition-colors"
              >
                view in graph →
              </Link>
            </div>

            {showCypher && (
              <div className="px-5 py-4 space-y-4">
                <CypherBlock label="1. OBSERVED — events the character participated in" query={queries.observed} />
                <CypherBlock label="2. TOLD — events whose content was directed at the character" query={queries.told} />
                <CypherBlock label="3. CONTEXT — all events visible at this section (system prompt)" query={queries.context} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
