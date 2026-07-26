"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "../../lib/d3";
import type { EntitySummary, CoOccurrenceEdge } from "../../lib/canon-types";
import { entityTypeById } from "../../lib/graph-schema";
import ZoomControls from "../ZoomControls";

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

// Same visual language as KnowledgeGraphViewer: character nodes take the
// schema's character colour, everyone else drops to the schema fallback grey.
const CHARACTER_COLOR = entityTypeById.get("character")?.color ?? "#e11d48";
const SUPPORTING_COLOR = "#6b7280";
const LABEL_BG = "#0a0909";
const LABEL_FILL = "#d7c9c9";

export default function CoOccurrenceNetwork({ entities, edges }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
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
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .filter((event) => {
        if (event.type === "wheel") return event.ctrlKey || event.metaKey;
        return !event.button;
      })
      .on("zoom", (ev) => g.attr("transform", ev.transform));
    svg.call(zoom);
    zoomRef.current = zoom;

    fitRef.current = () => {
      const node = g.node();
      if (!node) return;
      const bounds = node.getBBox();
      if (!bounds.width || !bounds.height) return;
      const padding = 60;
      const scale = Math.min((w - padding) / bounds.width, (h - padding) / bounds.height, 2);
      const tx = w / 2 - scale * (bounds.x + bounds.width / 2);
      const ty = h / 2 - scale * (bounds.y + bounds.height / 2);
      svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    };

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
      .attr("cursor", "pointer");

    const radius = (n: SimNode) => Math.max(4, Math.min(22, Math.sqrt(n.weight) * 0.6));
    const isLead = (n: SimNode) => n.key === "sherlock_holmes" || n.key === "watson";

    nodeSel.append("circle")
      .attr("r", radius)
      .attr("fill", (d) => (isLead(d) ? CHARACTER_COLOR : SUPPORTING_COLOR))
      .attr("stroke", "transparent")
      .attr("stroke-width", 2.5);

    // Label pill below the node — mirrors the viewer's node-label treatment.
    const labelGroup = nodeSel
      .append("g")
      .attr("class", "node-label")
      .attr("pointer-events", "none");
    labelGroup
      .append("rect")
      .attr("rx", 3)
      .attr("ry", 3)
      .attr("fill", LABEL_BG)
      .attr("opacity", 0.88);
    labelGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("fill", LABEL_FILL)
      .text((d) => d.label)
      .each(function (d) {
        const bbox = (this as SVGTextElement).getBBox();
        const pad = 3;
        const baseOffset = radius(d) + 10;
        d3.select(this).attr("y", baseOffset);
        d3.select((this as SVGTextElement).previousElementSibling as SVGRectElement)
          .attr("x", bbox.x - pad)
          .attr("y", baseOffset - bbox.height + 1)
          .attr("width", bbox.width + pad * 2)
          .attr("height", bbox.height + pad);
      });

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

    nodeSel.call(drag as unknown as (sel: typeof nodeSel) => void);

    return () => {
      sim.stop();
      zoomRef.current = null;
      fitRef.current = null;
    };
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
        <span className="text-xs text-dark-600 ml-auto">
          {hovered ? (
            <span className="text-dark-200">
              <span className="font-medium">{hovered.label}</span> · {hovered.weight} mentions · {hovered.works} works
            </span>
          ) : (
            "⌘/ctrl-scroll zoom · drag nodes"
          )}
        </span>
      </div>

      <div ref={containerRef} className="relative bg-dark-950 rounded border border-dark-800 overflow-hidden">
        <svg ref={svgRef} style={{ width: "100%", height: 480 }} />
        <ZoomControls
          onFit={() => fitRef.current?.()}
          onZoom={(factor) => {
            const svg = svgRef.current;
            const zoom = zoomRef.current;
            if (!svg || !zoom) return;
            d3.select(svg).transition().duration(200).call(zoom.scaleBy, factor);
          }}
        />
      </div>

      <div className="flex items-center gap-6 text-xs text-dark-500">
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: CHARACTER_COLOR }} />
          Holmes / Watson
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: SUPPORTING_COLOR }} />
          Other recurring characters
        </span>
        <span className="ml-auto">node size = mention count · edge weight = shared sections</span>
      </div>
    </div>
  );
}
