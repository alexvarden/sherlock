"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import type {
  Clue,
  Entity,
  EntityType,
  LexicalGraph,
  LexicalNode,
  MemberOf,
  Mention,
  ObjectiveGraph,
  ObjectiveEvent,
  StateEdge,
  SectionMeta,
  Modality,
} from "../lib/types";
import {
  entityTypes,
  entityTypeById,
  edgeTypes,
  edgeStroke,
  edgeOpacity,
  edgeDash,
  type LinkKind,
} from "../lib/graph-schema";
import { buildCharacterState, listCharacters } from "../lib/character-state";

// ── Constants ─────────────────────────────────────────────────────────────

const NODE_TYPES = entityTypes.map((t) => t.id);
const entityColor = (t: EntityType): string => entityTypeById.get(t)?.color ?? "#6b7280";
const entityRadius = (t: EntityType): number => entityTypeById.get(t)?.radius ?? 12;
const entityLabel = (t: EntityType): string => entityTypeById.get(t)?.label ?? t;

const MODALITY_STYLES: Record<Modality, { label: string; color: string }> = {
  OBSERVED: { label: "Observed", color: "#22c55e" },  // green-500
  TOLD: { label: "Told", color: "#f97316" },           // orange-500
  INFERRED: { label: "Inferred", color: "#8b5cf6" },   // violet-500
  ASSUMED: { label: "Assumed", color: "#6b7280" },     // gray-500
};

// d3 simulation augmentation
type SimEntity = Entity & { x?: number; y?: number; fx?: number | null; fy?: number | null };

// Unified node type for the graph (entities + events)
type GraphRenderNode =
  | (Entity & { kind: "entity"; x?: number; y?: number; fx?: number | null; fy?: number | null })
  | (ObjectiveEvent & { kind: "event"; x?: number; y?: number; fx?: number | null; fy?: number | null });

// Simulation link — `source`/`target` start as ids and get rewritten to node
// references by d3.forceLink once the simulation runs.
type SimLink = {
  source: string | GraphRenderNode;
  target: string | GraphRenderNode;
  kind: LinkKind;
  active?: boolean;
  label?: string;
};

const EVENT_COLOR = "#E67E22";
const COMMUNICATE_COLOR = edgeTypes.communicates.color;
const CLUE_COLOR = edgeTypes.clue.color;
const MEMBER_COLOR = edgeTypes.member.color;
const MENTION_HALO = "#94a3b8";      // slate-400 — halo for entities mentioned this section

// ── Component ─────────────────────────────────────────────────────────────

