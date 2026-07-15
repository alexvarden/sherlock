"use client";

// ── Three-layer architecture explainer ──────────────────────────────────
// Static, structured layer cards with concrete example values per layer
// and a clearer data-flow story between them.

interface Layer {
  number: number;
  name: string;
  tagline: string;
  colour: string;
  primitives: string[];
}

const LAYERS: Layer[] = [
  {
    number: 1,
    name: "Lexical Graph",
    tagline: "breaks books down into sentences, paragraphs, and gives each a unique addressable ID.",
    colour: "#7a6e6e",
    primitives: ["book", "paragraphs", "sentences"],
  },
  {
    number: 2,
    name: "Entity Extraction",
    tagline: "What happened, where, who was there — extracted, citation-grounded.",
    colour: "#e11d48",
    primitives: ["character", "actions", "mentions", "clues", "items", "locations"],
  },
  {
    number: 3,
    name: "Character state",
    tagline: "What anyone knew, at any point. Derived from entity extraction data at query time.",
    colour: "#a855f7",
    primitives: ["observations", "beliefs", "deductions"],
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
              </div>

              <p className="text-sm text-dark-300 mb-3 leading-relaxed">{layer.tagline}</p>

              {/* Primitive chips */}
              <div className="flex flex-wrap gap-1.5">
                {layer.primitives.map((p) => (
                  <span
                    key={p}
                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-dark-850 border border-dark-700 text-dark-300"
                  >
                    {p}
                  </span>
                ))}
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
    </div>
  );
}
