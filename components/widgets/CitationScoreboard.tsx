"use client";

import { useMemo, useState, useTransition } from "react";
import type { SearchSentence } from "../../lib/canon-types";
import { searchCanon } from "../../app/actions/canon-search";

interface Props {
  famousQuoteCounts: Record<string, number>;
  totalSentences: number;
}

const FAMOUS_QUOTES: { label: string; query: string }[] = [
  { label: "“Elementary, my dear Watson”", query: "elementary, my dear watson" },
  { label: "“Elementary”", query: "elementary" },
  { label: "“The game is afoot”", query: "the game is afoot" },
  { label: "“You know my methods”", query: "you know my methods" },
  { label: "“When you have eliminated the impossible”", query: "eliminated the impossible" },
  { label: "“The curious incident of the dog”", query: "curious incident" },
  { label: "“A three-pipe problem”", query: "three pipe" },
  { label: "“The Napoleon of crime”", query: "napoleon of crime" },
  { label: "“My dear Watson”", query: "my dear watson" },
];

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-crimson-500/30 text-crimson-200 px-0.5 rounded">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function CitationScoreboard({ famousQuoteCounts, totalSentences }: Props) {
  const [query, setQuery] = useState("");
  const [selectedQuote, setSelectedQuote] = useState<string | null>(null);
  const [results, setResults] = useState<SearchSentence[]>([]);
  const [isPending, startTransition] = useTransition();
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const activeQuery = (query || selectedQuote || "").trim();

  const runSearch = (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    startTransition(async () => {
      const hits = await searchCanon(q);
      setResults(hits);
    });
  };

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (next) setSelectedQuote(null);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => runSearch(next), 180);
    setDebounceTimer(t);
  };

  const onSelectQuote = (q: string) => {
    setSelectedQuote(q);
    setQuery("");
    runSearch(q);
  };

  const totalLabel = useMemo(() => totalSentences.toLocaleString(), [totalSentences]);

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-6">
      {/* Famous-line scoreboard */}
      <div>
        <p className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400 mb-3">
          Pre-loaded queries
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {FAMOUS_QUOTES.map((q) => {
            const count = famousQuoteCounts[q.query] ?? 0;
            const isActive = selectedQuote === q.query && !query;
            return (
              <button
                key={q.query}
                onClick={() => onSelectQuote(q.query)}
                className={`text-left px-3 py-2 rounded text-sm flex items-center justify-between gap-3 transition-colors border ${
                  isActive
                    ? "bg-crimson-500/10 border-crimson-500/40 text-dark-100"
                    : "bg-dark-850 border-dark-800 hover:border-dark-700 text-dark-200"
                }`}
              >
                <span className="truncate">{q.label}</span>
                <span
                  className={`text-xs font-mono tabular-nums shrink-0 ${
                    count === 0 ? "text-dark-600" : "text-crimson-400"
                  }`}
                >
                  {count} {count === 1 ? "hit" : "hits"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Free-text search */}
      <div>
        <p className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400 mb-2">
          Or search the canon yourself
        </p>
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Try: pipe, bohemia, telegram, dartmoor…"
          className="w-full bg-dark-850 border border-dark-700 focus:border-crimson-500 rounded px-3 py-2 text-sm text-dark-100 placeholder-dark-500 outline-none transition-colors"
        />
        <p className="text-[10px] font-mono text-dark-600 mt-1.5">
          {totalLabel} sentences indexed · {isPending ? "searching…" : "ready"}
        </p>
      </div>

      {/* Results */}
      <div className="min-h-[120px] max-h-80 overflow-y-auto space-y-2">
        {!activeQuery && (
          <p className="text-sm text-dark-500 italic">
            Pick a phrase above or type your own to see every cited sentence in the canon.
          </p>
        )}
        {activeQuery && !isPending && results.length === 0 && (
          <div className="rounded p-4 bg-dark-950/60 border border-dark-800">
            <p className="text-sm text-dark-200">
              <span className="text-crimson-400 font-mono">0 hits.</span> The canon does not contain the phrase{" "}
              <span className="text-dark-100 italic">&ldquo;{activeQuery}&rdquo;</span>.
            </p>
          </div>
        )}
        {activeQuery && results.length > 0 && (
          <>
            <p className="text-xs text-dark-500 font-mono">
              {results.length === 50 ? "showing first 50" : `${results.length} ${results.length === 1 ? "match" : "matches"}`}
            </p>
            {results.map((r, i) => (
              <div
                key={`${r.workSlug}-${r.rawIndex}-${i}`}
                className="rounded p-3 bg-dark-950/60 border border-dark-800"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-crimson-400">
                    {r.workName}
                  </span>
                  <span className="text-[10px] font-mono text-dark-600">
                    · sentence #{r.rawIndex + 1}
                  </span>
                </div>
                <p className="text-sm text-dark-200 leading-relaxed">
                  {highlight(r.text, activeQuery)}
                </p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