export default function KnowledgeGraphViewer({
  slug,
  lexical,
  objective,
  initialSection,
  initialCharacter,
}: {
  slug: string;
  lexical: LexicalGraph;
  objective: ObjectiveGraph | null;
  initialSection?: string;
  initialCharacter?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const fitToBoundsRef = useRef<(() => void) | null>(null);

  const sections = lexical.sections;

  // Sentence ranges per section — the bridge between sentence-precise scrubbing
  // and section-as-temporal-unit. `start` is the first global sentence position
  // of the section, `count` is its size.
  const sectionRanges = useMemo<Array<{ start: number; count: number }>>(() => {
    const r: Array<{ start: number; count: number }> = [];
    let cursor = 0;
    for (const sec of sections) {
      let count = 0;
      for (const n of lexical.nodes) if (n.section === sec.id) count++;
      r.push({ start: cursor, count });
      cursor += count;
    }
    return r;
  }, [sections, lexical.nodes]);

  const totalSentences = lexical.nodes.length;

  // Source of truth: which sentence the playhead is on (0..totalSentences-1).
  const [sentenceIdx, setSentenceIdx] = useState<number>(() => {
    if (!initialSection) return 0;
    const idx = sections.findIndex((s) => s.id === initialSection);
    return idx >= 0 ? (sectionRanges[idx]?.start ?? 0) : 0;
  });

  // Derived: which section the playhead is in. Event filtering, perspective
  // logic, and the right-pane reading all key off this (so they snap to section).
  const currentIdx = useMemo<number>(() => {
    for (let i = 0; i < sectionRanges.length; i++) {
      const r = sectionRanges[i];
      if (sentenceIdx < r.start + r.count) return i;
    }
    return Math.max(0, sectionRanges.length - 1);
  }, [sentenceIdx, sectionRanges]);

  // Helpers used by keyboard nav and stripe clicks — move by whole section.
  const goToSection = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(sections.length - 1, idx));
    setSentenceIdx(sectionRanges[clamped]?.start ?? 0);
  }, [sectionRanges, sections.length]);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<EntityType>>(new Set(NODE_TYPES));
  const [showPastEdges, setShowPastEdges] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showMentions, setShowMentions] = useState(true);
  const [showClues, setShowClues] = useState(true);
  const [showMemberships, setShowMemberships] = useState(true);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(initialCharacter ?? null);

  const currentSection = sections[currentIdx];

  const toggleType = useCallback((type: EntityType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Keyboard nav — arrows step by whole section.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        goToSection(currentIdx + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        goToSection(currentIdx - 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goToSection, currentIdx]);

  // ── Derived data ──────────────────────────────────────────────────────
  const sectionIdToIdx = useMemo(() => {
    const m = new Map<string, number>();
    sections.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [sections]);

  const characters = useMemo(
    () => objective?.entities.filter((e) => e.type === "character") ?? [],
    [objective]
  );

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === selectedCharacterId) ?? null,
    [characters, selectedCharacterId]
  );

  // ── Lexical helpers ─────────────────────────────────────────────────
  // We resolve every visibility threshold to a *sentence position* so the graph
  // can grow / shrink one sentence at a time as the playhead moves.
  const lexicalNodeById = useMemo<Map<string, LexicalNode>>(() => {
    const m = new Map<string, LexicalNode>();
    for (const n of lexical.nodes) m.set(n.id, n);
    return m;
  }, [lexical]);

  const sectionStartPos = useMemo<number[]>(
    () => sectionRanges.map((r) => r.start),
    [sectionRanges]
  );

  // Earliest global sentence position from a list of source_node ids — falls
  // back to the start of the named section when none of the ids resolve.
  const minSourcePos = useCallback(
    (sourceNodes: string[] | undefined, fallbackSection: string): number => {
      let min = Infinity;
      if (sourceNodes) {
        for (const sid of sourceNodes) {
          const n = lexicalNodeById.get(sid);
          if (n && n.position < min) min = n.position;
        }
      }
      if (min === Infinity) {
        const sIdx = sectionIdToIdx.get(fallbackSection) ?? 0;
        min = sectionStartPos[sIdx] ?? 0;
      }
      return min;
    },
    [lexicalNodeById, sectionIdToIdx, sectionStartPos]
  );

  // Sentence-precise first-appearance for each event / mention / entity.
  const eventFirstPos = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    if (!objective) return m;
    for (const ev of objective.events) {
      m.set(ev.id, minSourcePos(ev.source_nodes, ev.section));
    }
    return m;
  }, [objective, minSourcePos]);

  // Indexed by `${entity}|${section}|${i}` — there can be multiple Mention
  // records per (entity, section) pair so we key by array index too.
  const mentionFirstPos = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    if (!objective) return m;
    objective.mentions.forEach((mn, i) => {
      m.set(`${mn.entity}|${mn.section}|${i}`, minSourcePos(mn.sentence_ids, mn.section));
    });
    return m;
  }, [objective, minSourcePos]);

  // First sentence at which an entity actually appears in the narrative —
  // i.e. earliest of (participates in an event | is named in a mention |
  // is a recipient of a communicates event). Entities that never appear stay
  // at Infinity and never enter the graph. This is what makes the graph grow
  // sentence-by-sentence; using `firstSection.start` instead would dump every
  // entity introduced anywhere in that section onto the first sentence.
  const entityFirstPos = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    if (!objective) return m;
    for (const e of objective.entities) m.set(e.id, Infinity);
    for (const ev of objective.events) {
      const pos = eventFirstPos.get(ev.id) ?? Infinity;
      for (const pid of ev.participants) {
        if (pos < (m.get(pid) ?? Infinity)) m.set(pid, pos);
      }
      if (ev.communicates) {
        for (const r of ev.communicates.recipients) {
          if (pos < (m.get(r) ?? Infinity)) m.set(r, pos);
        }
      }
    }
    objective.mentions.forEach((mn, i) => {
      const pos = mentionFirstPos.get(`${mn.entity}|${mn.section}|${i}`) ?? Infinity;
      if (pos < (m.get(mn.entity) ?? Infinity)) m.set(mn.entity, pos);
    });
    return m;
  }, [objective, eventFirstPos, mentionFirstPos]);

  // Character perspective: events this character participated in or was told about.
  // Without a character filter, return all events up to the current sentence.
  const visibleEvents = useMemo<ObjectiveEvent[]>(() => {
    if (!objective) return [];
    const upTo = objective.events.filter(
      (ev) => (eventFirstPos.get(ev.id) ?? Infinity) <= sentenceIdx
    );
    if (!selectedCharacterId) return upTo;
    return upTo.filter(
      (ev) =>
        ev.participants.includes(selectedCharacterId) ||
        ev.communicates?.recipients.includes(selectedCharacterId)
    );
  }, [objective, sentenceIdx, eventFirstPos, selectedCharacterId]);

  // Entities mentioned somewhere up to the playhead. Mention edges promote
  // entities into view even when they haven't yet acted.
  const mentionsByEntity = useMemo<Map<string, Mention[]>>(() => {
    const m = new Map<string, Mention[]>();
    if (!objective) return m;
    objective.mentions.forEach((mention, i) => {
      const pos = mentionFirstPos.get(`${mention.entity}|${mention.section}|${i}`) ?? Infinity;
      if (pos > sentenceIdx) return;
      if (!m.has(mention.entity)) m.set(mention.entity, []);
      m.get(mention.entity)!.push(mention);
    });
    return m;
  }, [objective, sentenceIdx, mentionFirstPos]);

  // Entity ids whose mention falls inside the current section AND has been
  // reached by the playhead — drives the halo on "named here" entities.
  const mentionedInCurrentSection = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    if (!objective) return s;
    objective.mentions.forEach((mn, i) => {
      if (mn.section !== currentSection.id) return;
      const pos = mentionFirstPos.get(`${mn.entity}|${mn.section}|${i}`) ?? Infinity;
      if (pos <= sentenceIdx) s.add(mn.entity);
    });
    return s;
  }, [objective, currentSection, sentenceIdx, mentionFirstPos]);

  // When a character is selected, only include entities that appear alongside them.
  // Mentions count too (when showMentions is enabled) so named-but-not-present entities surface.
  const visibleEntities = useMemo<Entity[]>(() => {
    if (!objective) return [];
    const isInView = (e: Entity): boolean => {
      const pos = entityFirstPos.get(e.id) ?? Infinity;
      if (pos <= sentenceIdx) return true;
      if (showMentions && mentionsByEntity.has(e.id)) return true;
      return false;
    };
    if (!selectedCharacterId) {
      return objective.entities.filter((e) => activeTypes.has(e.type) && isInView(e));
    }
    const inScope = new Set<string>([selectedCharacterId]);
    for (const ev of visibleEvents) {
      for (const pid of ev.participants) inScope.add(pid);
    }
    return objective.entities.filter(
      (e) => activeTypes.has(e.type) && inScope.has(e.id) && isInView(e)
    );
  }, [
    objective,
    activeTypes,
    sentenceIdx,
    entityFirstPos,
    selectedCharacterId,
    visibleEvents,
    showMentions,
    mentionsByEntity,
  ]);

  const sectionEvents = useMemo<ObjectiveEvent[]>(() => {
    if (!objective) return [];
    return objective.events.filter((ev) => ev.section === currentSection.id);
  }, [objective, currentSection]);

  // State edges: classify as active vs past relative to sentenceIdx.
  const visibleEdges = useMemo<Array<StateEdge & { active: boolean }>>(() => {
    if (!objective) return [];
    const visibleEntityIds = new Set(visibleEntities.map((e) => e.id));
    return objective.stateEdges
      .filter((edge) => visibleEntityIds.has(edge.from) && visibleEntityIds.has(edge.to))
      .map((edge) => {
        const fromPos = eventFirstPos.get(edge.valid_from) ?? 0;
        if (fromPos > sentenceIdx) return null;
        const untilPos = edge.valid_until
          ? eventFirstPos.get(edge.valid_until) ?? Infinity
          : Infinity;
        const active = sentenceIdx < untilPos;
        if (!active && !showPastEdges) return null;
        return { ...edge, active };
      })
      .filter((e): e is StateEdge & { active: boolean } => e !== null);
  }, [objective, visibleEntities, sentenceIdx, showPastEdges, eventFirstPos]);

  // Entities whose first-visible sentence equals the playhead — drives the
  // brief "+N new" callout and the white-stroke entry highlight.
  const newEntityIds = useMemo<Set<string>>(() => {
    if (!objective) return new Set();
    const ids = new Set<string>();
    for (const e of objective.entities) {
      const pos = entityFirstPos.get(e.id) ?? Infinity;
      if (pos === sentenceIdx) ids.add(e.id);
    }
    return ids;
  }, [objective, sentenceIdx, entityFirstPos]);

  // Clues visible at sentenceIdx — both endpoints must be in view.
  const visibleClues = useMemo<Clue[]>(() => {
    if (!objective || !showClues) return [];
    const ids = new Set(visibleEntities.map((e) => e.id));
    return objective.clues.filter((c) => {
      if (!ids.has(c.object) || !ids.has(c.case)) return false;
      const pos = minSourcePos(c.source_nodes, c.discovered_in_section);
      return pos <= sentenceIdx;
    });
  }, [objective, showClues, visibleEntities, sentenceIdx, minSourcePos]);

  // Memberships visible at sentenceIdx — flag active vs past based on validUntil event.
  const visibleMemberships = useMemo<Array<MemberOf & { active: boolean }>>(() => {
    if (!objective || !showMemberships) return [];
    const ids = new Set(visibleEntities.map((e) => e.id));
    return objective.memberOf
      .filter((m) => ids.has(m.character) && ids.has(m.organisation))
      .map((m) => {
        const fromPos = m.valid_from ? eventFirstPos.get(m.valid_from) ?? 0 : 0;
        if (fromPos > sentenceIdx) return null;
        const untilPos = m.valid_until
          ? eventFirstPos.get(m.valid_until) ?? Infinity
          : Infinity;
        const active = sentenceIdx < untilPos;
        if (!active && !showPastEdges) return null;
        return { ...m, active };
      })
      .filter((m): m is MemberOf & { active: boolean } => m !== null);
  }, [objective, showMemberships, visibleEntities, sentenceIdx, eventFirstPos, showPastEdges]);

  // Lexical nodes for this section (right panel reading)
  const sectionLexicalNodes = useMemo<LexicalNode[]>(
    () => lexical.nodes.filter((n) => n.section === currentSection.id),
    [lexical, currentSection]
  );

  // Event count per section — feeds the timeline hover preview
  const eventCountPerSection = useMemo<number[]>(() => {
    if (!objective) return [];
    const counts = new Array(sections.length).fill(0);
    for (const ev of objective.events) {
      const i = sectionIdToIdx.get(ev.section);
      if (i !== undefined) counts[i]++;
    }
    return counts;
  }, [objective, sections.length, sectionIdToIdx]);

  // Continuous narrative-time axis. Section widths and event ticks both anchor
  // off the global sentence positions in `lexical.nodes` (via lexicalNodeById,
  // defined with the lexical helpers above).
  const totalPositions = lexical.nodes.length;

  // Section widths as percentages of total sentence count, with a minimum width
  // floor so a tiny coda section (e.g. silver-blaze section_4 — 22 sentences)
  // is still clickable. We re-normalise after applying the floor.
  const sectionWidths = useMemo<number[]>(() => {
    const counts = new Array(sections.length).fill(0);
    for (const n of lexical.nodes) {
      const i = sectionIdToIdx.get(n.section);
      if (i !== undefined) counts[i]++;
    }
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const minPct = sections.length > 1 ? 2 : 100; // % — keeps short sections clickable
    const raw = counts.map((c) => (c / total) * 100);
    const floored = raw.map((p) => Math.max(p, minPct));
    const sum = floored.reduce((a, b) => a + b, 0);
    return floored.map((p) => (p / sum) * 100);
  }, [lexical.nodes, sections, sectionIdToIdx]);

  // Cumulative offset (left edge %) for each section — anchors event ticks.
  const sectionOffsets = useMemo<number[]>(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const w of sectionWidths) {
      offsets.push(acc);
      acc += w;
    }
    return offsets;
  }, [sectionWidths]);

  // Map the sentence-precise playhead onto the timeline's floored stripe layout.
  const thumbPct = useMemo<number>(() => {
    const range = sectionRanges[currentIdx];
    if (!range || range.count === 0) return sectionOffsets[currentIdx] ?? 0;
    const fraction = Math.max(0, Math.min(1, (sentenceIdx - range.start) / range.count));
    return (sectionOffsets[currentIdx] ?? 0) + (sectionWidths[currentIdx] ?? 0) * fraction;
  }, [sentenceIdx, currentIdx, sectionRanges, sectionOffsets, sectionWidths]);

  // Global position 0..totalPositions remapped to 0..100 % using the *floored*
  // section widths so the position->pixel mapping matches the visible stripes.
  const eventTicks = useMemo<Array<{ pct: number; sectionIdx: number }>>(() => {
    if (!objective || totalPositions === 0) return [];
    // Build a per-section sentence index range so we can convert a node's global
    // position into a per-section fraction, then map onto the floored stripe.
    const sectionRanges: Array<{ start: number; size: number }> = [];
    let cursor = 0;
    for (let i = 0; i < sections.length; i++) {
      let size = 0;
      for (const n of lexical.nodes) if (n.section === sections[i].id) size++;
      sectionRanges.push({ start: cursor, size });
      cursor += size;
    }
    const ticks: Array<{ pct: number; sectionIdx: number }> = [];
    for (const ev of objective.events) {
      const idx = sectionIdToIdx.get(ev.section);
      if (idx === undefined) continue;
      const firstSourceId = ev.source_nodes?.[0];
      const node = firstSourceId ? lexicalNodeById.get(firstSourceId) : undefined;
      const range = sectionRanges[idx];
      const fraction = node && range.size > 0
        ? ((node.position - range.start) / range.size)
        : 0.5;
      const pct = sectionOffsets[idx] + sectionWidths[idx] * Math.max(0, Math.min(1, fraction));
      ticks.push({ pct, sectionIdx: idx });
    }
    return ticks;
  }, [objective, sections, sectionIdToIdx, lexical.nodes, lexicalNodeById, sectionOffsets, sectionWidths, totalPositions]);

  // ── D3 rendering ──────────────────────────────────────────────────────
  // Two-effect split: one builds the SVG/zoom/simulation once; the other diffs
  // the desired node + link sets against what's already on screen so existing
  // nodes keep their positions and only new ones bloom in. This is what makes
  // sentence-by-sentence scrubbing feel like growth instead of a re-layout.
  const simulationRef = useRef<d3.Simulation<GraphRenderNode, undefined> | null>(null);
  const nodeMapRef = useRef<Map<string, GraphRenderNode>>(new Map());
  const layersRef = useRef<{
    root: d3.Selection<SVGGElement, unknown, null, undefined>;
    links: d3.Selection<SVGGElement, unknown, null, undefined>;
    linkLabels: d3.Selection<SVGGElement, unknown, null, undefined>;
    linkHits: d3.Selection<SVGGElement, unknown, null, undefined>;
    nodes: d3.Selection<SVGGElement, unknown, null, undefined>;
  } | null>(null);
  const decayTimerRef = useRef<number | null>(null);
  const initialFitDoneRef = useRef(false);
  // Pre-computed positions for every entity & event in the full graph. We run
  // a hidden force simulation once at mount to settle the whole layout, then
  // place each node at its slot when it actually enters the visible set. This
  // keeps the spatial structure stable from the first sentence — entities slot
  // into their final neighbourhoods instead of forcing a fit-to-bounds reflow
  // every time a new node arrives.
  const precomputedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Setup — runs once per objective graph (i.e. per story). Re-runs only if
  // the objective itself changes, which only happens when the user navigates
  // to a different story (and the parent already remounts via `key={slug}`).
  useEffect(() => {
    if (!objective) return;
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    nodeMapRef.current = new Map();
    initialFitDoneRef.current = false;

    const width = svgRef.current.clientWidth || 900;
    const height = svgRef.current.clientHeight || 600;

    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 22)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#3d3838");

    const root = svg.append("g") as d3.Selection<SVGGElement, unknown, null, undefined>;

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .filter((event) => {
        if (event.type === "wheel") return event.ctrlKey || event.metaKey;
        return !event.button;
      })
      .on("zoom", (event) => root.attr("transform", event.transform));
    svg.call(zoom);
    zoomBehaviorRef.current = zoom;

    fitToBoundsRef.current = () => {
      const node = root.node();
      if (!node) return;
      const bounds = node.getBBox();
      if (!bounds.width || !bounds.height) return;
      const padding = 60;
      const scale = Math.min(
        (width - padding) / bounds.width,
        (height - padding) / bounds.height,
        2
      );
      const tx = width / 2 - scale * (bounds.x + bounds.width / 2);
      const ty = height / 2 - scale * (bounds.y + bounds.height / 2);
      svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    };

    const linksLayer = root.append("g").attr("class", "links") as d3.Selection<SVGGElement, unknown, null, undefined>;
    const linkLabelsLayer = root.append("g").attr("class", "link-labels") as d3.Selection<SVGGElement, unknown, null, undefined>;
    const linkHitsLayer = root.append("g").attr("class", "link-hits") as d3.Selection<SVGGElement, unknown, null, undefined>;
    const nodesLayer = root.append("g").attr("class", "nodes") as d3.Selection<SVGGElement, unknown, null, undefined>;

    layersRef.current = {
      root,
      links: linksLayer,
      linkLabels: linkLabelsLayer,
      linkHits: linkHitsLayer,
      nodes: nodesLayer,
    };

    const simulation = d3
      .forceSimulation<GraphRenderNode>([])
      .force(
        "link",
        d3
          .forceLink<GraphRenderNode, SimLink>([])
          .id((d) => d.id)
          .distance((l) => edgeTypes[(l as SimLink).kind].forceDistance)
      )
      .force("charge", d3.forceManyBody().strength(-380))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide((d) => ((d as GraphRenderNode).kind === "event" ? 24 : 50)))
      .alphaDecay(0.04)
      .alpha(0)
      .stop();

    simulation.on("tick", () => {
      const layers = layersRef.current;
      if (!layers) return;
      layers.links.selectAll<SVGLineElement, SimLink>("line.link-line")
        .attr("x1", (d) => (d.source as GraphRenderNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphRenderNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphRenderNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphRenderNode).y ?? 0);
      layers.linkHits.selectAll<SVGLineElement, SimLink>("line.link-hit")
        .attr("x1", (d) => (d.source as GraphRenderNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphRenderNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphRenderNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphRenderNode).y ?? 0);
      layers.linkLabels.selectAll<SVGGElement, SimLink>("g.link-label")
        .attr("transform", (d) => {
          const s = d.source as GraphRenderNode;
          const t = d.target as GraphRenderNode;
          const x = ((s.x ?? 0) + (t.x ?? 0)) / 2;
          const y = ((s.y ?? 0) + (t.y ?? 0)) / 2;
          return `translate(${x},${y})`;
        });
      layers.nodes.selectAll<SVGGElement, GraphRenderNode>("g.node")
        .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    simulationRef.current = simulation;

    // ── Pre-layout the full graph ─────────────────────────────────────
    // Headless simulation over every entity (and event) so we can fix the
    // viewport zoom to the full extent right away. New nodes will enter at
    // their slot in this layout, so the structure feels stable from sentence
    // zero rather than a tiny graph getting fit-zoomed to fill the canvas.
    const fullNodes: GraphRenderNode[] = [];
    for (const e of objective.entities) fullNodes.push({ ...e, kind: "entity" } as GraphRenderNode);
    for (const ev of objective.events) fullNodes.push({ ...ev, kind: "event" } as GraphRenderNode);
    const fullById = new Map(fullNodes.map((n) => [n.id, n]));

    const fullLinks: SimLink[] = [];
    for (const edge of objective.stateEdges) {
      if (fullById.has(edge.from) && fullById.has(edge.to)) {
        fullLinks.push({ source: edge.from, target: edge.to, kind: "state" });
      }
    }
    for (const m of objective.memberOf) {
      if (fullById.has(m.character) && fullById.has(m.organisation)) {
        fullLinks.push({ source: m.character, target: m.organisation, kind: "member" });
      }
    }
    for (const c of objective.clues) {
      if (fullById.has(c.object) && fullById.has(c.case)) {
        fullLinks.push({ source: c.object, target: c.case, kind: "clue" });
      }
    }
    for (const ev of objective.events) {
      for (const pid of ev.participants) {
        if (fullById.has(pid)) {
          fullLinks.push({ source: ev.id, target: pid, kind: "participation" });
        }
      }
      if (ev.communicates && fullById.has(ev.communicates.speaker)) {
        for (const r of ev.communicates.recipients) {
          if (fullById.has(r)) {
            fullLinks.push({
              source: ev.communicates.speaker,
              target: r,
              kind: "communicates",
            });
          }
        }
      }
    }

    const layoutSim = d3
      .forceSimulation<GraphRenderNode>(fullNodes)
      .force(
        "link",
        d3
          .forceLink<GraphRenderNode, SimLink>(fullLinks)
          .id((d) => d.id)
          .distance((l) => edgeTypes[(l as SimLink).kind].forceDistance)
      )
      .force("charge", d3.forceManyBody().strength(-380))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide((d) => ((d as GraphRenderNode).kind === "event" ? 24 : 50)))
      .stop();
    for (let i = 0; i < 300; i++) layoutSim.tick();

    const positions = new Map<string, { x: number; y: number }>();
    for (const n of fullNodes) {
      positions.set(n.id, { x: n.x ?? width / 2, y: n.y ?? height / 2 });
    }
    precomputedPositionsRef.current = positions;

    // Fit viewport to the full extent of the layout so the canvas size feels
    // stable across the whole story rather than zooming as nodes arrive.
    const xs = fullNodes.map((n) => n.x ?? 0);
    const ys = fullNodes.map((n) => n.y ?? 0);
    if (xs.length > 0) {
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const padding = 80;
      const scale = Math.min((width - padding) / bw, (height - padding) / bh, 2);
      const tx = width / 2 - scale * (minX + bw / 2);
      const ty = height / 2 - scale * (minY + bh / 2);
      svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
      initialFitDoneRef.current = true;
    }

    return () => {
      if (decayTimerRef.current !== null) {
        window.clearTimeout(decayTimerRef.current);
        decayTimerRef.current = null;
      }
      simulation.stop();
      simulationRef.current = null;
      layersRef.current = null;
      nodeMapRef.current = new Map();
      precomputedPositionsRef.current = new Map();
      initialFitDoneRef.current = false;
    };
  }, [objective]);

  // Diff-update — runs on every visibility change. Re-uses existing node
  // datum objects so x/y/vx/vy survive across renders. New nodes are seeded
  // near a connected, already-known node so they "spout" out of their parent.
  useEffect(() => {
    const sim = simulationRef.current;
    const layers = layersRef.current;
    const svgEl = svgRef.current;
    if (!sim || !layers || !svgEl) return;

    const width = svgEl.clientWidth || 900;
    const height = svgEl.clientHeight || 600;

    // Build desired node set
    const visibleEntityIds = new Set(visibleEntities.map((e) => e.id));
    const desired: GraphRenderNode[] = [];
    for (const e of visibleEntities) desired.push({ ...e, kind: "entity" } as GraphRenderNode);
    if (showEvents) {
      for (const ev of visibleEvents) {
        if (ev.participants.some((p) => visibleEntityIds.has(p))) {
          desired.push({ ...ev, kind: "event" } as GraphRenderNode);
        }
      }
    }

    // Build desired links
    const linksRaw: SimLink[] = [];
    for (const e of visibleEdges) {
      linksRaw.push({ source: e.from, target: e.to, kind: "state", active: e.active, label: e.type });
    }
    for (const c of visibleClues) {
      linksRaw.push({ source: c.object, target: c.case, kind: "clue", active: true, label: c.significance.slice(0, 60) || "clue" });
    }
    for (const m of visibleMemberships) {
      linksRaw.push({ source: m.character, target: m.organisation, kind: "member", active: m.active, label: "member" });
    }
    if (showEvents) {
      for (const ev of visibleEvents) {
        for (const pid of ev.participants) {
          if (visibleEntityIds.has(pid)) {
            linksRaw.push({
              source: ev.id,
              target: pid,
              kind: "participation",
              label: ev.performs?.includes(pid) ? "performs" : "witness",
            });
          }
        }
        if (ev.communicates && visibleEntityIds.has(ev.communicates.speaker)) {
          for (const r of ev.communicates.recipients) {
            if (visibleEntityIds.has(r)) {
              linksRaw.push({
                source: ev.communicates.speaker,
                target: r,
                kind: "communicates",
                label: ev.communicates.content.slice(0, 60),
              });
            }
          }
        }
      }
    }

    // Diff against the persisted node map.
    const prev = nodeMapRef.current;
    const next = new Map<string, GraphRenderNode>();
    let newCount = 0;
    for (const want of desired) {
      const existing = prev.get(want.id);
      if (existing) {
        // Preserve simulation state (x/y/vx/vy), refresh other fields.
        const x = existing.x;
        const y = existing.y;
        const vx = (existing as { vx?: number }).vx;
        const vy = (existing as { vy?: number }).vy;
        Object.assign(existing, want);
        existing.x = x;
        existing.y = y;
        (existing as { vx?: number }).vx = vx;
        (existing as { vy?: number }).vy = vy;
        next.set(want.id, existing);
      } else {
        // Prefer the precomputed slot from the full-graph layout pass — that's
        // where this node "lives" in the eventual graph, so entering there
        // makes the structure feel stable rather than wandering. Fall back to
        // an anchor near a connected existing node, then to the viewport
        // centre, only if the precompute is missing the id.
        const slot = precomputedPositionsRef.current.get(want.id);
        if (slot) {
          want.x = slot.x;
          want.y = slot.y;
        } else {
          let anchor: GraphRenderNode | undefined;
          for (const l of linksRaw) {
            const sId = typeof l.source === "string" ? l.source : (l.source as GraphRenderNode).id;
            const tId = typeof l.target === "string" ? l.target : (l.target as GraphRenderNode).id;
            if (sId === want.id) anchor = prev.get(tId);
            else if (tId === want.id) anchor = prev.get(sId);
            if (anchor) break;
          }
          const ax = anchor?.x ?? width / 2;
          const ay = anchor?.y ?? height / 2;
          want.x = ax + (Math.random() - 0.5) * 40;
          want.y = ay + (Math.random() - 0.5) * 40;
        }
        next.set(want.id, want);
        newCount++;
      }
    }
    nodeMapRef.current = next;

    // Drop any links whose endpoints are no longer present.
    const links = linksRaw.filter((l) => {
      const sId = typeof l.source === "string" ? l.source : (l.source as GraphRenderNode).id;
      const tId = typeof l.target === "string" ? l.target : (l.target as GraphRenderNode).id;
      return next.has(sId) && next.has(tId);
    });
    const nodesArr = Array.from(next.values());

    const linkKey = (d: SimLink): string => {
      const sId = typeof d.source === "string" ? d.source : (d.source as GraphRenderNode).id;
      const tId = typeof d.target === "string" ? d.target : (d.target as GraphRenderNode).id;
      return `${d.kind}|${sId}->${tId}|${d.label ?? ""}`;
    };

    // ── d3 joins ───────────────────────────────────────────────────────
    layers.links
      .selectAll<SVGLineElement, SimLink>("line.link-line")
      .data(links, linkKey as (d: SimLink) => string)
      .join(
        (enter) =>
          enter
            .append("line")
            .attr("class", "link-line")
            .attr("stroke-opacity", 0)
            .call((sel) =>
              sel
                .transition()
                .duration(400)
                .attr("stroke-opacity", (d) => edgeOpacity(d.kind, d.active !== false))
            ),
        (update) => update,
        (exit) => exit.call((sel) => sel.transition().duration(250).attr("stroke-opacity", 0).remove())
      )
      .attr("stroke", (d) => edgeStroke(d.kind, d.active !== false))
      .attr("stroke-width", (d) => edgeTypes[d.kind].width)
      .attr("stroke-dasharray", (d) => edgeDash(d.kind, d.active !== false))
      .attr("marker-end", (d) => (edgeTypes[d.kind].arrow ? "url(#arrow)" : null));

    // Push the active-vs-past opacity onto already-existing lines too.
    layers.links
      .selectAll<SVGLineElement, SimLink>("line.link-line")
      .attr("stroke-opacity", (d) => edgeOpacity(d.kind, d.active !== false));

    const linkLabelSel = layers.linkLabels
      .selectAll<SVGGElement, SimLink>("g.link-label")
      .data(links, linkKey as (d: SimLink) => string)
      .join(
        (enter) => {
          const g = enter
            .append("g")
            .attr("class", "link-label")
            .attr("pointer-events", "none")
            .attr("opacity", 0);
          g.append("rect")
            .attr("class", "link-label-bg")
            .attr("rx", 3)
            .attr("ry", 3)
            .attr("fill", "#0a0909")
            .attr("opacity", 0.9);
          g.append("text")
            .attr("class", "link-label-text")
            .attr("font-size", 10)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle");
          return g;
        },
        (update) => update,
        (exit) => exit.remove()
      );

    linkLabelSel
      .select<SVGTextElement>("text.link-label-text")
      .attr("fill", (d) => edgeTypes[d.kind].color)
      .text((d) => d.label ?? "")
      .each(function () {
        const bbox = (this as SVGTextElement).getBBox();
        const pad = 4;
        d3.select((this as SVGTextElement).previousElementSibling as SVGRectElement)
          .attr("x", -bbox.width / 2 - pad)
          .attr("y", -bbox.height / 2 - pad / 2)
          .attr("width", bbox.width + pad * 2)
          .attr("height", bbox.height + pad);
      });

    const linkHitSel = layers.linkHits
      .selectAll<SVGLineElement, SimLink>("line.link-hit")
      .data(links, linkKey as (d: SimLink) => string)
      .join(
        (enter) =>
          enter
            .append("line")
            .attr("class", "link-hit")
            .attr("stroke", "transparent")
            .attr("stroke-width", 14)
            .attr("pointer-events", "stroke"),
        (update) => update,
        (exit) => exit.remove()
      );

    linkHitSel.on("mouseenter", function (_, d) {
      const key = linkKey(d);
      layers.linkLabels
        .selectAll<SVGGElement, SimLink>("g.link-label")
        .filter((ld) => linkKey(ld) === key)
        .attr("opacity", 1);
    });
    linkHitSel.on("mouseleave", function (_, d) {
      const key = linkKey(d);
      layers.linkLabels
        .selectAll<SVGGElement, SimLink>("g.link-label")
        .filter((ld) => linkKey(ld) === key)
        .attr("opacity", 0);
    });

    // Drag behaviour — created here so it closes over the current `sim`.
    const dragBehavior = d3
      .drag<SVGGElement, GraphRenderNode>()
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

    const alwaysLabel = (d: GraphRenderNode) => d.kind === "entity" && (d as Entity).type === "character";

    const nodeSel = layers.nodes
      .selectAll<SVGGElement, GraphRenderNode>("g.node")
      .data(nodesArr, (d) => d.id)
      .join(
        (enter) => {
          const g = enter
            .append("g")
            .attr("class", "node")
            .attr("cursor", "pointer")
            .attr("opacity", 0)
            .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
            .on("click", (_, d) => {
              if (d.kind === "entity") setSelectedEntity((p) => (p?.id === d.id ? null : (d as Entity)));
            });

          // Halo (entities only) — display flag toggled in the update path.
          g.filter((d) => d.kind === "entity")
            .append("circle")
            .attr("class", "halo")
            .attr("fill", "none")
            .attr("stroke", MENTION_HALO)
            .attr("stroke-opacity", 0.55)
            .attr("stroke-width", 1.5)
            .attr("stroke-dasharray", "2,3")
            .attr("display", "none");

          g.filter((d) => d.kind === "entity")
            .append("circle")
            .attr("class", "entity-circle")
            .attr("r", (d) => entityRadius((d as Entity).type))
            .attr("fill", (d) => entityColor((d as Entity).type))
            .attr("stroke-width", 2.5);

          g.filter((d) => d.kind === "event")
            .append("rect")
            .attr("class", "event-rect")
            .attr("x", -7)
            .attr("y", -7)
            .attr("width", 14)
            .attr("height", 14)
            .attr("transform", "rotate(45)")
            .attr("fill", (d) => ((d as ObjectiveEvent).communicates ? COMMUNICATE_COLOR : EVENT_COLOR))
            .attr("opacity", 0.9)
            .attr("stroke", "#0a0909")
            .attr("stroke-width", 1);

          const labelGroup = g
            .append("g")
            .attr("class", "node-label")
            .attr("pointer-events", "none");
          labelGroup
            .append("rect")
            .attr("class", "node-label-bg")
            .attr("rx", 3)
            .attr("ry", 3)
            .attr("fill", "#0a0909")
            .attr("opacity", 0.88);
          labelGroup
            .append("text")
            .attr("class", "node-label-text")
            .attr("text-anchor", "middle");

          g.call(dragBehavior as unknown as (sel: d3.Selection<SVGGElement, GraphRenderNode, SVGGElement, unknown>) => void);
          g.transition().duration(450).attr("opacity", 1);
          return g;
        },
        (update) => update,
        (exit) =>
          exit.call((sel) =>
            sel.transition().duration(300).attr("opacity", 0).remove()
          )
      );

    nodeSel
      .select<SVGCircleElement>("circle.halo")
      .attr("display", (d) =>
        showMentions && d.kind === "entity" && mentionedInCurrentSection.has(d.id) ? null : "none"
      )
      .attr("r", (d) => entityRadius((d as Entity).type) + 8);

    nodeSel
      .select<SVGCircleElement>("circle.entity-circle")
      .attr("stroke", (d) => (newEntityIds.has(d.id) ? "#fff" : "transparent"));

    nodeSel
      .select<SVGTextElement>("text.node-label-text")
      .attr("font-size", (d) => (d.kind === "event" ? 10 : 11))
      .attr("fill", (d) => (d.kind === "event" ? "#fbd38d" : "#d7c9c9"))
      .text((d) => (d.kind === "event" ? (d as ObjectiveEvent).label : (d as Entity).label))
      .each(function (d) {
        const bbox = (this as SVGTextElement).getBBox();
        const pad = 3;
        const baseOffset = d.kind === "entity" ? entityRadius((d as Entity).type) + 10 : 18;
        d3.select(this).attr("y", baseOffset);
        d3.select((this as SVGTextElement).previousElementSibling as SVGRectElement)
          .attr("x", bbox.x - pad)
          .attr("y", baseOffset - bbox.height + 1)
          .attr("width", bbox.width + pad * 2)
          .attr("height", bbox.height + pad);
      });

    nodeSel
      .select<SVGGElement>("g.node-label")
      .attr("opacity", (d) => (alwaysLabel(d) ? 1 : 0));

    nodeSel
      .on("mouseenter.label", function (_, d) {
        if (!alwaysLabel(d)) d3.select(this).select(".node-label").attr("opacity", 1);
      })
      .on("mouseleave.label", function (_, d) {
        if (!alwaysLabel(d)) d3.select(this).select(".node-label").attr("opacity", 0);
      });

    // ── Drive the simulation ──────────────────────────────────────────
    sim.nodes(nodesArr);
    (sim.force("link") as d3.ForceLink<GraphRenderNode, SimLink>).links(links);

    // New nodes already enter at their precomputed slot, so we only need a
    // very small alpha kick to relax local link / collision forces. No alpha
    // at all on pure removals — surviving nodes shouldn't drift.
    if (newCount > 0) {
      sim.alpha(Math.min(0.15, 0.04 + 0.01 * newCount)).restart();
      if (decayTimerRef.current !== null) window.clearTimeout(decayTimerRef.current);
      decayTimerRef.current = window.setTimeout(() => {
        sim.alphaTarget(0);
        decayTimerRef.current = null;
      }, 600);
    } else {
      // Tiny tick so re-classified edges (active ↔ past) repaint correctly.
      sim.alpha(Math.max(sim.alpha(), 0.01)).restart();
    }
  }, [
    visibleEntities,
    visibleEvents,
    visibleEdges,
    visibleClues,
    visibleMemberships,
    mentionedInCurrentSection,
    newEntityIds,
    showEvents,
    showMentions,
  ]);

  // ── Derived character states for current section ─────────────────────
  const characterStates = useMemo(() => {
    if (!objective) return [];
    return listCharacters(objective).map((id) =>
      buildCharacterState(id, currentSection.id, objective, sections)
    );
  }, [objective, currentSection, sections]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-dark-950 text-dark-100">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-dark-800 flex-wrap shrink-0">
        <span className="text-xs text-dark-500 mr-1">Type:</span>
        {entityTypes.map((t) => (
          <button
            key={t.id}
            onClick={() => toggleType(t.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: activeTypes.has(t.id) ? t.color + "33" : "transparent",
              color: activeTypes.has(t.id) ? t.color : "#5c5252",
              border: `1px solid ${activeTypes.has(t.id) ? t.color + "66" : "#262323"}`,
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: activeTypes.has(t.id) ? t.color : "#3d3838" }}
            />
            {t.label}
          </button>
        ))}
        <span className="text-xs text-dark-500 mx-2">·</span>
        <label className="flex items-center gap-1.5 text-xs text-dark-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showEvents}
            onChange={(e) => setShowEvents(e.target.checked)}
            className="accent-orange-500"
          />
          Events
        </label>
        <label className="flex items-center gap-1.5 text-xs text-dark-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showMentions}
            onChange={(e) => setShowMentions(e.target.checked)}
            className="accent-slate-400"
          />
          Mentions
        </label>
        <label className="flex items-center gap-1.5 text-xs text-dark-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showClues}
            onChange={(e) => setShowClues(e.target.checked)}
            className="accent-amber-500"
          />
          Clues
        </label>
        <label className="flex items-center gap-1.5 text-xs text-dark-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showMemberships}
            onChange={(e) => setShowMemberships(e.target.checked)}
            className="accent-emerald-500"
          />
          Memberships
        </label>
        <label className="flex items-center gap-1.5 text-xs text-dark-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showPastEdges}
            onChange={(e) => setShowPastEdges(e.target.checked)}
            className="accent-crimson-500"
          />
          Past edges
        </label>
        <div className="ml-auto flex items-center gap-3">
          <select
            value={selectedCharacterId ?? ""}
            onChange={(e) => setSelectedCharacterId(e.target.value || null)}
            className="text-xs bg-dark-900 border border-dark-700 text-dark-200 rounded px-2 py-1 focus:outline-none focus:border-crimson-500"
          >
            <option value="">All perspectives</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <span className="text-xs text-dark-600">← → step · ⌘/ctrl-scroll zoom · drag nodes</span>
        </div>
      </div>

      {/* Live Cypher query */}
      <CypherDisplay
        slug={slug}
        selectedCharacterId={selectedCharacterId}
        selectedCharacter={selectedCharacter}
        currentIdx={currentIdx}
      />

      {/* Middle */}
      <div className="flex flex-1 overflow-hidden">
        {/* Center: graph */}
        <div className="flex-1 relative overflow-hidden">
          {objective ? (
            <svg ref={svgRef} className="w-full h-full" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-dark-600">
              <p className="text-sm">No objective graph yet</p>
              <p className="text-xs">Use the Ingest button (or run npm run ingest) to extract events</p>
            </div>
          )}
          {objective && (
            <>
              <ZoomControls
                onFit={() => fitToBoundsRef.current?.()}
                onZoom={(factor) => {
                  const svg = svgRef.current;
                  const zoom = zoomBehaviorRef.current;
                  if (!svg || !zoom) return;
                  d3.select(svg).transition().duration(200).call(zoom.scaleBy, factor);
                }}
              />
              <div className="absolute bottom-3 left-3 text-xs text-dark-600 flex gap-3 flex-wrap">
                <span>{visibleEntities.length} entities</span>
                <span>{visibleEvents.length} events</span>
                <span>{visibleEdges.filter((e) => e.active).length} active edges</span>
                {visibleClues.length > 0 && <span style={{ color: CLUE_COLOR }}>{visibleClues.length} clues</span>}
                {visibleMemberships.length > 0 && <span style={{ color: MEMBER_COLOR }}>{visibleMemberships.filter((m) => m.active).length} memberships</span>}
                {mentionedInCurrentSection.size > 0 && showMentions && (
                  <span style={{ color: MENTION_HALO }}>{mentionedInCurrentSection.size} mentioned here</span>
                )}
                {newEntityIds.size > 0 && (
                  <span className="text-crimson-400">+{newEntityIds.size} new</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right: detail / section / states */}
        <div className="w-80 border-l border-dark-800 overflow-y-auto shrink-0">
          {selectedEntity ? (
            <EntityDetail
              entity={selectedEntity}
              objective={objective}
              currentIdx={currentIdx}
              sectionIdToIdx={sectionIdToIdx}
              onClose={() => setSelectedEntity(null)}
            />
          ) : (
            <SectionDetail
              lexicalNodes={sectionLexicalNodes}
              sectionEvents={sectionEvents}
              characterStates={characterStates}
              objective={objective}
              section={currentSection}
            />
          )}
        </div>
      </div>

      {/* Timeline scrubber */}
      <Timeline
        sections={sections}
        currentIdx={currentIdx}
        sentenceIdx={sentenceIdx}
        totalSentences={totalSentences}
        sectionRanges={sectionRanges}
        sectionWidths={sectionWidths}
        sectionOffsets={sectionOffsets}
        eventCountPerSection={eventCountPerSection}
        eventTicks={eventTicks}
        thumbPct={thumbPct}
        onScrub={setSentenceIdx}
        onSelectSection={goToSection}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function EntityDetail({
  entity,
  objective,
  currentIdx,
  sectionIdToIdx,
  onClose,
}: {
  entity: Entity;
  objective: ObjectiveGraph | null;
  currentIdx: number;
  sectionIdToIdx: Map<string, number>;
  onClose: () => void;
}) {
  if (!objective) return null;

  const entityById = new Map(objective.entities.map((e) => [e.id, e]));
  const involvingEvents = objective.events.filter(
    (ev) =>
      ev.participants.includes(entity.id) &&
      (sectionIdToIdx.get(ev.section) ?? 0) <= currentIdx
  );
  const stateChanges = objective.stateEdges.filter(
    (e) => e.from === entity.id || e.to === entity.id
  );
  const mentions = objective.mentions.filter(
    (m) => m.entity === entity.id && (sectionIdToIdx.get(m.section) ?? Infinity) <= currentIdx
  );
  // Clue context depends on entity type
  const cluesForCase = entity.type === "case"
    ? objective.clues.filter((c) => c.case === entity.id && (sectionIdToIdx.get(c.discovered_in_section) ?? Infinity) <= currentIdx)
    : [];
  const cluesByObject = entity.type === "object"
    ? objective.clues.filter((c) => c.object === entity.id && (sectionIdToIdx.get(c.discovered_in_section) ?? Infinity) <= currentIdx)
    : [];
  const cluesByDiscoverer = entity.type === "character"
    ? objective.clues.filter((c) => c.discovered_by === entity.id && (sectionIdToIdx.get(c.discovered_in_section) ?? Infinity) <= currentIdx)
    : [];
  // Membership context
  const memberships = entity.type === "character"
    ? objective.memberOf.filter((m) => m.character === entity.id)
    : [];
  const orgMembers = entity.type === "organisation"
    ? objective.memberOf.filter((m) => m.organisation === entity.id)
    : [];

  const label = (id: string) => entityById.get(id)?.label ?? id;

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded"
          style={{
            backgroundColor: entityColor(entity.type) + "33",
            color: entityColor(entity.type),
          }}
        >
          {entityLabel(entity.type)}
        </span>
        <button onClick={onClose} className="text-dark-600 hover:text-dark-200 text-lg leading-none">
          ×
        </button>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-dark-100">{entity.label}</h3>
        {entity.description && <p className="text-xs text-dark-400 mt-1">{entity.description}</p>}
      </div>

      {/* Type-specific attributes */}
      {entity.type === "case" && (
        <dl className="text-xs text-dark-400 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          {entity.crime_type && (<><dt className="text-dark-600">crime</dt><dd>{entity.crime_type}</dd></>)}
          {entity.outcome && (<><dt className="text-dark-600">outcome</dt><dd>{entity.outcome}</dd></>)}
          {entity.client && (<><dt className="text-dark-600">client</dt><dd>{label(entity.client)}</dd></>)}
          {entity.primary_location && (<><dt className="text-dark-600">location</dt><dd>{label(entity.primary_location)}</dd></>)}
        </dl>
      )}
      {entity.type === "document" && (
        <dl className="text-xs text-dark-400 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          {entity.document_type && (<><dt className="text-dark-600">type</dt><dd>{entity.document_type}</dd></>)}
          {entity.from && (<><dt className="text-dark-600">from</dt><dd>{label(entity.from)}</dd></>)}
          {entity.to && (<><dt className="text-dark-600">to</dt><dd>{label(entity.to)}</dd></>)}
          {entity.content_summary && (<><dt className="text-dark-600">summary</dt><dd className="italic">{entity.content_summary}</dd></>)}
        </dl>
      )}
      {entity.type === "organisation" && entity.org_type && (
        <dl className="text-xs text-dark-400 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt className="text-dark-600">org type</dt><dd>{entity.org_type}</dd>
        </dl>
      )}

      <div>
        <h4 className="text-xs font-semibold text-dark-500 mb-2">Events involving this entity</h4>
        {involvingEvents.length === 0 ? (
          <p className="text-xs text-dark-700">None up to this section</p>
        ) : (
          <ul className="space-y-1">
            {involvingEvents.map((ev) => (
              <li key={ev.id} className="text-xs text-dark-400">
                <span className="text-dark-600">{ev.section}:</span> {ev.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {mentions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-dark-500 mb-2">Mentioned in</h4>
          <ul className="space-y-1">
            {mentions.map((m, i) => (
              <li key={i} className="text-xs text-dark-400">
                <span className="text-dark-200">{m.section}</span>
                <span className="text-dark-700"> · {m.mention_count} time{m.mention_count === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stateChanges.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-dark-500 mb-2">State edges</h4>
          <ul className="space-y-1">
            {stateChanges.map((e) => (
              <li key={e.id} className="text-xs text-dark-400">
                <span className="text-dark-200">{label(e.from)}</span>{" "}
                <span className="text-dark-600">{e.type}</span>{" "}
                <span className="text-crimson-400">{label(e.to)}</span>
                <span className="text-dark-700"> · valid {e.valid_from}→{e.valid_until ?? "∞"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(cluesForCase.length > 0 || cluesByObject.length > 0 || cluesByDiscoverer.length > 0) && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: CLUE_COLOR }}>Clues</h4>
          <ul className="space-y-1.5">
            {cluesForCase.map((c, i) => (
              <li key={`c-${i}`} className="text-xs text-dark-400">
                <span className="text-dark-200">{label(c.object)}</span>
                <span className="text-dark-700"> · found by {label(c.discovered_by)} in {c.discovered_in_section}</span>
                {c.significance && <p className="text-dark-500 italic mt-0.5">{c.significance}</p>}
              </li>
            ))}
            {cluesByObject.map((c, i) => (
              <li key={`o-${i}`} className="text-xs text-dark-400">
                <span className="text-dark-700">clue for </span>
                <span className="text-dark-200">{label(c.case)}</span>
                {c.significance && <p className="text-dark-500 italic mt-0.5">{c.significance}</p>}
              </li>
            ))}
            {cluesByDiscoverer.map((c, i) => (
              <li key={`d-${i}`} className="text-xs text-dark-400">
                <span className="text-dark-700">discovered </span>
                <span className="text-dark-200">{label(c.object)}</span>
                <span className="text-dark-700"> for </span>
                <span className="text-dark-200">{label(c.case)}</span>
                {c.significance && <p className="text-dark-500 italic mt-0.5">{c.significance}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(memberships.length > 0 || orgMembers.length > 0) && (
        <div>
          <h4 className="text-xs font-semibold mb-2" style={{ color: MEMBER_COLOR }}>
            {entity.type === "organisation" ? "Members" : "Memberships"}
          </h4>
          <ul className="space-y-1">
            {memberships.map((m, i) => (
              <li key={`m-${i}`} className="text-xs text-dark-400">
                <span className="text-dark-200">{label(m.organisation)}</span>
                {(m.valid_from || m.valid_until) && (
                  <span className="text-dark-700"> · {m.valid_from ?? "∞"}→{m.valid_until ?? "∞"}</span>
                )}
              </li>
            ))}
            {orgMembers.map((m, i) => (
              <li key={`om-${i}`} className="text-xs text-dark-400">
                <span className="text-dark-200">{label(m.character)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SectionDetail({
  lexicalNodes,
  sectionEvents,
  characterStates,
  objective,
  section,
}: {
  lexicalNodes: LexicalNode[];
  sectionEvents: ObjectiveEvent[];
  characterStates: ReturnType<typeof buildCharacterState>[];
  objective: ObjectiveGraph | null;
  section: SectionMeta;
}) {
  const entityById = useMemo(() => {
    const m = new Map<string, Entity>();
    for (const e of objective?.entities ?? []) m.set(e.id, e);
    return m;
  }, [objective]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="text-xs font-semibold text-dark-500 uppercase tracking-wider mb-2">
          {section.title}
        </h3>
        <div className="text-xs text-dark-400 leading-relaxed space-y-2">
          {lexicalNodes.map((n) => (
            <p key={n.id}>{n.text}</p>
          ))}
        </div>
      </div>

      {sectionEvents.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-dark-500 uppercase tracking-wider mb-2">
            Events in this section
          </h3>
          <ul className="space-y-1.5">
            {sectionEvents.map((ev) => (
              <li key={ev.id} className="text-xs">
                <p className="text-dark-200">{ev.label}</p>
                {ev.communicates && (
                  <p className="text-amber-400/80 mt-0.5 italic">
                    “{ev.communicates.content}” —{" "}
                    {entityById.get(ev.communicates.speaker)?.label ?? ev.communicates.speaker}
                    {" → "}
                    {ev.communicates.recipients
                      .map((r) => entityById.get(r)?.label ?? r)
                      .join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {characterStates.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-dark-500 uppercase tracking-wider mb-3">
            Character states (derived)
          </h3>
          <div className="space-y-3">
            {characterStates.map((state) => (
              <CharacterStateCard
                key={state.character}
                state={state}
                entityLabel={entityById.get(state.character)?.label ?? state.character}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CharacterStateCard({
  state,
  entityLabel,
}: {
  state: ReturnType<typeof buildCharacterState>;
  entityLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalKnowledge = state.observations.length + state.beliefs.length;

  return (
    <div className="border border-dark-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-dark-900 hover:bg-dark-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-dark-200">{entityLabel}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-dark-500">
          <span>{state.observations.length} obs</span>
          {state.beliefs.length > 0 && <span className="text-amber-500">{state.beliefs.length} told</span>}
          <span className="text-dark-600">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2">
          {totalKnowledge === 0 && (
            <p className="text-xs text-dark-700 italic">No knowledge yet at this section.</p>
          )}
          {state.observations.map((item) => (
            <KnowledgeRow key={item.id} item={item} />
          ))}
          {state.beliefs.map((item) => (
            <KnowledgeRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function KnowledgeRow({ item }: { item: { id: string; description: string; modality: Modality; confidence: number; based_on_events: string[] } }) {
  const style = MODALITY_STYLES[item.modality];
  return (
    <div className="text-xs space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span
          className="text-xs px-1.5 py-px rounded font-medium"
          style={{ backgroundColor: style.color + "22", color: style.color }}
        >
          {style.label}
        </span>
        <span className="text-dark-600">{Math.round(item.confidence * 100)}%</span>
      </div>
      <p className="text-dark-400 leading-relaxed">{item.description}</p>
    </div>
  );
}

// ── Zoom controls overlay ────────────────────────────────────────────────────

function ZoomControls({
  onFit,
  onZoom,
}: {
  onFit: () => void;
  onZoom: (factor: number) => void;
}) {
  const btn = "w-7 h-7 flex items-center justify-center rounded-md bg-dark-900/85 hover:bg-dark-800 border border-dark-800 text-dark-300 hover:text-dark-100 transition-colors text-sm";
  return (
    <div className="absolute top-3 right-3 flex flex-col gap-1 z-10">
      <button onClick={() => onZoom(1.4)} className={btn} title="Zoom in">+</button>
      <button onClick={() => onZoom(1 / 1.4)} className={btn} title="Zoom out">−</button>
      <button onClick={onFit} className={btn} title="Fit to view">⌂</button>
    </div>
  );
}

// ── Timeline scrubber ────────────────────────────────────────────────────────

function Timeline({
  sections,
  currentIdx,
  sentenceIdx,
  totalSentences,
  sectionRanges,
  sectionWidths,
  sectionOffsets,
  eventCountPerSection,
  eventTicks,
  thumbPct,
  onScrub,
  onSelectSection,
}: {
  sections: SectionMeta[];
  currentIdx: number;
  sentenceIdx: number;
  totalSentences: number;
  sectionRanges: Array<{ start: number; count: number }>;
  sectionWidths: number[];     // % of total, one per section, sums to 100
  sectionOffsets: number[];    // cumulative left-edge %, one per section
  eventCountPerSection: number[];
  eventTicks: Array<{ pct: number; sectionIdx: number }>;
  thumbPct: number;            // playhead position as % of track width
  onScrub: (sentenceIdx: number) => void;
  onSelectSection: (idx: number) => void;
}) {
  const current = sections[currentIdx];
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const hover = hoverIdx !== null ? sections[hoverIdx] : null;
  const hoverEvents = hoverIdx !== null ? eventCountPerSection[hoverIdx] : 0;

  // Resolve a percentage-along-track into a global sentence index.
  // Inverse of the parent's `thumbPct` computation — find the section the
  // percentage lands in (using floored widths), then map the within-stripe
  // fraction back to the section's real sentence range.
  const pctToSentenceIdx = useCallback(
    (pct: number): number => {
      const clamped = Math.max(0, Math.min(100, pct));
      for (let i = 0; i < sectionOffsets.length; i++) {
        const left = sectionOffsets[i];
        const right = left + sectionWidths[i];
        if (clamped <= right || i === sectionOffsets.length - 1) {
          const r = sectionRanges[i];
          const within = sectionWidths[i] > 0 ? (clamped - left) / sectionWidths[i] : 0;
          const offset = Math.round(within * Math.max(1, r.count - 1));
          return Math.max(0, Math.min(totalSentences - 1, r.start + offset));
        }
      }
      return 0;
    },
    [sectionOffsets, sectionWidths, sectionRanges, totalSentences]
  );

  // Pointer-drag scrubbing. Pointer-capture keeps drag events flowing even when
  // the cursor leaves the track horizontally.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const updateFromClientX = (clientX: number) => {
        const pct = ((clientX - rect.left) / rect.width) * 100;
        onScrub(pctToSentenceIdx(pct));
      };
      updateFromClientX(e.clientX);
      setDragging(true);
      track.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => updateFromClientX(ev.clientX);
      const up = () => {
        track.removeEventListener("pointermove", move);
        track.removeEventListener("pointerup", up);
        track.removeEventListener("pointercancel", up);
        setDragging(false);
      };
      track.addEventListener("pointermove", move);
      track.addEventListener("pointerup", up);
      track.addEventListener("pointercancel", up);
    },
    [onScrub, pctToSentenceIdx]
  );

  // Sentence-level minor notches inside each stripe.
  // Stride is chosen so we render at most ~250 visible notches total — enough
  // visual density to read the grain without painting 644+ DOM nodes.
  const notchStride = Math.max(1, Math.ceil(totalSentences / 250));

  return (
    <div className="shrink-0 border-t border-dark-800 bg-dark-950">
      {/* Caption row */}
      <div className="px-6 pt-3 pb-2 flex items-baseline gap-3 text-xs">
        <span className="text-dark-600 font-mono">
          {currentIdx + 1} <span className="text-dark-700">/ {sections.length}</span>
        </span>
        <span className="text-crimson-300 font-medium truncate">{current?.title ?? ""}</span>
        <span className="text-dark-700">·</span>
        <span className="text-dark-500 font-mono">
          sentence {sentenceIdx + 1} <span className="text-dark-700">/ {totalSentences}</span>
        </span>
        <span className="text-dark-700">·</span>
        <span className="text-dark-500">{current?.wordCount.toLocaleString()}w</span>
        <span className="text-dark-700">·</span>
        <span className="text-dark-500">{eventCountPerSection[currentIdx] ?? 0} events</span>
        <span className="text-dark-700">·</span>
        <span className="text-dark-600">{(sectionWidths[currentIdx] ?? 0).toFixed(1)}% of story</span>
        {hover && hoverIdx !== currentIdx && (
          <span className="ml-auto text-dark-500 truncate max-w-xs">
            <span className="text-dark-700">hover:</span> {hover.title}
            <span className="text-dark-700"> · {hoverEvents} ev · {hover.wordCount.toLocaleString()}w</span>
          </span>
        )}
      </div>

      {/* Slider track: stripes + minor sentence notches + event ticks + thumb */}
      <div className="relative px-6 pb-4 pt-1 select-none" onMouseLeave={() => setHoverIdx(null)}>
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          className={`relative h-12 rounded-md overflow-hidden border border-dark-800 ${dragging ? "cursor-grabbing" : "cursor-pointer"}`}
        >
          {/* Section stripes — width proportional to sentence count */}
          <div className="absolute inset-0 flex pointer-events-none">
            {sections.map((s, i) => {
              const isCurrent = i === currentIdx;
              const isPast = i < currentIdx;
              return (
                <div
                  key={s.id}
                  className={`relative h-full border-r border-dark-900 last:border-r-0 ${
                    isCurrent
                      ? "bg-crimson-900/40"
                      : isPast
                      ? "bg-crimson-950/40"
                      : "bg-dark-900/60"
                  }`}
                  style={{ width: `${sectionWidths[i]}%` }}
                />
              );
            })}
          </div>

          {/* Minor notches — sentence-grain hairlines for visual texture */}
          <div className="absolute inset-0 pointer-events-none">
            {sections.map((s, i) => {
              const r = sectionRanges[i];
              if (r.count === 0) return null;
              const stripeW = sectionWidths[i];
              const stripeLeft = sectionOffsets[i];
              const notches: React.ReactElement[] = [];
              for (let k = notchStride; k < r.count; k += notchStride) {
                const fraction = k / r.count;
                const pct = stripeLeft + stripeW * fraction;
                notches.push(
                  <span
                    key={`${s.id}-${k}`}
                    className="absolute top-2.5 bottom-2.5 w-px bg-dark-700/60"
                    style={{ left: `${pct}%` }}
                  />
                );
              }
              return notches;
            })}
          </div>

          {/* Section dividers — slightly taller major notches */}
          <div className="absolute inset-0 pointer-events-none">
            {sectionOffsets.slice(1).map((left, i) => (
              <span
                key={i}
                className="absolute top-0 bottom-0 w-px bg-dark-700"
                style={{ left: `${left}%` }}
              />
            ))}
          </div>

          {/* Event ticks — exact sentence positions */}
          <div className="absolute inset-0 pointer-events-none">
            {eventTicks.map((t, i) => {
              const isPast = t.sectionIdx < currentIdx;
              const isCurrent = t.sectionIdx === currentIdx;
              return (
                <span
                  key={i}
                  className="absolute top-1.5 bottom-1.5 w-px"
                  style={{
                    left: `${t.pct}%`,
                    backgroundColor: isCurrent ? "#f43f5e" : isPast ? "#9f1239" : "#4b4444",
                    opacity: isCurrent ? 0.95 : isPast ? 0.7 : 0.55,
                  }}
                />
              );
            })}
          </div>

          {/* Current section underline */}
          <div
            className="absolute bottom-0 h-0.5 bg-crimson-500 transition-all duration-150 pointer-events-none"
            style={{
              left: `${sectionOffsets[currentIdx]}%`,
              width: `${sectionWidths[currentIdx]}%`,
            }}
          />

          {/* Playhead thumb */}
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${thumbPct}%`, transform: "translateX(-50%)" }}
          >
            <span className="absolute top-0 bottom-0 w-0.5 bg-crimson-300/90" />
            <span
              className={`absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-crimson-400 border-2 border-dark-950 shadow ${dragging ? "scale-125" : ""} transition-transform`}
            />
            <span
              className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-crimson-400 border-2 border-dark-950 shadow ${dragging ? "scale-125" : ""} transition-transform`}
            />
          </div>
        </div>

        {/* Section labels row — clickable, snap to section start */}
        <div className="relative flex mt-1.5 h-3 text-[10px] text-dark-600">
          {sections.map((s, i) => (
            <button
              key={s.id}
              onClick={() => onSelectSection(i)}
              onMouseEnter={() => setHoverIdx(i)}
              className={`relative h-full truncate text-center transition-colors ${
                i === currentIdx ? "text-crimson-400 font-medium" : "hover:text-dark-300"
              }`}
              style={{ width: `${sectionWidths[i]}%` }}
              aria-label={s.title}
              title={s.title}
            >
              {sectionWidths[i] >= 5 ? s.title : ""}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Live Cypher Display ───────────────────────────────────────────────────────

function buildLiveCypher(slug: string, selectedCharacterId: string | null, currentIdx: number): string {
  if (!selectedCharacterId) {
    return (
      `MATCH (entity:Entity {story: '${slug}'})\n` +
      `WHERE (entity.firstSectionIndex IS NULL\n` +
      `    OR entity.firstSectionIndex <= ${currentIdx})\n` +
      `WITH entity\n` +
      `MATCH (event:Event {story: '${slug}'})\n` +
      `WHERE event.sectionIndex <= ${currentIdx}\n` +
      `RETURN entity, event\n` +
      `ORDER BY event.sectionIndex`
    );
  }
  return (
    `// Perspective: ${selectedCharacterId}\n` +
    `MATCH (c:Character {story: '${slug}',\n` +
    `                    id: '${selectedCharacterId}'})\n` +
    `\n` +
    `// Events this character directly witnessed\n` +
    `OPTIONAL MATCH (c)-[:PARTICIPATED_IN]->(witnessed:Event)\n` +
    `WHERE witnessed.sectionIndex <= ${currentIdx}\n` +
    `\n` +
    `// Events this character was told about\n` +
    `OPTIONAL MATCH (told:Event)-[:TOLD_TO]->(c)\n` +
    `WHERE told.sectionIndex <= ${currentIdx}\n` +
    `\n` +
    `WITH c, collect(DISTINCT witnessed) + collect(DISTINCT told) AS allEvents\n` +
    `UNWIND allEvents AS event\n` +
    `\n` +
    `// Co-present entities for each event\n` +
    `OPTIONAL MATCH (entity:Entity)-[:PARTICIPATED_IN]->(event)\n` +
    `RETURN event,\n` +
    `       collect(DISTINCT entity) AS coPresent\n` +
    `ORDER BY event.sectionIndex`
  );
}

function highlightCypher(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .replace(/(\/\/[^\n]*)/g, '<span style="color:#6b7280;font-style:italic">$1</span>')
    .replace(/\b(MATCH|OPTIONAL|WHERE|RETURN|WITH|UNWIND|ORDER BY|LIMIT|AND|OR|NOT|AS|DISTINCT|collect|count|type|labels|IS NULL|IS NOT NULL)\b/g,
      '<span style="color:#818cf8;font-weight:600">$1</span>')
    .replace(/(:[\w]+)/g, '<span style="color:#34d399">$1</span>')
    .replace(/'([^']*)'/g, "<span style=\"color:#fbbf24\">'$1'</span>")
    .replace(/(\{[^}]*\})/g, '<span style="color:#f9a8d4">$1</span>');
}

function CypherDisplay({
  slug,
  selectedCharacterId,
  selectedCharacter,
  currentIdx,
}: {
  slug: string;
  selectedCharacterId: string | null;
  selectedCharacter: Entity | null;
  currentIdx: number;
}) {
  const [open, setOpen] = useState(false);
  const query = buildLiveCypher(slug, selectedCharacterId, currentIdx);
  const highlighted = highlightCypher(query);

  return (
    <div className="shrink-0 border-b border-dark-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-1.5 bg-dark-950 hover:bg-dark-900/80 transition-colors text-left"
      >
        <span className="text-xs font-mono font-semibold text-emerald-500">CYPHER</span>
        <span className="text-dark-700 text-xs">·</span>
        <span className="text-xs text-dark-500 truncate flex-1">
          {selectedCharacter
            ? `perspective: ${selectedCharacter.label} · section ≤ ${currentIdx}`
            : `all entities · section ≤ ${currentIdx}`}
        </span>
        <span className="text-xs text-dark-600 shrink-0">{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && (
        <div className="border-t border-dark-800 bg-dark-900/40 overflow-x-auto">
          <pre
            className="text-xs font-mono leading-relaxed px-5 py-3 select-all whitespace-pre"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </div>
      )}
    </div>
  );
}
