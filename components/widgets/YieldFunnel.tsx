"use client";

import type { WorkSummary, FrequencyByType } from "@/lib/canon-types";

interface Props {
  works: WorkSummary[];
  frequency: FrequencyByType[];
  totalEntities: number;
  totalEvents: number;
}

interface Stage {
  label: string;
  layer: string;
  value: number;
  unit: string;
  colour: string;
  description: string;
}

export default function YieldFunnel({ works, frequency, totalEntities, totalEvents }: Props) {
  const totalWords = works.reduce((s, w) => s + w.wordCount, 0);
  const totalSentences = works.reduce((s, w) => s + w.sentenceCount, 0);
  const totalSections = works.reduce((s, w) => s + w.sectionCount, 0);
  const totalMentions = works.reduce((s, w) => s + w.mentionCount, 0);
  const totalCases = frequency.find((f) => f.type === "case")?.items.length ?? 0;

  const stages: Stage[] = [
    {
      label: "Words",
      layer: "raw source",
      value: totalWords,
      unit: "words",
      colour: "#5c5252",
      description: "Project Gutenberg plain text. Headers stripped, paragraphs preserved.",
    },
    {
      label: "Sections",
      layer: "Layer 1 · lexical",
      value: totalSections,
      unit: "sections",
      colour: "#7a6e6e",
      description: "Chapters and scenes with stable IDs.",
    },
    {
      label: "Sentences",
      layer: "Layer 1 · lexical",
      value: totalSentences,
      unit: "sentences",
      colour: "#a19a9a",
      description: "Globally positioned. Abbreviation-aware tokeniser handles Mr., Dr., St.",
    },
    {
      label: "Entities",
      layer: "Layer 2 · objective",
      value: totalEntities,
      unit: "entities",
      colour: "#e11d48",
      description: "Characters, locations, objects, organisations, documents, cases.",
    },
    {
      label: "Events",
      layer: "Layer 2 · objective",
      value: totalEvents,
      unit: "events",
      colour: "#fb7185",
      description: "Each cites the sentence IDs it was derived from.",
    },
    {
      label: "Mentions",
      layer: "Layer 2 · objective",
      value: totalMentions,
      unit: "mentions",
      colour: "#a855f7",
      description: "Entity-to-sentence links — the bridge back to citations.",
    },
    {
      label: "Cases",
      layer: "Layer 2 · objective",
      value: totalCases,
      unit: "cases",
      colour: "#f59e0b",
      description: "Investigations grouped from their constituent events and clues.",
    },
  ];

  const maxValue = Math.max(...stages.map((s) => s.value));

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-3">
      <p className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400 mb-4">
        What the pipeline produced from {totalWords.toLocaleString()} words of Doyle
      </p>

      <div className="space-y-2.5">
        {stages.map((stage) => {
          const widthPct = Math.max(2, (stage.value / maxValue) * 100);
          return (
            <div key={stage.label} className="flex items-center gap-4">
              <div className="w-40 shrink-0">
                <div className="text-sm font-medium text-dark-100">{stage.label}</div>
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500">
                  {stage.layer}
                </div>
              </div>
              <div className="flex-1 relative h-9 bg-dark-950/60 rounded border border-dark-800">
                <div
                  className="absolute inset-y-0 left-0 rounded transition-all"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: stage.colour,
                    opacity: 0.78,
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-between px-3">
                  <span className="text-sm font-mono font-semibold text-white tabular-nums drop-shadow">
                    {stage.value.toLocaleString()}
                  </span>
                  <span className="text-xs text-dark-300 italic truncate ml-3">
                    {stage.description}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-dark-800 text-xs text-dark-500 leading-relaxed">
        Each row is the canon-wide total at that stage of the pipeline. The bar lengths are scaled to the largest value (words),
        so the lower rows look thin — but each is still tens of thousands of citation-grounded facts.
      </div>
    </div>
  );
}
