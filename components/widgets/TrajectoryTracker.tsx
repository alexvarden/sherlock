"use client";

import { useMemo, useState } from "react";
import type { TrajectoryWork, TrajectorySegment } from "@/lib/canon-types";

interface Props {
  trajectories: TrajectoryWork[];
}

// Generate a stable colour per location key
function colourFor(key: string): string {
  // Crane-adjacent palette: warm dark + crimson accent + cool counterpoints
  const palette = [
    "#e11d48", // crimson-500
    "#a855f7", // purple-500
    "#10b981", // emerald
    "#f59e0b", // amber
    "#06b6d4", // cyan
    "#fb7185", // crimson-400
    "#84cc16", // lime
    "#f97316", // orange
    "#0ea5e9", // sky
    "#ec4899", // pink
    "#22c55e", // green
    "#eab308", // yellow
  ];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

interface CharacterTrack {
  key: string;
  label: string;
  segments: TrajectorySegment[];
}

export default function TrajectoryTracker({ trajectories }: Props) {
  const sortedWorks = useMemo(
    () => [...trajectories].sort((a, b) => b.segments.length - a.segments.length),
    [trajectories]
  );

  // Prefer Hound; fall back to whichever has the most state-edge data
  const defaultSlug =
    sortedWorks.find((w) => w.slug === "hound-of-the-baskervilles")?.slug ??
    sortedWorks[0]?.slug;

  const [slug, setSlug] = useState<string>(defaultSlug);
  const [hover, setHover] = useState<{ character: string; location: string; from: number; to: number } | null>(null);

  const work = trajectories.find((w) => w.slug === slug);

  const characterTracks: CharacterTrack[] = useMemo(() => {
    if (!work) return [];
    const byChar = new Map<string, CharacterTrack>();
    for (const seg of work.segments) {
      if (!byChar.has(seg.characterKey)) {
        byChar.set(seg.characterKey, {
          key: seg.characterKey,
          label: seg.characterLabel,
          segments: [],
        });
      }
      byChar.get(seg.characterKey)!.segments.push(seg);
    }
    // Sort each character's segments by start
    for (const t of byChar.values()) {
      t.segments.sort((a, b) => a.fromEventIndex - b.fromEventIndex);
    }
    // Order tracks: Holmes first, Watson second, then by segment count
    const tracks = Array.from(byChar.values());
    tracks.sort((a, b) => {
      const order = (k: string) => k === "sherlock_holmes" ? 0 : k === "watson" ? 1 : 2;
      const aOrder = order(a.key);
      const bOrder = order(b.key);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return b.segments.length - a.segments.length;
    });
    return tracks.slice(0, 8);
  }, [work]);

  if (!work) {
    return (
      <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 text-sm text-dark-400">
        No trajectory data available.
      </div>
    );
  }

  const eventCount = work.eventCount || 1;

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400">
          Work
        </label>
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="bg-dark-800 border border-dark-700 hover:border-dark-600 rounded px-3 py-1.5 text-sm text-dark-100 font-medium"
        >
          {sortedWorks.map((w) => (
            <option key={w.slug} value={w.slug}>
              {w.name} · {w.segments.length} segments
            </option>
          ))}
        </select>
        <span className="text-xs text-dark-500 ml-auto">
          {work.eventCount.toLocaleString()} events · {characterTracks.length} characters tracked
        </span>
      </div>

      {characterTracks.length === 0 ? (
        <div className="rounded p-4 bg-dark-950/60 border border-dark-800 text-sm text-dark-400 italic">
          No LOCATED_AT state edges in this work&apos;s graph.
        </div>
      ) : (
        <div className="space-y-2">
          {/* Time axis */}
          <div className="flex items-center gap-3 text-[10px] font-mono text-dark-600">
            <div className="w-32" />
            <div className="flex-1 flex justify-between">
              <span>event 1</span>
              <span>event {eventCount}</span>
            </div>
          </div>

          {characterTracks.map((track) => (
            <div key={track.key} className="flex items-center gap-3">
              <div className="w-32 text-xs truncate text-dark-200" title={track.label}>
                {track.label}
              </div>
              <div
                className="flex-1 h-7 bg-dark-850 rounded border border-dark-800 relative overflow-hidden"
                onMouseLeave={() => setHover(null)}
              >
                {track.segments.map((seg, i) => {
                  const left = (seg.fromEventIndex / eventCount) * 100;
                  const width = Math.max(
                    0.4,
                    ((seg.toEventIndex - seg.fromEventIndex) / eventCount) * 100
                  );
                  return (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 cursor-pointer hover:brightness-125 transition-all"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: colourFor(seg.locationKey),
                        opacity: 0.78,
                      }}
                      title={`${seg.characterLabel} at ${seg.locationLabel} · events ${seg.fromEventIndex + 1}–${seg.toEventIndex}`}
                      onMouseEnter={() =>
                        setHover({
                          character: seg.characterLabel,
                          location: seg.locationLabel,
                          from: seg.fromEventIndex + 1,
                          to: seg.toEventIndex,
                        })
                      }
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="min-h-[60px] mt-3 p-4 rounded bg-dark-950/60 border border-dark-800">
        {hover ? (
          <p className="text-sm text-dark-200">
            <span className="font-medium">{hover.character}</span> at{" "}
            <span className="text-crimson-400">{hover.location}</span>{" "}
            <span className="text-dark-500 font-mono text-xs">
              (events {hover.from}–{hover.to})
            </span>
          </p>
        ) : (
          <p className="text-sm text-dark-500 italic">
            Hover any segment to see the character&apos;s inferred location at that point in story-time.
          </p>
        )}
      </div>
    </div>
  );
}
