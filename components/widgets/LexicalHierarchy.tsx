"use client";

import { useState } from "react";

interface Props {
  workCount: number;
  sectionCount: number;
  sentenceCount: number;
  // A single drill-down path to light up
  highlightWork?: string;
  highlightSection?: string;
  highlightSentence?: string;
  highlightSentenceText?: string;
}

interface Level {
  key: string;
  label: string;
  count: number | null;
  example: string;
  description: string;
  colour: string;
}

export default function LexicalHierarchy(props: Props) {
  const {
    workCount,
    sectionCount,
    sentenceCount,
    highlightWork = "The Final Problem",
    highlightSection = "section_1",
    highlightSentence = "sentence_3",
    highlightSentenceText = "It is with a heavy heart that I take up my pen…",
  } = props;

  const [activeLevel, setActiveLevel] = useState<string | null>(null);

  const levels: Level[] = [
    {
      key: "author",
      label: "Author",
      count: 1,
      example: "Arthur Conan Doyle",
      description: "The corpus root. Right now: one. Add another author and the rest scales.",
      colour: "#5c5252",
    },
    {
      key: "work",
      label: "Work",
      count: workCount,
      example: highlightWork,
      description: "A novel or short story. Has its own slug, source file, and section list.",
      colour: "#7a6e6e",
    },
    {
      key: "section",
      label: "Section",
      count: sectionCount,
      example: highlightSection,
      description: "A chapter or scene. The unit the LLM extraction operates over.",
      colour: "#a19a9a",
    },
    {
      key: "sentence",
      label: "Sentence",
      count: sentenceCount,
      example: `${highlightSentence} · "${highlightSentenceText.slice(0, 56)}…"`,
      description: "The atomic citable node. Every fact upstream points back to one of these.",
      colour: "#e11d48",
    },
  ];

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-4">
      <p className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400">
        How the address space nests
      </p>

      <div className="relative">
        {/* Connecting line down the left */}
        <div
          className="absolute left-[18px] top-3 bottom-3 w-px bg-dark-700"
          aria-hidden="true"
        />

        <div className="space-y-3">
          {levels.map((level, i) => {
            const isActive = activeLevel === level.key;
            const indent = i * 28;
            return (
              <div
                key={level.key}
                className="relative"
                style={{ marginLeft: indent }}
                onMouseEnter={() => setActiveLevel(level.key)}
                onMouseLeave={() => setActiveLevel(null)}
              >
                {/* L-bracket from parent line */}
                {i > 0 && (
                  <div
                    className="absolute -top-3 w-px bg-dark-700"
                    style={{ left: -indent + 18, height: 18 }}
                    aria-hidden="true"
                  />
                )}
                {i > 0 && (
                  <div
                    className="absolute top-[16px] h-px bg-dark-700"
                    style={{ left: -indent + 18, width: indent - 12 }}
                    aria-hidden="true"
                  />
                )}

                {/* Node card */}
                <div
                  className="rounded-lg border-2 px-4 py-3 transition-all"
                  style={{
                    borderColor: isActive ? level.colour : `${level.colour}55`,
                    backgroundColor: isActive ? `${level.colour}15` : `${level.colour}06`,
                  }}
                >
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-[10px] font-mono uppercase tracking-[0.15em]" style={{ color: level.colour }}>
                      {level.label}
                    </span>
                    {level.count !== null && (
                      <span className="text-xs font-mono text-dark-500 tabular-nums">
                        × {level.count.toLocaleString()}
                      </span>
                    )}
                    <span className="text-sm text-dark-100 font-medium truncate">
                      {level.example}
                    </span>
                  </div>
                  <p className="text-xs text-dark-400 mt-1 leading-relaxed">
                    {level.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-xs text-dark-500 leading-relaxed pt-2">
        Each level has a stable ID. Every layer above the lexical graph — entities, events, character state —
        cites at the sentence level. That&apos;s the whole reason this nesting exists: it gives the upper layers
        somewhere precise to point.
      </div>
    </div>
  );
}
