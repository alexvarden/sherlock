"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { FrequencyByType } from "@/lib/canon-types";

interface Props {
  frequency: FrequencyByType[];
}

const TYPE_COLOURS: Record<string, string> = {
  character: "#e11d48",     // crimson
  location: "#a855f7",      // purple
  object: "#7a6e6e",        // warm gray
  organisation: "#10b981",  // emerald
  document: "#06b6d4",      // cyan
  case: "#f59e0b",          // amber
};

interface LeafDatum {
  type: string;
  label: string;
  count: number;
  works: number;
}

type TreeNode = {
  name: string;
  children?: TreeNode[];
  value?: number;
  data?: LeafDatum;
};

export default function FrequencyTree({ frequency }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(
    () => new Set(frequency.map((f) => f.type))
  );
  const [hovered, setHovered] = useState<LeafDatum | null>(null);

  const root: TreeNode = useMemo(() => ({
    name: "canon",
    children: frequency
      .filter((f) => enabledTypes.has(f.type))
      .map((f) => ({
        name: f.type,
        children: f.items.map((i) => ({
          name: i.label,
          value: i.count,
          data: {
            type: f.type,
            label: i.label,
            count: i.count,
            works: i.works,
          },
        })),
      })),
  }), [frequency, enabledTypes]);

  useEffect(() => {
    const svgEl = svgRef.current;
    const container = containerRef.current;
    if (!svgEl || !container) return;

    const w = container.clientWidth || 800;
    const h = 520;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${w} ${h}`);

    const hierarchy = d3.hierarchy(root)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    d3.treemap<TreeNode>()
      .size([w, h])
      .paddingOuter(2)
      .paddingTop(20)
      .paddingInner(1)
      .round(true)(hierarchy);

    // Render type group rectangles + labels
    const typeGroups = svg.append("g")
      .selectAll("g")
      .data(hierarchy.children ?? [])
      .join("g");

    type Node = d3.HierarchyRectangularNode<TreeNode>;

    typeGroups.append("rect")
      .attr("x", (d) => (d as Node).x0)
      .attr("y", (d) => (d as Node).y0)
      .attr("width", (d) => (d as Node).x1 - (d as Node).x0)
      .attr("height", (d) => (d as Node).y1 - (d as Node).y0)
      .attr("fill", "transparent")
      .attr("stroke", (d) => TYPE_COLOURS[d.data.name] ?? "#666")
      .attr("stroke-opacity", 0.4)
      .attr("rx", 4);

    typeGroups.append("text")
      .attr("x", (d) => (d as Node).x0 + 6)
      .attr("y", (d) => (d as Node).y0 + 14)
      .attr("font-size", 11)
      .attr("font-family", "var(--font-mono)")
      .attr("text-transform", "uppercase")
      .attr("fill", (d) => TYPE_COLOURS[d.data.name] ?? "#999")
      .text((d) => `${d.data.name} · ${(d.value ?? 0).toLocaleString()}`);

    // Render leaves
    const leaves = svg.append("g")
      .selectAll("g")
      .data(hierarchy.leaves())
      .join("g")
      .attr("transform", (d) => `translate(${(d as Node).x0},${(d as Node).y0})`);

    leaves.append("rect")
      .attr("width", (d) => Math.max(0, (d as Node).x1 - (d as Node).x0))
      .attr("height", (d) => Math.max(0, (d as Node).y1 - (d as Node).y0))
      .attr("fill", (d) => {
        const typeName = d.parent?.data.name ?? "object";
        return TYPE_COLOURS[typeName] ?? "#666";
      })
      .attr("fill-opacity", (d) => 0.35 + Math.min(0.5, (d.value ?? 0) / 1000))
      .attr("stroke", "#0a0909")
      .attr("stroke-width", 0.5)
      .style("cursor", "pointer")
      .on("mouseenter", function (_, d) {
        setHovered(d.data.data ?? null);
        d3.select(this).attr("fill-opacity", 0.85);
      })
      .on("mouseleave", function (_, d) {
        setHovered(null);
        d3.select(this).attr("fill-opacity", 0.35 + Math.min(0.5, (d.value ?? 0) / 1000));
      });

    leaves.append("text")
      .each(function (d) {
        const node = d as Node;
        const w = node.x1 - node.x0;
        const h = node.y1 - node.y0;
        if (w < 35 || h < 16) return;
        const text = d3.select(this);
        const label = d.data.name.length > 22 ? d.data.name.slice(0, 20) + "…" : d.data.name;
        text
          .attr("x", 4)
          .attr("y", 12)
          .attr("font-size", 10)
          .attr("font-family", "var(--font-sans)")
          .attr("fill", "#fff")
          .attr("fill-opacity", 0.9)
          .attr("pointer-events", "none")
          .text(label);
      });
  }, [root]);

  const toggleType = (type: string) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400 mr-2">
          Types
        </span>
        {frequency.map((f) => {
          const active = enabledTypes.has(f.type);
          const colour = TYPE_COLOURS[f.type];
          return (
            <button
              key={f.type}
              onClick={() => toggleType(f.type)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                active
                  ? "border-transparent text-dark-100"
                  : "border-dark-700 text-dark-500 hover:text-dark-300"
              }`}
              style={active ? { backgroundColor: colour, opacity: 0.85 } : undefined}
            >
              {f.type}
              <span className="ml-1.5 text-[10px] opacity-75 font-mono">
                {f.total.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      <div ref={containerRef} className="bg-dark-950 rounded border border-dark-800">
        <svg ref={svgRef} style={{ width: "100%", height: 520 }} />
      </div>

      <div className="min-h-[60px] mt-2 p-4 rounded bg-dark-950/60 border border-dark-800">
        {hovered ? (
          <div className="flex items-center gap-3">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ backgroundColor: TYPE_COLOURS[hovered.type] }}
            />
            <span className="text-sm text-dark-100 font-medium">{hovered.label}</span>
            <span className="text-xs text-dark-500 font-mono">
              {hovered.type} · {hovered.count.toLocaleString()} mentions · {hovered.works} {hovered.works === 1 ? "work" : "works"}
            </span>
          </div>
        ) : (
          <p className="text-sm text-dark-500 italic">
            Hover any block. Toggle types above to focus.
          </p>
        )}
      </div>
    </div>
  );
}
