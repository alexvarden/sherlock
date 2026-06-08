export const dynamic = "force-dynamic";

import CraneHeader from "@/components/CraneHeader";
import CraneFooter from "@/components/CraneFooter";
import { loadCanonData } from "@/lib/canon-aggregate";
import PresenceStrip from "@/components/widgets/PresenceStrip";
import CitationScoreboard from "@/components/widgets/CitationScoreboard";
import CoOccurrenceNetwork from "@/components/widgets/CoOccurrenceNetwork";
import TrajectoryTracker from "@/components/widgets/TrajectoryTracker";
import FrequencyTree from "@/components/widgets/FrequencyTree";

const FAMOUS_QUOTES_FOR_COUNT = [
  "elementary, my dear watson",
  "elementary",
  "the game is afoot",
  "you know my methods",
  "eliminated the impossible",
  "curious incident",
  "three pipe",
  "napoleon of crime",
  "my dear watson",
];

export default async function AnalysisPage() {
  const data = loadCanonData();

  const totalSentences = data.works.reduce((s, w) => s + w.sentenceCount, 0);
  const totalEntities = data.entities.length;
  const totalCharacters = data.entities.filter((e) => e.type === "character").length;

  // Precompute famous-quote counts so the client doesn't ship 20,500 sentences.
  const famousQuoteCounts: Record<string, number> = {};
  for (const q of FAMOUS_QUOTES_FOR_COUNT) {
    const needle = q.toLowerCase();
    famousQuoteCounts[q] = data.sentences.reduce(
      (n, s) => n + (s.text.toLowerCase().includes(needle) ? 1 : 0),
      0
    );
  }

  return (
    <main className="min-h-screen bg-dark-950 text-dark-100 flex flex-col">
      <CraneHeader crumbs={[{ label: "Analysis" }]} />

      <div className="max-w-5xl mx-auto px-8 py-16 space-y-24 w-full">

        {/* ── Intro ─────────────────────────────────────────────────────── */}
        <section className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-crimson-500">
            The canon, as data
          </p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
            Five ways into the Holmes canon.
          </h1>
          <p className="text-dark-300 text-lg leading-relaxed max-w-3xl">
            Across {data.works.length} works — four novels and twelve stories from <em>The Memoirs of Sherlock Holmes</em> — every
            sentence is positioned, every named thing is extracted, and every claim ties back to the page. {totalSentences.toLocaleString()} sentences;{" "}
            {totalEntities.toLocaleString()} entities; {totalCharacters.toLocaleString()} named characters.
          </p>
          <p className="text-dark-400 text-base leading-relaxed max-w-3xl">
            What follows is a portfolio of five analytical primitives, each demonstrating a different way to ask the corpus
            a question. Position. Search. Relation. Time. Aggregate. The article arc will come later — first, the toolkit.
          </p>
          <div className="text-xs font-mono text-dark-500 pt-2">
            <span>“Data, data, data — I cannot make bricks without clay.”</span>
            <span className="ml-2 text-dark-600">— Holmes, <em>The Copper Beeches</em></span>
          </div>
        </section>

        {/* ── Widget 1: Presence Strip ──────────────────────────────────── */}
        <section className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
              Primitive 1 · Position
            </p>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Where in the text does a character actually appear?
            </h2>
            <p className="text-dark-300 leading-relaxed max-w-3xl">
              Each row is one work. Each mark is one sentence that names the chosen character. Gaps are absences — the
              right halves of <em>A Study in Scarlet</em> and <em>The Valley of Fear</em> reveal Doyle&apos;s bimodal
              novel structure at a glance. Switch characters to see the pattern shift.
            </p>
          </div>
          <PresenceStrip
            works={data.works}
            entities={data.entities}
            presence={data.presence}
          />
          <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
            Built from <code className="font-mono text-dark-400">mentions</code> joined to lexical sentence positions.
            Hover any mark for the cited sentence.
          </p>
        </section>

        {/* ── Widget 2: Citation Scoreboard ─────────────────────────────── */}
        <section className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
              Primitive 2 · Search
            </p>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Did Holmes ever say that?
            </h2>
            <p className="text-dark-300 leading-relaxed max-w-3xl">
              Substring search across every sentence in the canon. Famous lines pre-loaded; type your own at the bottom.
              The catchphrase &quot;elementary, my dear Watson&quot; almost certainly does not appear in the canon — every
              sentence here is direct evidence.
            </p>
          </div>
          <CitationScoreboard
            famousQuoteCounts={famousQuoteCounts}
            totalSentences={totalSentences}
          />
          <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
            Case-insensitive substring scan over {totalSentences.toLocaleString()} sentences. Runs in the browser.
          </p>
        </section>

        {/* ── Widget 3: Co-occurrence Network ───────────────────────────── */}
        <section className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
              Primitive 3 · Relation
            </p>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              The social shape of the canon.
            </h2>
            <p className="text-dark-300 leading-relaxed max-w-3xl">
              Two characters share an edge if they appear in the same section. Edge weight = shared-section count.
              Holmes and Watson sit at the centre; almost every other character connects through them. Doyle wrote a
              star, not a network.
            </p>
          </div>
          <CoOccurrenceNetwork
            entities={data.entities}
            edges={data.coOccurrence}
          />
          <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
            Top {Math.min(40, data.entities.filter((e) => e.type === "character").length)} characters by mention count.
            Drag nodes to explore. Use the slider to filter by edge weight.
          </p>
        </section>

        {/* ── Widget 4: Trajectory Tracker ──────────────────────────────── */}
        <section className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
              Primitive 4 · Time
            </p>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Where was Watson, when?
            </h2>
            <p className="text-dark-300 leading-relaxed max-w-3xl">
              Each strip is one character&apos;s location, derived from temporally-scoped state edges. Pick a work,
              add characters, see who was where as the story unfolds. This is the substrate that lets a perspective-
              aware reader know what each character could possibly know.
            </p>
          </div>
          <TrajectoryTracker trajectories={data.trajectories} />
          <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
            Built from <code className="font-mono text-dark-400">stateEdges</code> of type LOCATED_AT with{" "}
            <code className="font-mono text-dark-400">valid_from</code> / <code className="font-mono text-dark-400">valid_until</code>{" "}
            bracketing.
          </p>
        </section>

        {/* ── Widget 5: Frequency Tree ──────────────────────────────────── */}
        <section className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
              Primitive 5 · Aggregate
            </p>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              The canon at a glance.
            </h2>
            <p className="text-dark-300 leading-relaxed max-w-3xl">
              Every named thing in the canon, sized by mention count, partitioned by type. Most of the corpus is
              characters and locations; both follow a long-tail distribution. A handful of names dominate; the rest is
              one-shots.
            </p>
          </div>
          <FrequencyTree frequency={data.frequency} />
          <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
            Top 60 per type. Click any block for the entity label and works it appears in.
          </p>
        </section>

        {/* ── Closer ────────────────────────────────────────────────────── */}
        <section className="space-y-4 pt-8 border-t border-dark-800">
          <h2 className="text-xl font-semibold">What this is</h2>
          <p className="text-dark-400 leading-relaxed max-w-3xl">
            A portfolio of analytical primitives, each runnable against the same underlying graph. These widgets are
            the building blocks. The article arc that uses them is in <code className="font-mono text-dark-300">article-notes/SPINE.md</code>.
          </p>
        </section>

      </div>

      <CraneFooter />
    </main>
  );
}
