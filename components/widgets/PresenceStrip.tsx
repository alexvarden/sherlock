"use client";

import { useMemo, useState } from "react";
import type { WorkSummary, EntitySummary, PresenceForEntity } from "../../lib/canon-types";
import { IN_UNIVERSE_ORDER } from "../../lib/canon-types";

interface Props {
  works: WorkSummary[];
  entities: EntitySummary[];
  presence: Record<string, PresenceForEntity>;
}

const DEFAULTS = ["sherlock_holmes", "watson", "lestrade", "mycroft_holmes", "professor_moriarty"];

export default function PresenceStrip({ works, entities, presence }: Props) {
  const characterEntities = useMemo(
    () => entities.filter((e) => e.type === "character" && e.totalMentions >= 2).slice(0, 60),
    [entities]
  );

  // Pre-seed picker with the most-mentioned canonical character (Holmes)
  const initial = characterEntities.find((e) => e.key === "sherlock_holmes")?.key ?? characterEntities[0]?.key;
  const [selected, setSelected] = useState<string>(initial);
  const [hover, setHover] = useState<{ work: string; text: string } | null>(null);

  const orderedWorks = useMemo(() => {
    const lookup = new Map(works.map((w) => [w.slug, w]));
    return IN_UNIVERSE_ORDER
      .map((slug) => lookup.get(slug))
      .filter((w): w is WorkSummary => Boolean(w));
  }, [works]);

  const data = presence[selected] ?? { byWork: {} };

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400">
          Character
        </label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="bg-dark-800 border border-dark-700 hover:border-dark-600 rounded px-3 py-1.5 text-sm text-dark-100 font-medium"
        >
          {/* Defaults first */}
          {DEFAULTS.map((key) => {
            const e = characterEntities.find((x) => x.key === key);
            if (!e) return null;
            return (
              <option key={key} value={key}>
                {e.label} · {e.totalMentions} mentions
              </option>
            );
          })}
          <option disabled>──────────</option>
          {characterEntities
            .filter((e) => !DEFAULTS.includes(e.key))
            .map((e) => (
              <option key={e.key} value={e.key}>
                {e.label} · {e.totalMentions} mentions
              </option>
            ))}
        </select>

        <span className="text-xs text-dark-500 ml-auto">
          {Object.values(data.byWork).reduce((s, ms) => s + ms.length, 0).toLocaleString()} mentions across {Object.keys(data.byWork).length} of {orderedWorks.length} works
        </span>
      </div>

      <div className="space-y-1.5">
        {orderedWorks.map((w) => {
          const marks = data.byWork[w.slug] ?? [];
          const hasAny = marks.length > 0;
          return (
            <div key={w.slug} className="flex items-center gap-3">
              <div
                className={`w-44 text-xs truncate ${hasAny ? "text-dark-200" : "text-dark-600"}`}
                title={w.name}
              >
                {w.name}
              </div>
              <div
                className="flex-1 h-6 bg-dark-850 rounded border border-dark-800 relative overflow-hidden"
                onMouseLeave={() => setHover(null)}
              >
                {marks.map((m, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 w-[2px] bg-crimson-500 hover:bg-crimson-400 hover:w-1 cursor-pointer"
                    style={{ left: `${m.position * 100}%`, opacity: 0.75 }}
                    onMouseEnter={() => setHover({ work: w.name, text: m.sentenceText })}
                  />
                ))}
                {!hasAny && (
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-dark-600 italic">
                    not mentioned
                  </div>
                )}
              </div>
              <div className="w-12 text-xs text-dark-500 text-right tabular-nums">
                {marks.length || ""}
              </div>
            </div>
          );
        })}
      </div>

      <div className="min-h-[80px] mt-4 p-4 rounded bg-dark-950/60 border border-dark-800">
        {hover ? (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-crimson-400">
              {hover.work}
            </p>
            <p className="text-sm text-dark-200 leading-relaxed italic">
              &ldquo;{hover.text}&rdquo;
            </p>
          </div>
        ) : (
          <p className="text-sm text-dark-500 italic">
            Hover any mark to read the cited sentence.
          </p>
        )}
      </div>
    </div>
  );
}
