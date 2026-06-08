"use client";

import { useMemo, useState } from "react";
import type { PassageData } from "@/lib/post0-data";

interface Props {
  passage: PassageData;
}

const TYPE_COLOURS: Record<string, string> = {
  character: "#e11d48",
  location: "#a855f7",
  object: "#7a6e6e",
  case: "#f59e0b",
  document: "#06b6d4",
  organisation: "#10b981",
};

// Curated featured entities for the demo — different mention densities.
const FEATURED_ENTITY_IDS = ["sherlock_holmes", "professor_moriarty", "the_final_problem_case"];

export default function LexicalGraphView({ passage }: Props) {
  const [hoveredSentenceId, setHoveredSentenceId] = useState<string | null>(null);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);

  // Show the first 8 sentences for clarity
  const sentences = useMemo(() => passage.sentences.slice(0, 8), [passage.sentences]);

  const featuredEntities = useMemo(
    () => FEATURED_ENTITY_IDS
      .map((id) => passage.entities.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e)),
    [passage.entities]
  );

  // Build mention lookup: entityId → set of sentence ids in this view
  const mentionsByEntity = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const s of sentences) {
      for (const eid of s.entityIds) {
        if (!m.has(eid)) m.set(eid, new Set());
        m.get(eid)!.add(s.id);
      }
    }
    return m;
  }, [sentences]);

  // ── Layout coordinates ────────────────────────────────────────────────
  const PADDING = 24;
  const ENTITY_ROW_HEIGHT = 60;
  const ENTITY_GAP_TO_SENTENCES = 60;
  const SECTION_FRAME_PAD = 16;
  const SENTENCE_NODE_W = 64;
  const SENTENCE_NODE_H = 44;
  const SENTENCE_GAP = 18;

  const layoutWidth =
    PADDING * 2 + SECTION_FRAME_PAD * 2 + sentences.length * SENTENCE_NODE_W + (sentences.length - 1) * SENTENCE_GAP;
  const layoutHeight = PADDING + ENTITY_ROW_HEIGHT + ENTITY_GAP_TO_SENTENCES + SECTION_FRAME_PAD * 2 + SENTENCE_NODE_H + PADDING + 40;

  const sentenceY = PADDING + ENTITY_ROW_HEIGHT + ENTITY_GAP_TO_SENTENCES + SECTION_FRAME_PAD;
  const sentencePositions = sentences.map((_, i) => ({
    x: PADDING + SECTION_FRAME_PAD + i * (SENTENCE_NODE_W + SENTENCE_GAP),
    y: sentenceY,
  }));
  const sentenceCenters = sentencePositions.map((p) => ({
    x: p.x + SENTENCE_NODE_W / 2,
    y: p.y + SENTENCE_NODE_H / 2,
  }));

  // Entity positions: spread across the top
  const entityCount = featuredEntities.length;
  const entityY = PADDING + ENTITY_ROW_HEIGHT / 2;
  const entityPositions = featuredEntities.map((_, i) => {
    const segmentWidth = (layoutWidth - PADDING * 2) / entityCount;
    return {
      x: PADDING + segmentWidth * (i + 0.5),
      y: entityY,
    };
  });

  const sectionFrame = {
    x: PADDING,
    y: sentenceY - SECTION_FRAME_PAD,
    w: layoutWidth - PADDING * 2,
    h: SENTENCE_NODE_H + SECTION_FRAME_PAD * 2,
  };

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-4">
      <p className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400 mb-1">
        First {sentences.length} sentences · The Final Problem · section_1
      </p>

      <div className="bg-dark-950 rounded border border-dark-800 p-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${layoutWidth} ${layoutHeight}`}
          style={{ width: "100%", minWidth: layoutWidth, height: "auto", display: "block" }}
        >
          {/* Arrow marker */}
          <defs>
            <marker id="lg-pos-arrow" viewBox="0 -3 8 6" refX="7" refY="0" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,-3L7,0L0,3" fill="#5c5252" />
            </marker>
            <marker id="lg-mention-arrow" viewBox="0 -3 8 6" refX="7" refY="0" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,-3L7,0L0,3" fill="#7a6e6e" />
            </marker>
          </defs>

          {/* ── Section frame ───────────────────────────────────────────── */}
          <rect
            x={sectionFrame.x}
            y={sectionFrame.y}
            width={sectionFrame.w}
            height={sectionFrame.h}
            rx={6}
            fill="none"
            stroke="#433f3f"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text
            x={sectionFrame.x + 8}
            y={sectionFrame.y + sectionFrame.h + 16}
            fill="#7a6e6e"
            fontFamily="var(--font-mono)"
            fontSize={10}
          >
            section · grouping by chapter/scene
          </text>

          {/* ── Positional edges between adjacent sentences ─────────────── */}
          {sentenceCenters.slice(0, -1).map((c, i) => {
            const next = sentenceCenters[i + 1];
            return (
              <line
                key={`pos-${i}`}
                x1={c.x + SENTENCE_NODE_W / 2 - 2}
                y1={c.y}
                x2={next.x - SENTENCE_NODE_W / 2 + 2}
                y2={next.y}
                stroke="#5c5252"
                strokeWidth={1.2}
                markerEnd="url(#lg-pos-arrow)"
              />
            );
          })}

          {/* ── Mention edges (entity → sentence) ──────────────────────── */}
          {featuredEntities.map((ent, ei) => {
            const ePos = entityPositions[ei];
            const sentenceIds = mentionsByEntity.get(ent.id) ?? new Set();
            const isHovered = hoveredEntityId === ent.id;
            const colour = TYPE_COLOURS[ent.type] ?? "#999";
            return sentences.map((s, si) => {
              if (!sentenceIds.has(s.id)) return null;
              const sPos = sentenceCenters[si];
              const dim = hoveredEntityId !== null && !isHovered;
              return (
                <line
                  key={`mention-${ent.id}-${s.id}`}
                  x1={ePos.x}
                  y1={ePos.y + 14}
                  x2={sPos.x}
                  y2={sPos.y - SENTENCE_NODE_H / 2 - 2}
                  stroke={colour}
                  strokeWidth={isHovered ? 1.6 : 1}
                  strokeDasharray="3 2"
                  strokeOpacity={dim ? 0.12 : isHovered ? 0.9 : 0.5}
                />
              );
            });
          })}

          {/* ── Entity nodes (Layer 2) ──────────────────────────────────── */}
          {featuredEntities.map((ent, ei) => {
            const pos = entityPositions[ei];
            const colour = TYPE_COLOURS[ent.type] ?? "#999";
            const isHovered = hoveredEntityId === ent.id;
            const labelWidth = Math.max(80, ent.label.length * 7);
            return (
              <g
                key={ent.id}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredEntityId(ent.id)}
                onMouseLeave={() => setHoveredEntityId(null)}
              >
                <rect
                  x={pos.x - labelWidth / 2}
                  y={pos.y - 14}
                  width={labelWidth}
                  height={28}
                  rx={14}
                  fill={isHovered ? colour : `${colour}22`}
                  stroke={colour}
                  strokeWidth={1.2}
                />
                <text
                  x={pos.x}
                  y={pos.y + 4}
                  fontFamily="var(--font-sans)"
                  fontSize={11}
                  fontWeight={500}
                  fill={isHovered ? "#fff" : colour}
                  textAnchor="middle"
                  style={{ pointerEvents: "none" }}
                >
                  {ent.label}
                </text>
                <text
                  x={pos.x}
                  y={pos.y - 22}
                  fontFamily="var(--font-mono)"
                  fontSize={9}
                  fill="#7a6e6e"
                  textAnchor="middle"
                  style={{ pointerEvents: "none" }}
                >
                  Layer 2 · {ent.type}
                </text>
              </g>
            );
          })}

          {/* ── Sentence nodes (Layer 1) ────────────────────────────────── */}
          {sentences.map((s, i) => {
            const pos = sentencePositions[i];
            const isHovered = hoveredSentenceId === s.id;
            const dim =
              (hoveredEntityId && !(mentionsByEntity.get(hoveredEntityId)?.has(s.id))) ?? false;
            return (
              <g
                key={s.id}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredSentenceId(s.id)}
                onMouseLeave={() => setHoveredSentenceId(null)}
              >
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={SENTENCE_NODE_W}
                  height={SENTENCE_NODE_H}
                  rx={4}
                  fill={isHovered ? "#262323" : "#1c1a1a"}
                  stroke={isHovered ? "#e11d48" : "#433f3f"}
                  strokeWidth={isHovered ? 1.5 : 1}
                  opacity={dim ? 0.35 : 1}
                />
                <text
                  x={pos.x + SENTENCE_NODE_W / 2}
                  y={pos.y + 16}
                  fontFamily="var(--font-mono)"
                  fontSize={9}
                  fill="#a19a9a"
                  textAnchor="middle"
                  style={{ pointerEvents: "none" }}
                >
                  pos {s.position}
                </text>
                <text
                  x={pos.x + SENTENCE_NODE_W / 2}
                  y={pos.y + 32}
                  fontFamily="var(--font-mono)"
                  fontSize={9}
                  fontWeight={500}
                  fill="#d7c9c9"
                  textAnchor="middle"
                  style={{ pointerEvents: "none" }}
                >
                  {s.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Hover detail panel */}
      <div className="min-h-[78px] p-4 rounded bg-dark-950/60 border border-dark-800">
        {hoveredSentenceId ? (
          (() => {
            const s = sentences.find((x) => x.id === hoveredSentenceId);
            if (!s) return null;
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-crimson-400">
                    {s.id}
                  </span>
                  <span className="text-[10px] font-mono text-dark-600">
                    · global position {s.position}
                  </span>
                  <span className="text-[10px] font-mono text-dark-600 ml-auto">
                    {s.entityIds.length} entities mention this sentence
                  </span>
                </div>
                <p className="text-sm text-dark-200 leading-relaxed italic">
                  &ldquo;{s.text.length > 220 ? s.text.slice(0, 220) + "…" : s.text}&rdquo;
                </p>
              </div>
            );
          })()
        ) : hoveredEntityId ? (
          (() => {
            const ent = featuredEntities.find((e) => e.id === hoveredEntityId);
            if (!ent) return null;
            const sentenceIds = mentionsByEntity.get(ent.id) ?? new Set();
            return (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ backgroundColor: TYPE_COLOURS[ent.type] }}
                  />
                  <span className="text-sm font-medium text-dark-100">{ent.label}</span>
                  <span className="text-[10px] font-mono text-dark-500">{ent.id}</span>
                </div>
                <p className="text-xs text-dark-400 font-mono">
                  mentioned in {sentenceIds.size} of {sentences.length} sentences shown ·{" "}
                  {Array.from(sentenceIds).join(", ")}
                </p>
              </div>
            );
          })()
        ) : (
          <p className="text-sm text-dark-500 italic">
            Hover a sentence node to read it. Hover an entity to see which sentences cite it.
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-5 text-[10px] font-mono text-dark-500">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="6">
            <line x1="0" y1="3" x2="14" y2="3" stroke="#5c5252" strokeWidth="1.2" markerEnd="url(#lg-pos-arrow)" />
          </svg>
          positional edge · ordering
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="6">
            <line x1="0" y1="3" x2="14" y2="3" stroke="#a19a9a" strokeWidth="1.2" strokeDasharray="3 2" />
          </svg>
          mention edge · entity → sentence
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-dark-600" />
          section frame · grouping
        </span>
      </div>
    </div>
  );
}
