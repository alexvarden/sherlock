"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { EntitySummary } from "../../lib/canon-types";

interface Props {
  entities: EntitySummary[];
}

type Filter = "character" | "location" | "object" | "all";

const TYPE_COLOURS: Record<string, string> = {
  character: "#e11d48",
  location: "#a855f7",
  object: "#7a6e6e",
  case: "#f59e0b",
  document: "#06b6d4",
  organisation: "#10b981",
  all: "#fb7185",
};

export default function MentionLongTail({ entities }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>("character");
  const [hovered, setHovered] = useState<{ label: string; rank: number; count: number; type: string } | null>(null);

  const data = useMemo(() => {
    const filtered = filter === "all" ? entities : entities.filter((e) => e.type === filter);
    return filtered
      .filter((e) => e.totalMentions > 0)
      .map((e, i) => ({
        rank: i + 1,
        label: e.label,
        count: e.totalMentions,
        type: e.type,
      }));
  }, [entities, filter]);

  const summary = useMemo(() => {
    if (data.length === 0) return null;
    const total = data.reduce((s, d) => s + d.count, 0);
    const top10Share = data.slice(0, 10).reduce((s, d) => s + d.count, 0) / total;
    const oneShot = data.filter((d) => d.count <= 2).length;
    return {
      total,
      count: data.length,
      top10Share,
      oneShot,
      oneShotPct: oneShot / data.length,
    };
  }, [data]);

  useEffect(() => {
    const svgEl = svgRef.current;
    const container = containerRef.current;
    if (!svgEl || !container || data.length === 0) return;

    const w = container.clientWidth || 700;
    const h = 320;
    const margin = { top: 12, right: 16, bottom: 36, left: 48 };

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${w} ${h}`);

    const xScale = d3.scaleLog()
      .domain([1, data.length])
      .range([margin.left, w - margin.right])
      .clamp(true);

    const yScale = d3.scaleLog()
      .domain([1, Math.max(2, d3.max(data, (d) => d.count) ?? 2)])
      .range([h - margin.bottom, margin.top])
      .clamp(true);

    // Axes
    const xAxis = d3.axisBottom(xScale)
      .ticks(6, "~s")
      .tickSizeOuter(0);

    const yAxis = d3.axisLeft(yScale)
      .ticks(6, "~s")
      .tickSizeOuter(0);

    svg.append("g")
      .attr("transform", `translate(0,${h - margin.bottom})`)
      .call(xAxis)
      .call((g) => g.selectAll("text").attr("fill", "#a19a9a").attr("font-family", "var(--font-mono)").attr("font-size", 10))
      .call((g) => g.selectAll("line, path").attr("stroke", "#433f3f"));

    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(yAxis)
      .call((g) => g.selectAll("text").attr("fill", "#a19a9a").attr("font-family", "var(--font-mono)").attr("font-size", 10))
      .call((g) => g.selectAll("line, path").attr("stroke", "#433f3f"));

    // Axis labels
    svg.append("text")
      .attr("x", w - margin.right)
      .attr("y", h - 6)
      .attr("fill", "#7a6e6e")
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", 9)
      .attr("text-anchor", "end")
      .text("rank (log)");
    svg.append("text")
      .attr("x", margin.left)
      .attr("y", 9)
      .attr("fill", "#7a6e6e")
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", 9)
      .text("mentions (log)");

    const colour = TYPE_COLOURS[filter] ?? "#fb7185";

    // Connecting line
    const line = d3.line<typeof data[number]>()
      .x((d) => xScale(d.rank))
      .y((d) => yScale(Math.max(1, d.count)));

    svg.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", colour)
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.4)
      .attr("d", line);

    // Dots
    svg.append("g")
      .selectAll("circle")
      .data(data)
      .join("circle")
      .attr("cx", (d) => xScale(d.rank))
      .attr("cy", (d) => yScale(Math.max(1, d.count)))
      .attr("r", (d) => (d.rank <= 5 ? 3.5 : d.rank <= 20 ? 2.5 : 1.6))
      .attr("fill", colour)
      .attr("fill-opacity", 0.85)
      .style("cursor", "pointer")
      .on("mouseenter", (_, d) => setHovered(d))
      .on("mouseleave", () => setHovered(null));

    // Labels for the top 5
    svg.append("g")
      .selectAll("text")
      .data(data.slice(0, 5))
      .join("text")
      .attr("x", (d) => xScale(d.rank) + 6)
      .attr("y", (d) => yScale(d.count) - 4)
      .attr("fill", "#d7c9c9")
      .attr("font-family", "var(--font-sans)")
      .attr("font-size", 10)
      .text((d) => d.label);

  }, [data, filter]);

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400 mr-2">
          Filter
        </span>
        {(["character", "location", "object", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${
              filter === f
                ? "text-dark-100"
                : "border-dark-800 text-dark-500 hover:text-dark-300 hover:border-dark-700"
            }`}
            style={
              filter === f
                ? { backgroundColor: `${TYPE_COLOURS[f]}20`, borderColor: `${TYPE_COLOURS[f]}60` }
                : undefined
            }
          >
            {f}
          </button>
        ))}
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="px-3 py-2 rounded bg-dark-950/60 border border-dark-800">
            <div className="text-dark-500 text-[10px] font-mono uppercase tracking-[0.15em]">
              entities
            </div>
            <div className="text-dark-100 font-semibold tabular-nums">{summary.count.toLocaleString()}</div>
          </div>
          <div className="px-3 py-2 rounded bg-dark-950/60 border border-dark-800">
            <div className="text-dark-500 text-[10px] font-mono uppercase tracking-[0.15em]">
              total mentions
            </div>
            <div className="text-dark-100 font-semibold tabular-nums">{summary.total.toLocaleString()}</div>
          </div>
          <div className="px-3 py-2 rounded bg-dark-950/60 border border-dark-800">
            <div className="text-dark-500 text-[10px] font-mono uppercase tracking-[0.15em]">
              top 10 carry
            </div>
            <div className="text-crimson-400 font-semibold tabular-nums">
              {(summary.top10Share * 100).toFixed(1)}%
            </div>
          </div>
          <div className="px-3 py-2 rounded bg-dark-950/60 border border-dark-800">
            <div className="text-dark-500 text-[10px] font-mono uppercase tracking-[0.15em]">
              ≤ 2 mentions
            </div>
            <div className="text-dark-100 font-semibold tabular-nums">
              {summary.oneShot.toLocaleString()} <span className="text-dark-500 font-normal">({(summary.oneShotPct * 100).toFixed(0)}%)</span>
            </div>
          </div>
        </div>
      )}

      <div ref={containerRef} className="bg-dark-950 rounded border border-dark-800">
        <svg ref={svgRef} style={{ width: "100%", height: 320 }} />
      </div>

      <div className="min-h-[52px] p-3 rounded bg-dark-950/60 border border-dark-800">
        {hovered ? (
          <p className="text-sm text-dark-200">
            <span className="font-medium">{hovered.label}</span>
            <span className="text-dark-500 font-mono text-xs ml-2">
              rank #{hovered.rank} · {hovered.count.toLocaleString()} mentions
            </span>
          </p>
        ) : (
          <p className="text-sm text-dark-500 italic">
            Hover any point. The top of the curve is the recurring cast; the tail is the canon&apos;s churn of one-shots.
          </p>
        )}
      </div>
    </div>
  );
}
