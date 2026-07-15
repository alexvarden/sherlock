"use client";

import { useMemo, useState } from "react";
import type { PassageData } from "../../lib/post0-data";

interface Props {
  passage: PassageData;
}

type Tab = "lexical" | "objective" | "citations";

const TYPE_COLOURS: Record<string, string> = {
  character: "#e11d48",
  location: "#a855f7",
  object: "#7a6e6e",
  case: "#f59e0b",
  document: "#06b6d4",
  organisation: "#10b981",
};

// Build a regex that matches any of the given labels (case-insensitive, word-bounded).
function buildLabelMatcher(labels: { id: string; label: string }[]): RegExp | null {
  if (labels.length === 0) return null;
  // Sort by length desc so longer matches win over shorter ones
  const sorted = [...labels].sort((a, b) => b.label.length - a.label.length);
  const escaped = sorted.map((l) => l.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Use a non-word boundary that allows for punctuation
  return new RegExp(`(${escaped.join("|")})`, "gi");
}

interface Segment {
  text: string;
  entityId: string | null;
  entityType: string | null;
}

function segmentSentence(
  text: string,
  entityIds: string[],
  entitiesById: Map<string, { id: string; label: string; type: string }>
): Segment[] {
  const labelToEntity = new Map<string, { id: string; type: string }>();
  const labels: { id: string; label: string }[] = [];
  for (const id of entityIds) {
    const ent = entitiesById.get(id);
    if (!ent) continue;
    labels.push({ id, label: ent.label });
    labelToEntity.set(ent.label.toLowerCase(), { id, type: ent.type });
    // Also register short variants for common cases
    const shortLabel = ent.label.replace(/^(Mr\.?|Mrs\.?|Miss|Dr\.?|Professor|Colonel|Inspector)\s+/i, "");
    if (shortLabel && shortLabel !== ent.label && shortLabel.length > 2) {
      labelToEntity.set(shortLabel.toLowerCase(), { id, type: ent.type });
      labels.push({ id, label: shortLabel });
    }
  }
  const matcher = buildLabelMatcher(labels);
  if (!matcher) return [{ text, entityId: null, entityType: null }];

  const segments: Segment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  matcher.lastIndex = 0;
  while ((m = matcher.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, m.index), entityId: null, entityType: null });
    }
    const ent = labelToEntity.get(m[0].toLowerCase());
    segments.push({
      text: m[0],
      entityId: ent?.id ?? null,
      entityType: ent?.type ?? null,
    });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), entityId: null, entityType: null });
  }
  return segments;
}

