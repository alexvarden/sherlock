"use client";

import { useState } from "react";
import type { ReconciliationData, ReconciliationCluster } from "@/lib/post0-data";

interface Props {
  data: ReconciliationData;
}

const TYPE_COLOURS: Record<string, string> = {
  character: "#e11d48",
  location: "#a855f7",
  object: "#7a6e6e",
};

function variantsTotal(c: ReconciliationCluster): number {
  return c.variants.reduce((s, v) => s + v.mentionCount, 0);
}

function MergeBlock({ cluster, fallbackTotal }: { cluster: ReconciliationCluster; fallbackTotal?: number }) {
  const colour = TYPE_COLOURS[cluster.canonicalType] ?? "#999";
  const total = fallbackTotal ?? variantsTotal(cluster);
  return (
    <div
      className="rounded-lg p-4 border-2"
      style={{ borderColor: `${colour}66`, backgroundColor: `${colour}08` }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-sm font-semibold" style={{ color: colour }}>
          {cluster.canonicalLabel}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-[0.15em]" style={{ color: colour }}>
          {cluster.canonicalType}
        </span>
      </div>
      <div className="text-xs text-dark-400 font-mono">
        {cluster.variants.length} variant{cluster.variants.length === 1 ? "" : "s"} merged · {total.toLocaleString()} total mentions
      </div>
    </div>
  );
}

export default function ReconciliationDiagram({ data }: Props) {
  const [tab, setTab] = useState<"merge" | "collision">("merge");

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 overflow-hidden">
      {/* Tab header */}
      <div className="border-b border-dark-800 px-6 flex gap-1">
        <button
          onClick={() => setTab("merge")}
          className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "merge"
              ? "border-crimson-500 text-dark-100"
              : "border-transparent text-dark-500 hover:text-dark-300"
          }`}
        >
          The merge case — Sherlock Holmes
        </button>
        <button
          onClick={() => setTab("collision")}
          className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "collision"
              ? "border-crimson-500 text-dark-100"
              : "border-transparent text-dark-500 hover:text-dark-300"
          }`}
        >
          The collision case — Hudson
        </button>
      </div>

      <div className="p-6">
        {tab === "merge" && (
          <div className="space-y-4">
            <p className="text-sm text-dark-300 leading-relaxed">
              Across the 17 works in the canon, the same character is extracted under multiple labels: <span className="font-mono text-dark-100">Sherlock Holmes</span>,{" "}
              <span className="font-mono text-dark-100">holmes</span>, <span className="font-mono text-dark-100">Mr. Sherlock Holmes</span>. Reconciliation maps them all to one canonical key so cross-work questions can be asked.
            </p>

            <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-start">
              {/* BEFORE */}
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 mb-2">
                  Raw extractions (one per work)
                </p>
                <div className="space-y-1 max-h-96 overflow-auto pr-2">
                  {data.mergeExample.variants.map((v, i) => (
                    <div
                      key={`${v.workSlug}-${v.rawId}-${i}`}
                      className="flex items-baseline gap-3 px-3 py-2 rounded bg-dark-950/60 border border-dark-800 text-xs"
                    >
                      <span className="font-mono text-dark-200 shrink-0">{v.label}</span>
                      <span className="font-mono text-[10px] text-dark-600 truncate flex-1">{v.workSlug}</span>
                      <span className="font-mono text-dark-400 tabular-nums shrink-0">{v.mentionCount}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ARROW */}
              <div className="hidden md:flex items-center justify-center self-stretch">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 mb-2 text-center">
                    canonicalise
                  </span>
                  <svg width="40" height="20" viewBox="0 0 40 20">
                    <line x1="0" y1="10" x2="34" y2="10" stroke="#5c5252" strokeWidth="1.5" />
                    <path d="M28 4 L36 10 L28 16" fill="none" stroke="#5c5252" strokeWidth="1.5" />
                  </svg>
                </div>
              </div>

              {/* AFTER */}
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 mb-2">
                  Canonical entity
                </p>
                <MergeBlock cluster={data.mergeExample} />
                <div className="text-xs text-dark-500 leading-relaxed pt-2">
                  The merge rule is a per-character alias map (<code className="font-mono text-dark-400">sherlock_holmes / holmes / mr_sherlock_holmes</code> all collapse to <code className="font-mono text-dark-300">sherlock_holmes</code>). A deeper run would also catch the lowercased <em>holmes</em> within a single work&apos;s extraction.
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "collision" && (
          <div className="space-y-4">
            <p className="text-sm text-dark-300 leading-relaxed">
              Three things in the canon are called <span className="font-mono text-dark-100">Hudson</span>: a housekeeper, a seaman, and a street.
              A naive string-match collapses them all. Type-aware dedupe keeps them apart — the character &quot;Mrs. Hudson&quot; never merges with the location &quot;Hudson Street&quot;.
            </p>

            <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-start">
              {/* BEFORE — all three Hudsons together */}
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 mb-2">
                  Raw extractions (all called &ldquo;Hudson&rdquo;)
                </p>
                <div className="space-y-1 max-h-96 overflow-auto pr-2">
                  {data.collisionExample.flatMap((cluster) =>
                    cluster.variants.map((v, i) => (
                      <div
                        key={`${cluster.canonicalKey}-${v.workSlug}-${i}`}
                        className="flex items-baseline gap-3 px-3 py-2 rounded bg-dark-950/60 border border-dark-800 text-xs"
                      >
                        <span
                          className="text-[10px] font-mono uppercase tracking-[0.15em] shrink-0"
                          style={{ color: TYPE_COLOURS[v.type] ?? "#999" }}
                        >
                          {v.type}
                        </span>
                        <span className="font-mono text-dark-200 shrink-0">{v.label}</span>
                        <span className="font-mono text-[10px] text-dark-600 truncate flex-1">{v.workSlug}</span>
                        <span className="font-mono text-dark-400 tabular-nums shrink-0">{v.mentionCount}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* ARROW */}
              <div className="hidden md:flex items-center justify-center self-stretch">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 mb-2 text-center">
                    keep distinct
                  </span>
                  <svg width="40" height="40" viewBox="0 0 40 40">
                    <line x1="0" y1="8" x2="34" y2="8" stroke="#5c5252" strokeWidth="1.5" />
                    <path d="M28 2 L36 8 L28 14" fill="none" stroke="#5c5252" strokeWidth="1.5" />
                    <line x1="0" y1="20" x2="34" y2="20" stroke="#5c5252" strokeWidth="1.5" />
                    <path d="M28 14 L36 20 L28 26" fill="none" stroke="#5c5252" strokeWidth="1.5" />
                    <line x1="0" y1="32" x2="34" y2="32" stroke="#5c5252" strokeWidth="1.5" />
                    <path d="M28 26 L36 32 L28 38" fill="none" stroke="#5c5252" strokeWidth="1.5" />
                  </svg>
                </div>
              </div>

              {/* AFTER */}
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 mb-2">
                  Canonical entities (kept apart by type)
                </p>
                <div className="space-y-2">
                  {data.collisionExample.map((cluster) => (
                    <MergeBlock key={cluster.canonicalKey} cluster={cluster} />
                  ))}
                </div>
                <div className="text-xs text-dark-500 leading-relaxed pt-2">
                  String-equality dedupe would have shown one Hudson with the combined mention count of all three. Type-aware dedupe preserves the distinction. The graph stays honest.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
