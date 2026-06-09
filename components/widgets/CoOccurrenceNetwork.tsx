"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { EntitySummary, CoOccurrenceEdge } from "../../lib/canon-types";

interface Props {
  entities: EntitySummary[];
  edges: CoOccurrenceEdge[];
}

type SimNode = d3.SimulationNodeDatum & {
  key: string;
  label: string;
  weight: number;
};

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  weight: number;
};

export default function CoOccurrenceNetwork({ entities, edges }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [minWeight, setMinWeight] = useState(2);
  const [hovered, setHovered] = useState<{ label: string; weight: number; works: number } | null>(null);

  const characterByKey = useMemo(() => {
    const m = new Map<string, EntitySummary>();
    for (const e of entities) if (e.type === "character") m.set(e.key, e);
    return m;
  }, [entities]);

  useEffect(() => {
    const svgEl = svgRef.current;
    const container = containerRef.current;
    if (!svgEl || !container) return;

    const filteredEdges = edges.filter((e) => e.weight >= minWeight);
    const includedKeys = new Set<string>();
    for (const e of filteredEdges) {
      includedKeys.add(e.a);
      includedKeys.add(e.b);
    }

    const nodes: SimNode[] = Array.from(includedKeys)
      .map((key) => {
        const ent = characterByKey.get(key);
        if (!ent) return null;
        return { key, label: ent.label, weight: ent.totalMentions };
      })
      .filter((n): n is SimNode => n !== null);

    const links: SimLink[] = filteredEdges
      .filter((e) => characterByKey.has(e.a) && characterByKey.has(e.b))
      .map((e) => ({ source: e.a, target: e.b, weight: e.weight }));

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const w = container.clientWidth || 800;
    const h = 480;
    svg.attr("viewBox", `0 0 ${w} ${h}`);

    const g = svg.append("g");
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.4, 4])
        .on("zoom", (ev) => g.attr("transform", ev.transform))
    );

    const linkSel = g.append("g")
      .attr("stroke", "#9f1239")
      .attr("stroke-opacity", 0.35)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", (d) => Math.min(4, Math.sqrt(d.weight) * 0.7));

    const nodeSel = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "grab");

    const radius = (n: SimNode) => Math.max(4, Math.min(22, Math.sqrt(n.weight) * 0.6));

    nodeSel.append("circle")
      .attr("r", radius)
      .attr("fill", (d) => d.key === "sherlock_holmes" || d.key === "watson" ? "#e11d48" : "#7a6e6e")
      .attr("stroke", "#0a0909")
      .attr("stroke-width", 1.5);

    nodeSel.append("text")
      .text((d) => d.label)
      .attr("x", (d) => radius(d) + 4)
      .attr("y", 4)
      .attr("font-size", 11)
      .attr("font-family", "var(--font-sans)")
      .attr("fill", "#c6b3b3")
      .attr("pointer-events", "none");

    nodeSel
      .on("mouseenter", (_, d) => {
        const ent = characterByKey.get(d.key);
        setHovered({
          label: d.label,
          weight: d.weight,
          works: ent?.works.length ?? 0,
        });
      })
      .on("mouseleave", () => setHovered(null));

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links)
        .id((d) => d.key)
        .distance((l) => 60 + 100 / Math.sqrt(l.weight))
        .strength((l) => Math.min(1, l.weight / 30)))
      .force("charge", d3.forceManyBody().strength(-180))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collision", d3.forceCollide((d) => radius(d as SimNode) + 8));

    sim.on("tick", () => {
      linkSel
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0);
      nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    const drag = d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeSel.call(drag);

    return () => { sim.stop(); };
  }, [edges, characterByKey, minWeight]);

  const maxWeight = useMemo(() => edges.reduce((m, e) => Math.max(m, e.weight), 0), [edges]);

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400">
          Min shared sections
        </label>
        <input
          type="range"
          min={1}
          max={Math.min(20, maxWeight)}
          value={minWeight}
          onChange={(e) => setMinWeight(Number(e.target.value))}
          className="flex-1 max-w-xs accent-crimson-500"
        />
        <span className="text-xs font-mono tabular-nums text-dark-300">
          ≥ {minWeight}
        </span>
        <span className="text-xs text-dark-500 ml-auto">
          {hovered ? (
            <span className="text-dark-200">
              <span className="font-medium">{hovered.label}</span> · {hovered.weight} mentions · {hovered.works} works
            </span>
          ) : (
            "Drag nodes to rearrange. Scroll to zoom."
          )}
        </span>
      </div>

      <div ref={containerRef} className="bg-dark-950 rounded border border-dark-800">
        <svg ref={svgRef} style={{ width: "100%", height: 480 }} />
      </div>

      <div className="flex items-center gap-6 text-xs text-dark-500">
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-crimson-500" />
          Holmes / Watson
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-dark-500" />
          Other recurring characters
        </span>
        <span className="ml-auto">node size = mention count · edge weight = shared sections</span>
      </div>
    </div>
  );
}
