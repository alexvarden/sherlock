// ── Ingest loop explainer ────────────────────────────────────────────────
// Static flow diagram of the per-paragraph extraction loop: prompt →
// structured output → validator → (reject & re-prompt | save to graph).
// Server-renderable; no client state.

const STEPS = ["Paragraph", "LLM call", "Structured output", "Validator", "Save to graph"];

// Box centres as fractions of row width (5 equal flex columns).
const LLM_CENTRE = ((STEPS.indexOf("LLM call") + 0.5) / STEPS.length) * 100;
const VALIDATOR_CENTRE = ((STEPS.indexOf("Validator") + 0.5) / STEPS.length) * 100;

export default function IngestLoopDiagram() {
  return (
    <div className="rounded-lg border border-dark-800 bg-dark-900/50 p-5">
      <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:flex-1">
            <div
              className={`flex-1 rounded border p-3 flex items-center justify-center ${
                label === "Validator"
                  ? "border-crimson-500/40 bg-crimson-500/5"
                  : "border-dark-800 bg-dark-950/60"
              }`}
            >
              <p className="mono text-xs text-dark-100 text-center">{label}</p>
            </div>
            {i < STEPS.length - 1 && (
              <span className="mono text-dark-600 text-xs self-center rotate-90 sm:rotate-0">→</span>
            )}
          </div>
        ))}
      </div>

      {/* Reject loop: Validator back to LLM call */}
      <div className="hidden sm:block relative h-12" aria-hidden>
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 48"
          preserveAspectRatio="none"
        >
          <path
            d={`M ${VALIDATOR_CENTRE} 0 L ${VALIDATOR_CENTRE} 30 L ${LLM_CENTRE} 30 L ${LLM_CENTRE} 8`}
            fill="none"
            stroke="#e11d48"
            strokeOpacity="0.5"
            strokeWidth="1"
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={`M ${LLM_CENTRE - 1.2} 12 L ${LLM_CENTRE} 6 L ${LLM_CENTRE + 1.2} 12`}
            fill="none"
            stroke="#e11d48"
            strokeOpacity="0.5"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute mono text-[10px] text-crimson-400/80 -translate-x-1/2"
          style={{ left: `${(LLM_CENTRE + VALIDATOR_CENTRE) / 2}%`, top: "40px" }}
        >
          unknown entities - retry
        </span>
      </div>
      <p className="sm:hidden mono text-[10px] text-crimson-400/80 pt-2">
        ↺ Validator rejects → re-prompt the LLM call
      </p>
    </div>
  );
}
