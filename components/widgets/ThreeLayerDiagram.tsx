"use client";

// ── Three-layer architecture explainer ──────────────────────────────────
// Static, structured layer cards with concrete example values per layer
// and a clearer data-flow story between them.

interface Layer {
  number: number;
  name: string;
  tagline: string;
  mode: string;
  modeColour: string;
  colour: string;
  primitives: string[];
  example: { label: string; value: string };
}

const LAYERS: Layer[] = [
  {
    number: 1,
    name: "Lexical",
    tagline: "Every sentence positioned, every section catalogued. Immutable.",
    mode: "Deterministic",
    modeColour: "#10b981",
    colour: "#7a6e6e",
    primitives: ["sentences", "sections", "global position"],
    example: {
      label: "sentence_3 · pos 2",
      value: "“It is with a heavy heart that I take up my pen…”",
    },
  },
  {
    number: 2,
    name: "Objective",
    tagline: "What happened, where, who was there — extracted, citation-grounded.",
    mode: "LLM-extracted",
    modeColour: "#a855f7",
    colour: "#e11d48",
    primitives: ["entities", "events", "state edges", "mentions", "clues"],
    example: {
      label: "event_1_9",
      value: "Holmes arrives in Watson’s consulting-room · cites sentence_14",
    },
  },
  {
    number: 3,
    name: "Character state",
    tagline: "What anyone knew, at any point. Derived; never stored.",
    mode: "Computed at query time",
    modeColour: "#06b6d4",
    colour: "#a855f7",
    primitives: ["observations", "beliefs", "deductions"],
    example: {
      label: "Watson @ sentence_14",
      value: "knows: Holmes is in the room. Doesn’t yet know: Holmes is on the run.",
    },
  },
];

const FLOW_LABELS = ["extracts from", "derived from at query time"];

export default function ThreeLayerDiagram() {
  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 p-8">
      {/* Stack of layers with flow arrows between */}
      <div className="space-y-1">
        {LAYERS.map((layer, i) => (
          <div key={layer.name}>
            {/* Layer card */}
            <div
              className="rounded-lg border-2 p-5 transition-all"
              style={{
                borderColor: `${layer.colour}55`,
                background: `linear-gradient(135deg, ${layer.colour}10 0%, transparent 60%)`,
              }}
            >
              {/* Header row */}
              <div className="flex flex-wrap items-baseline gap-3 mb-3">
                <span
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-mono font-semibold shrink-0"
                  style={{ backgroundColor: layer.colour, color: "#fff" }}
                >
                  {layer.number}
                </span>
                <h3 className="text-base font-semibold" style={{ color: layer.colour }}>
                  {layer.name}
                </h3>
                <span
                  className="text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-0.5 rounded"
                  style={{ color: layer.modeColour, backgroundColor: `${layer.modeColour}15` }}
                >
                  {layer.mode}
                </span>
              </div>

              <p className="text-sm text-dark-300 mb-3 leading-relaxed">{layer.tagline}</p>

              {/* Primitive chips */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {layer.primitives.map((p) => (
                  <span
                    key={p}
                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-dark-850 border border-dark-700 text-dark-300"
                  >
                    {p}
                  </span>
                ))}
              </div>

              {/* Concrete example */}
              <div
                className="rounded p-3 border border-dark-800 bg-dark-950/60 text-xs leading-relaxed"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-dark-500 mb-1">
                  Example value at this layer
                </div>
                <div className="font-mono text-dark-400 mb-1">{layer.example.label}</div>
                <div className="text-dark-200">{layer.example.value}</div>
              </div>
            </div>

            {/* Flow arrow between layers */}
            {i < LAYERS.length - 1 && (
              <div className="flex items-center gap-3 px-6 py-2">
                <div className="h-6 w-px bg-dark-700" />
                <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
                  <path d="M7 0 L7 11 M3 7 L7 13 L11 7" fill="none" stroke="#5c5252" strokeWidth="1.5" />
                </svg>
                <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500">
                  {FLOW_LABELS[i]}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* The rule that holds it together */}
      <div className="mt-6 p-4 rounded border border-crimson-500/30 bg-crimson-500/5 flex gap-4 items-start">
        <div className="shrink-0 w-1 h-12 rounded bg-crimson-500" />
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.15em] text-crimson-400 mb-1">
            The rule that holds it together
          </p>
          <p className="text-sm text-dark-200 leading-relaxed">
            The graph stores <span className="text-dark-100 font-medium">reality</span>, not{" "}
            <span className="text-dark-100 font-medium">knowledge</span>. Belief, perception, what-anyone-knew —
            those live in Layer 3, computed at query time. A validator forbids cognitive predicates
            (<code className="font-mono text-crimson-300 text-xs">BELIEVES</code>,{" "}
            <code className="font-mono text-crimson-300 text-xs">KNOWS</code>,{" "}
            <code className="font-mono text-crimson-300 text-xs">knownBy</code>) anywhere in Layer 2.
            If you don&apos;t enforce this rule, the whole system gets fuzzy and you&apos;re back to vector search.
          </p>
        </div>
      </div>
    </div>
  );
}