export default function PassageWalkthrough({ passage }: Props) {
  const [tab, setTab] = useState<Tab>("lexical");
  const [highlightedCitations, setHighlightedCitations] = useState<Set<string>>(new Set());
  const [highlightedEntityId, setHighlightedEntityId] = useState<string | null>(null);

  const entitiesById = useMemo(() => {
    const m = new Map<string, { id: string; label: string; type: string }>();
    for (const e of passage.entities) m.set(e.id, e);
    return m;
  }, [passage.entities]);

  // Pre-segment sentences for the objective tab
  const segmentedSentences = useMemo(
    () => passage.sentences.map((s) => ({
      ...s,
      segments: segmentSentence(s.text, s.entityIds, entitiesById),
    })),
    [passage.sentences, entitiesById]
  );

  // Events grouped by sentence
  const eventsBySentence = useMemo(() => {
    const m = new Map<string, typeof passage.events>();
    for (const ev of passage.events) {
      for (const sid of ev.sourceIds) {
        if (!m.has(sid)) m.set(sid, []);
        m.get(sid)!.push(ev);
      }
    }
    return m;
  }, [passage.events]);

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 overflow-hidden">
      {/* Header */}
      <div className="border-b border-dark-800 px-6 py-3 flex flex-wrap items-baseline gap-3">
        <p className="text-xs font-mono uppercase tracking-[0.15em] text-crimson-400">
          {passage.workName}
        </p>
        <span className="text-xs text-dark-500">{passage.sectionLabel}</span>
        <span className="text-xs text-dark-500 ml-auto">
          {passage.sentences.length} sentences · {passage.entities.length} entities · {passage.events.length} events
        </span>
      </div>

      {/* Tabs */}
      <div className="border-b border-dark-800 px-6 flex gap-1">
        {(["lexical", "objective", "citations"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-crimson-500 text-dark-100"
                : "border-transparent text-dark-500 hover:text-dark-300"
            }`}
          >
            {t === "lexical" && "Lexical Graph"}
            {t === "objective" && "Entity Extraction"}
            {t === "citations" && "Reverse · Citations"}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="p-6 max-h-[480px] overflow-y-auto">
        {tab === "lexical" && (
          <div className="space-y-2">
            <p className="text-xs text-dark-500 mb-3">
              Every sentence carries a stable ID and a global position. The lexical layer is the immutable citation
              substrate — nothing gets paraphrased, nothing moves.
            </p>
            <div className="space-y-1.5">
              {passage.sentences.map((s) => (
                <div
                  key={s.id}
                  className="flex gap-3 p-3 rounded bg-dark-950/60 border border-dark-800"
                >
                  <div className="shrink-0 w-24 text-[10px] font-mono text-dark-500">
                    <div>pos {s.position}</div>
                    <div className="text-dark-600">{s.id}</div>
                  </div>
                  <p className="text-sm text-dark-200 leading-relaxed flex-1">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "objective" && (
          <div className="space-y-3">
            <p className="text-xs text-dark-500 mb-3">
              Same sentences, with extracted entities highlighted inline and events listed beneath. Every event cites
              the sentence IDs it was derived from. Hover any chip for the entity type.
            </p>
            <div className="space-y-3">
              {segmentedSentences.map((s) => {
                const sentenceEvents = eventsBySentence.get(s.id) ?? [];
                return (
                  <div
                    key={s.id}
                    className="p-3 rounded bg-dark-950/60 border border-dark-800 space-y-2"
                  >
                    <div className="flex gap-3">
                      <div className="shrink-0 w-16 text-[10px] font-mono text-dark-500">
                        pos {s.position}
                      </div>
                      <p className="text-sm text-dark-200 leading-relaxed flex-1">
                        {s.segments.map((seg, i) =>
                          seg.entityId ? (
                            <span
                              key={i}
                              className="px-0.5 rounded-sm transition-colors cursor-help"
                              style={{
                                backgroundColor: `${TYPE_COLOURS[seg.entityType ?? ""] ?? "#999"}33`,
                                color: TYPE_COLOURS[seg.entityType ?? ""] ?? "#fff",
                              }}
                              title={`${seg.entityType} · ${seg.entityId}`}
                            >
                              {seg.text}
                            </span>
                          ) : (
                            <span key={i}>{seg.text}</span>
                          )
                        )}
                      </p>
                    </div>
                    {sentenceEvents.length > 0 && (
                      <div className="pl-[76px] space-y-1">
                        {sentenceEvents.map((ev) => (
                          <div
                            key={ev.id}
                            className="text-[11px] text-dark-400 leading-relaxed flex gap-2"
                          >
                            <span className="font-mono text-dark-600 shrink-0">{ev.id} →</span>
                            <span>{ev.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 pt-2 text-[10px] font-mono text-dark-500">
              {Object.entries(TYPE_COLOURS).map(([type, colour]) => (
                <span key={type} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ backgroundColor: `${colour}33`, border: `1px solid ${colour}66` }}
                  />
                  {type}
                </span>
              ))}
            </div>
          </div>
        )}

        {tab === "citations" && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-4">
        

            <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 mt-3 mb-1">
                Entities
            </p>
            <div className="flex flex-wrap gap-1.5">
                {passage.entities.map((e) => {
                    const active = e.id === highlightedEntityId;
                    const colour = TYPE_COLOURS[e.type] ?? "#999";
                    return (
                        <button
                            key={e.id}
                            onClick={() => {
                                setHighlightedEntityId(e.id);
                                const sids = new Set<string>();
                                for (const s of passage.sentences) {
                                    if (s.entityIds.includes(e.id)) sids.add(s.id);
                                }
                                setHighlightedCitations(sids);
                            }}
                            className="text-[11px] px-2 py-0.5 rounded transition-colors border"
                            style={{
                                color: active ? "#fff" : colour,
                                backgroundColor: active ? colour : `${colour}15`,
                                borderColor: active ? colour : `${colour}55`,
                            }}
                        >
                            {e.label}
                        </button>
                    );
                })}
            </div>

              <div className="space-y-1">
                <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 mt-2 mb-1">
                  Events
                </p>
                {passage.events.map((ev) => {
                  const active = ev.sourceIds.some((s) => highlightedCitations.has(s));
                  return (
                    <button
                      key={ev.id}
                      onClick={() => setHighlightedCitations(new Set(ev.sourceIds))}
                      className={`text-left w-full px-2 py-1.5 rounded text-xs leading-snug transition-colors border ${
                        active
                          ? "bg-crimson-500/10 border-crimson-500/40 text-dark-100"
                          : "bg-dark-850 border-dark-800 hover:border-dark-700 text-dark-300"
                      }`}
                    >
                      {ev.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
              {passage.sentences.map((s) => {
                const lit = highlightedCitations.has(s.id);
                return (
                  <div
                    key={s.id}
                    className={`flex gap-3 p-3 rounded border transition-colors ${
                      lit
                        ? "bg-crimson-500/5 border-crimson-500/40"
                        : "bg-dark-950/60 border-dark-800"
                    }`}
                  >
                    <div className="shrink-0 w-16 text-[10px] font-mono text-dark-500">
                      pos {s.position}
                    </div>
                    <p className={`text-sm leading-relaxed flex-1 ${lit ? "text-dark-100" : "text-dark-400"}`}>
                      {s.text}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
