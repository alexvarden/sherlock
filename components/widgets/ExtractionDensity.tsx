"use client";

import { useMemo, useState } from "react";
import type { WorkSummary } from "@/lib/canon-types";
import { IN_UNIVERSE_ORDER } from "@/lib/canon-types";

interface Props {
  works: WorkSummary[];
}

type Metric = "entitiesPer1k" | "eventsPer1k" | "mentionsPer1k" | "absolute";

const METRICS: { key: Metric; label: string; help: string }[] = [
  { key: "entitiesPer1k", label: "Entities / 1k words", help: "Entity density: how many named things per 1,000 words." },
  { key: "eventsPer1k", label: "Events / 1k words", help: "Event density: how many narrative actions per 1,000 words." },
  { key: "mentionsPer1k", label: "Mentions / 1k words", help: "Mention density: how many entity references per 1,000 words." },
  { key: "absolute", label: "Absolute counts (stacked)", help: "Raw totals per work — entities, events, mentions stacked." },
];

const COLOURS = {
  entities: "#e11d48",
  events: "#fb7185",
  mentions: "#a855f7",
};

export default function ExtractionDensity({ works }: Props) {
  const [metric, setMetric] = useState<Metric>("entitiesPer1k");
  const [hover, setHover] = useState<{ work: string; lines: string[] } | null>(null);

  const orderedWorks = useMemo(() => {
    const lookup = new Map(works.map((w) => [w.slug, w]));
    return IN_UNIVERSE_ORDER.map((slug) => lookup.get(slug)).filter((w): w is WorkSummary => Boolean(w));
  }, [works]);

  const enriched = useMemo(() => {
    return orderedWorks.map((w) => {
      const per1k = (n: number) => (w.wordCount > 0 ? (n / w.wordCount) * 1000 : 0);
      return {
        ...w,
        entitiesPer1k: per1k(w.entityCount),
        eventsPer1k: per1k(w.eventCount),
        mentionsPer1k: per1k(w.mentionCount),
      };
    });
  }, [orderedWorks]);

  const maxValue = useMemo(() => {
    if (metric === "absolute") {
      return Math.max(...enriched.map((w) => w.entityCount + w.eventCount + w.mentionCount));
    }
    return Math.max(...enriched.map((w) => w[metric] as number));
  }, [enriched, metric]);

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-4">
      {/* Metric switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400 mr-2">
          Metric
        </span>
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${
              metric === m.key
                ? "bg-crimson-500/15 border-crimson-500/50 text-dark-100"
                : "bg-dark-850 border-dark-800 text-dark-400 hover:text-dark-200 hover:border-dark-700"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-dark-500 leading-relaxed">
        {METRICS.find((m) => m.key === metric)?.help}
      </p>

      {/* Bars */}
      <div className="space-y-1.5">
        {enriched.map((w) => {
          const isStacked = metric === "absolute";
          const totalAbs = w.entityCount + w.eventCount + w.mentionCount;
          const value = metric === "absolute" ? totalAbs : (w[metric] as number);
          const widthPct = maxValue > 0 ? (value / maxValue) * 100 : 0;

          return (
            <div
              key={w.slug}
              className="flex items-center gap-3"
              onMouseEnter={() =>
                setHover({
                  work: w.name,
                  lines: [
                    `${w.wordCount.toLocaleString()} words · ${w.sentenceCount.toLocaleString()} sentences`,
                    `${w.entityCount} entities · ${w.eventCount} events · ${w.mentionCount.toLocaleString()} mentions`,
                    `${w.entitiesPer1k.toFixed(1)} entities / 1k words · ${w.eventsPer1k.toFixed(1)} events / 1k words`,
                  ],
                })
              }
              onMouseLeave={() => setHover(null)}
            >
              <div className="w-40 text-xs truncate text-dark-200" title={w.name}>
                {w.name}
              </div>
              <div className="flex-1 h-6 bg-dark-950/60 rounded border border-dark-800 relative overflow-hidden">
                {isStacked ? (
                  <div className="flex h-full" style={{ width: `${widthPct}%` }}>
                    <div
                      className="h-full"
                      style={{
                        width: `${(w.entityCount / totalAbs) * 100}%`,
                        backgroundColor: COLOURS.entities,
                        opacity: 0.85,
                      }}
                    />
                    <div
                      className="h-full"
                      style={{
                        width: `${(w.eventCount / totalAbs) * 100}%`,
                        backgroundColor: COLOURS.events,
                        opacity: 0.85,
                      }}
                    />
                    <div
                      className="h-full"
                      style={{
                        width: `${(w.mentionCount / totalAbs) * 100}%`,
                        backgroundColor: COLOURS.mentions,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className="absolute inset-y-0 left-0 bg-crimson-500"
                    style={{ width: `${widthPct}%`, opacity: 0.78 }}
                  />
                )}
              </div>
              <div className="w-16 text-xs text-dark-400 text-right tabular-nums">
                {metric === "absolute" ? value.toLocaleString() : (value as number).toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend for stacked mode */}
      {metric === "absolute" && (
        <div className="flex items-center gap-4 text-[10px] font-mono text-dark-500 pt-2">
          {Object.entries(COLOURS).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: v }} />
              {k}
            </span>
          ))}
        </div>
      )}

      {/* Hover panel */}
      <div className="min-h-[64px] p-4 rounded bg-dark-950/60 border border-dark-800">
        {hover ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-dark-100">{hover.work}</p>
            {hover.lines.map((l, i) => (
              <p key={i} className="text-xs font-mono text-dark-400">
                {l}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-dark-500 italic">
            Hover any work for raw counts and density numbers.
          </p>
        )}
      </div>
    </div>
  );
}
