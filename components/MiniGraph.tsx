"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { Entity, EntityType, ObjectiveEvent, StateEdge } from "@/lib/types";

const NODE_COLORS: Record<EntityType, string> = {
  character: "#e11d48",  // crimson-500 (Crane brand accent)
  location: "#a855f7",   // purple-500
  object: "#6b7280",     // gray-500
  case: "#f59e0b",       // amber-500
  document: "#06b6d4",   // cyan-500
  organisation: "#10b981", // emerald-500
};

const EVENT_COLOR = "#E67E22";
const COMMUNICATE_COLOR = "#F1C40F";

type RenderNode =
  | (Entity      & { kind: "entity"; x?: number; y?: number; fx?: number | null; fy?: number | null })
  | (ObjectiveEvent & { kind: "event";  x?: number; y?: number; fx?: number | null; fy?: number | null });

export default function MiniGraph({
  entities,
  events,
  stateEdges,
  highlightId,
  height = 260,
}: {
  entities: Entity[];
  events: ObjectiveEvent[];
  stateEdges: StateEdge[];
  highlightId?: string;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    const svg = d3.select(el);
    svg.selectAll("*").remove();

    if (entities.length === 0 && events.length === 0) return;

    const w = el.clientWidth || 500;
    const h = height;

    // ── Defs ───────────────────────────────────────────────────────────────
    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "mini-arrow")
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 18)
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4")
      .attr("fill", "#444");

    const g = svg.append("g");

    // Basic zoom/pan so users can explore if needed
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on("zoom", (ev) => g.attr("transform", ev.transform))
    );

    // ── Nodes + links ──────────────────────────────────────────────────────
    const entityIds = new Set(entities.map((e) => e.id));

    const nodes: RenderNode[] = [
      ...entities.map((e) => ({ ...e, kind: "entity" as const })),
      ...events
        .filter((ev) => ev.participants.some((p) => entityIds.has(p)))
        .map((ev) => ({ ...ev, kind: "event" as const })),
    ];

    const nodeIds = new Set(nodes.map((n) => n.id));

    type Link = { source: string; target: string; kind: "state" | "participation" | "comm" };
    const links: Link[] = [];

    // State edges
    for (const e of stateEdges) {
      if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
        links.push({ source: e.from, target: e.to, kind: "state" });
      }
    }

    // Participation edges (event → entity)
    for (const ev of events) {
      if (!nodeIds.has(ev.id)) continue;
      for (const pid of ev.participants) {
        if (nodeIds.has(pid)) links.push({ source: ev.id, target: pid, kind: "participation" });
      }
      if (ev.communicates) {
        for (const rid of ev.communicates.recipients) {
          if (nodeIds.has(rid) && nodeIds.has(ev.communicates.speaker)) {
            links.push({ source: ev.communicates.speaker, target: rid, kind: "comm" });
          }
        }
      }
    }

    // ── Simulation ─────────────────────────────────────────────────────────
    const sim = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force("link", d3.forceLink(links)
        .id((d) => (d as { id: string }).id)
        .distance((l) => {
          const ll = l as unknown as Link;
          return ll.kind === "participation" ? 55 : ll.kind === "comm" ? 90 : 110;
        }))
      .force("charge", d3.forceManyBody().strength(-220))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collision", d3.forceCollide((d) => (d as RenderNode).kind === "event" ? 18 : 28));

    // ── Links ──────────────────────────────────────────────────────────────
    const link = g.append("g").selectAll("line").data(links).join("line")
      .attr("stroke", (d) =>
        d.kind === "comm" ? COMMUNICATE_COLOR :
        d.kind === "participation" ? "#2d3748" : "#3b5068")
      .attr("stroke-opacity", (d) => d.kind === "participation" ? 0.45 : 0.7)
      .attr("stroke-width", (d) => d.kind === "participation" ? 1 : 1.5)
      .attr("stroke-dasharray", (d) => d.kind === "participation" ? "2,3" : "none")
      .attr("marker-end", (d) => d.kind === "state" ? "url(#mini-arrow)" : null);

    // ── Nodes ──────────────────────────────────────────────────────────────
    const node = g.append("g").selectAll("g").data(nodes).join("g")
      .attr("cursor", "default");

    // Entity circles
    node.filter((d) => d.kind === "entity")
      .append("circle")
      .attr("r", (d) => {
        const isHighlight = d.id === highlightId;
        return (d as Entity).type === "character" ? (isHighlight ? 16 : 13) : 9;
      })
      .attr("fill", (d) => NODE_COLORS[(d as Entity).type])
      .attr("fill-opacity", 0.85)
      .attr("stroke", (d) => d.id === highlightId ? "#fff" : "transparent")
      .attr("stroke-width", 2);

    // Event diamonds
    node.filter((d) => d.kind === "event")
      .append("rect")
      .attr("x", -6).attr("y", -6)
      .attr("width", 12).attr("height", 12)
      .attr("transform", "rotate(45)")
      .attr("fill", (d) => (d as ObjectiveEvent).communicates ? COMMUNICATE_COLOR : EVENT_COLOR)
      .attr("opacity", 0.8);

    // Labels — always show for characters, hover for everything else
    const labelGroup = node.append("g")
      .attr("pointer-events", "none")
      .attr("opacity", (d) => d.kind === "entity" && (d as Entity).type === "character" ? 1 : 0)
      .attr("class", "mini-label");

    labelGroup.append("rect").attr("rx", 2).attr("fill", "#0a0909").attr("opacity", 0.9);

    labelGroup.append("text")
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", (d) => d.kind === "event" ? "#fbd38d" : "#cbd5e1")
      .text((d) => d.kind === "entity" ? (d as Entity).label : (d as ObjectiveEvent).label.slice(0, 40))
      .each(function (d) {
        const bbox = (this as SVGTextElement).getBBox();
        const pad = 3;
        const yOff = d.kind === "entity" && (d as Entity).type === "character" ? 22 : 16;
        d3.select(this).attr("y", yOff);
        d3.select((this as SVGTextElement).previousElementSibling as SVGRectElement)
          .attr("x", bbox.x - pad).attr("y", yOff - bbox.height)
          .attr("width", bbox.width + pad * 2).attr("height", bbox.height + pad);
      });

    node
      .on("mouseenter", function (_, d) {
        if (!(d.kind === "entity" && (d as Entity).type === "character")) {
          d3.select(this).select(".mini-label").attr("opacity", 1);
        }
      })
      .on("mouseleave", function (_, d) {
        if (!(d.kind === "entity" && (d as Entity).type === "character")) {
          d3.select(this).select(".mini-label").attr("opacity", 0);
        }
      });

    // ── Tick ──────────────────────────────────────────────────────────────
    sim.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as unknown as RenderNode).x ?? 0)
        .attr("y1", (d) => (d.source as unknown as RenderNode).y ?? 0)
        .attr("x2", (d) => (d.target as unknown as RenderNode).x ?? 0)
        .attr("y2", (d) => (d.target as unknown as RenderNode).y ?? 0);
      node.attr("transform", (d) => `translate(${(d as RenderNode).x ?? 0},${(d as RenderNode).y ?? 0})`);
    });

    return () => { sim.stop(); };
  }, [entities, events, stateEdges, highlightId, height]);

  return (
    <svg
      ref={svgRef}
      style={{ width: "100%", height }}
      className="bg-dark-950 rounded-lg"
    />
  );
}
