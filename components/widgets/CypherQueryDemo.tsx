"use client";

import { useState } from "react";
import type { CypherDemo } from "../../lib/post0-data";

interface Props {
  demos: CypherDemo[];
}

// Tiny Cypher syntax highlighter
function HighlightedCypher({ query }: { query: string }) {
  const keywords = ["MATCH", "WHERE", "RETURN", "ORDER", "BY", "AS", "DISTINCT", "AND", "OR", "NOT", "DESC", "ASC", "count"];
  const lines = query.split("\n");
  return (
    <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap text-dark-200">
      {lines.map((line, li) => {
        const tokens = line.split(/(\s+|[(),{}])/);
        return (
          <div key={li}>
            {tokens.map((tok, ti) => {
              const upper = tok.toUpperCase();
              if (keywords.includes(upper) || keywords.includes(tok)) {
                return <span key={ti} className="text-crimson-400 font-semibold">{tok}</span>;
              }
              if (/^"[^"]*"$/.test(tok)) {
                return <span key={ti} className="text-emerald-400">{tok}</span>;
              }
              if (/:[A-Z][a-zA-Z]*/.test(tok)) {
                return <span key={ti} className="text-amber-400">{tok}</span>;
              }
              return <span key={ti}>{tok}</span>;
            })}
          </div>
        );
      })}
    </pre>
  );
}

export default function CypherQueryDemo({ demos }: Props) {
  const [activeId, setActiveId] = useState<string>(demos[0]?.id ?? "");
  const active = demos.find((d) => d.id === activeId) ?? demos[0];

  if (!active) return null;

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 overflow-hidden">
      {/* Header */}
      <div className="border-b border-dark-800 px-6 py-3 flex flex-wrap items-baseline gap-3">
        <p className="text-xs font-mono uppercase tracking-[0.15em] text-crimson-400">
          Live · Cypher
        </p>
        <span className="text-xs text-dark-500">
          Queries are real. Results are computed in-browser from the same data that lives in Neo4j after migration.
        </span>
      </div>

      {/* Query selector */}
      <div className="border-b border-dark-800 grid sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-dark-800">
        {demos.map((d) => {
          const isActive = d.id === active.id;
          return (
            <button
              key={d.id}
              onClick={() => setActiveId(d.id)}
              className={`text-left px-4 py-3 text-xs transition-colors ${
                isActive
                  ? "bg-crimson-500/5 text-dark-100"
                  : "text-dark-400 hover:text-dark-200 hover:bg-dark-850"
              }`}
            >
              <div className="font-medium leading-tight mb-1">{d.label}</div>
              <div className="text-dark-500 text-[10px] leading-snug">{d.intent}</div>
            </button>
          );
        })}
      </div>

      {/* Query body */}
      <div className="p-6 space-y-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 mb-2">
            Query
          </p>
          <div className="rounded bg-dark-950/60 border border-dark-800 p-4 overflow-x-auto">
            <HighlightedCypher query={active.query} />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500">
              Result
            </p>
            <p className="text-[10px] font-mono text-dark-600">
              {active.rowCount.toLocaleString()} row{active.rowCount === 1 ? "" : "s"}
              {active.rows.length < active.rowCount && ` · showing first ${active.rows.length}`}
            </p>
          </div>
          <div className="rounded bg-dark-950/60 border border-dark-800 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dark-800">
                  {active.columns.map((c) => (
                    <th
                      key={c}
                      className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-dark-500"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-dark-800/60 last:border-0 hover:bg-dark-850/40"
                  >
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2 text-dark-200 align-top">
                        {typeof cell === "number" ? (
                          <span className="font-mono tabular-nums text-crimson-300">{cell.toLocaleString()}</span>
                        ) : (
                          <span className={j === 0 ? "font-medium" : ""}>{cell}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {active.rows.length === 0 && (
                  <tr>
                    <td colSpan={active.columns.length} className="px-3 py-4 text-center text-dark-500 italic">
                      no rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
