export const dynamic = "force-dynamic";

import CraneHeader from "@/components/CraneHeader";
import CraneFooter from "@/components/CraneFooter";
import ThreeLayerDiagram from "@/components/widgets/ThreeLayerDiagram";
import LexicalHierarchy from "@/components/widgets/LexicalHierarchy";
import LexicalGraphView from "@/components/widgets/LexicalGraphView";
import CypherQueryDemo from "@/components/widgets/CypherQueryDemo";
import PassageWalkthrough from "@/components/widgets/PassageWalkthrough";
import ReconciliationDiagram from "@/components/widgets/ReconciliationDiagram";
import YieldFunnel from "@/components/widgets/YieldFunnel";
import ExtractionDensity from "@/components/widgets/ExtractionDensity";
import MentionLongTail from "@/components/widgets/MentionLongTail";
import { loadSamplePassage, loadReconciliationData, loadCypherDemos } from "@/lib/post0-data";
import { loadCanonData } from "@/lib/canon-aggregate";

export default async function Post0Page() {
  const passage = loadSamplePassage();
  const reconciliation = loadReconciliationData();
  const cypherDemos = loadCypherDemos();
  const canon = loadCanonData();

  const totalSentences = canon.works.reduce((s, w) => s + w.sentenceCount, 0);
  const totalSections = canon.works.reduce((s, w) => s + w.sectionCount, 0);

  return (
    <main className="min-h-screen bg-dark-950 text-dark-100 flex flex-col">
      <CraneHeader crumbs={[{ label: "Post 0 · How the canon became data" }]} />

      <div className="max-w-5xl mx-auto px-8 py-16 space-y-24 w-full">

        {/* ── Hook ──────────────────────────────────────────────────────── */}
        <section className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-crimson-500">
            Post 0 · Methods
          </p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
            How the canon became data.
          </h1>
          <p className="text-dark-300 text-lg leading-relaxed max-w-3xl">
            Here&apos;s the dream. You open a Sherlock Holmes story to chapter four, you ask Dr Watson what he makes of the
            case so far, and you get an answer that&apos;s actually grounded in the page you&apos;re on. Not a paraphrase. Not
            a guess. Not <em>“based on similar passages in your training data…”</em>
          </p>
          <p className="text-dark-300 text-lg leading-relaxed max-w-3xl">
            The catch: that takes structure the books don&apos;t ship with. Doyle wrote prose, not data. He published 60-odd
            stories between 1887 and 1927, all sitting on Project Gutenberg as plain text. Turning that text into something
            a system can <em>reason</em> over — that&apos;s the job. This post is how we did it for the Holmes canon.
          </p>
          <div className="text-xs font-mono text-dark-500 pt-2">
            <span>“Data, data, data — I cannot make bricks without clay.”</span>
            <span className="ml-2 text-dark-600">— Holmes, <em>The Copper Beeches</em></span>
          </div>
        </section>

        {/* ── §1: Why the obvious answers don't work ────────────────────── */}
        <section className="space-y-4">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
            §1 · Why the obvious answers don&apos;t work
          </p>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Three things you might try first. None of them survive contact with the actual problem.
          </h2>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            <span className="text-dark-100 font-medium">Vector search.</span> Embed every paragraph, run cosine similarity at
            query time, hand the top-K chunks to an LLM and call it RAG. This is fine if the question is &ldquo;summarise
            the part where Holmes meets Moriarty.&rdquo; It falls apart the moment you ask something precise. <em>Where was
            Watson at chapter 7 of Hound?</em> The retriever has no idea what &ldquo;chapter 7&rdquo; means; the LLM cheerfully invents an answer.
          </p>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            <span className="text-dark-100 font-medium">Stuff the whole canon into a million-token context window.</span>
            Possible. Expensive. Still doesn&apos;t solve the precision problem — the model has the text, but no concept of
            position, ordering, or who could have known what at what point. Plus it doesn&apos;t scale: nice for one author, useless for a library.
          </p>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            <span className="text-dark-100 font-medium">Fine-tune a model on the canon.</span> Now you&apos;ve baked in every
            spoiler. There&apos;s no way to ask &ldquo;what does this character know <em>at chapter 4</em>&rdquo; — by training time, the
            model knows the ending of every story at once. Useful for Doyle pastiche, useless for in-story reasoning.
          </p>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            What&apos;s missing from all three is <span className="text-dark-100 font-medium">addressability</span>. You
            can&apos;t ask precise questions of a text the system can&apos;t point at. The fix is to build the address space
            first, then layer meaning on top. That&apos;s what the rest of this post is about.
          </p>
        </section>

        {/* ── §2: Three layers, one rule ────────────────────────────────── */}
        <section className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
            §2 · Three layers, one rule
          </p>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            The architecture is small enough to fit on a postcard.
          </h2>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            Three layers. Each has one job. Don&apos;t mix them. The lexical layer holds the text exactly as Doyle wrote it.
            The objective layer extracts the things and the happenings. The character-state layer is where perspective lives —
            and it&apos;s computed at query time, never stored.
          </p>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            There&apos;s one rule that holds the whole thing together, and it&apos;s in the diagram below.
          </p>
          <ThreeLayerDiagram />
        </section>

        {/* ── §3a: The lexical graph — shape and hierarchy ──────────────── */}
        <section className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
            §3 · The lexical graph
          </p>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            An address space made of sentences.
          </h2>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            The lexical layer is the substrate everything else points back to. It&apos;s a directed graph — not a list,
            not a vector index, not a tree. Sentences are the atomic nodes. Every one of them has a stable ID and a global
            position in its work. Above them sit sections, then works, then the author at the root.
          </p>
          <LexicalHierarchy
            workCount={canon.works.length}
            sectionCount={totalSections}
            sentenceCount={totalSentences}
          />
          <p className="text-dark-400 leading-relaxed max-w-3xl">
            The nesting is just the address space. Every layer above lexical cites at the sentence level —
            <code className="font-mono text-dark-300 mx-1">final-problem/section_1/sentence_3</code>
            is enough to find the exact line, in the exact section, of the exact story. That precision is what makes
            citation-grounded querying possible.
          </p>
        </section>

        {/* ── §3b: Why graph, not tree ─────────────────────────────────── */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            Why &ldquo;graph,&rdquo; not &ldquo;tree.&rdquo;
          </h2>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            A tree is just containment — parent to child, one way. What we&apos;ve actually got is a graph with multiple
            edge types: sentences chain to the next sentence in order, sentences belong to a section, and (once Layer 2
            runs) entities point back into every sentence they&apos;re named in. That last set of edges is what makes the
            substrate queryable in interesting ways. It&apos;s easier to show than describe.
          </p>
          {passage ? (
            <LexicalGraphView passage={passage} />
          ) : (
            <div className="rounded p-4 bg-dark-900/50 border border-dark-800 text-sm text-dark-400">
              Sample passage not available — run the ingest first.
            </div>
          )}
          <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
            The chain along the bottom is the lexical layer. The pills along the top are entities extracted by Layer 2.
            The dotted lines are mention edges — every entity points back into the sentences it&apos;s named in.
            Hover an entity to see only its citations.
          </p>
        </section>

        {/* ── §3c: What it actually lets you ask ────────────────────────── */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            What you can ask, in actual Cypher.
          </h2>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            With the address space in place, you can walk the graph. Position, entity, section — all queryable, all without
            invoking similarity. Four sample Cypher queries below. The queries are real; the results are computed in your
            browser from the same data that lives in Neo4j after migration.
          </p>
          <CypherQueryDemo demos={cypherDemos} />
          <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
            Nothing here calls an LLM. Nothing here is approximate. The graph stores the relationships, and you walk them.
          </p>
        </section>

        {/* ── §4: Layer 2 — extracting reality ──────────────────────────── */}
        <section className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
            §4 · Layer 2, extracting reality
          </p>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            One LLM call per section. Every fact cites a sentence.
          </h2>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            Lexical is deterministic. Layer 2 isn&apos;t — this is the layer where an LLM reads a section and produces
            structured output: the named entities, the events that happened, where things were, who saw what. Every event
            ships with a <code className="font-mono text-dark-200">source_nodes</code> array pointing back to the sentence
            IDs it was derived from. The graph is reversible: every claim can be traced back to text.
          </p>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            Same passage as before — Watson&apos;s opening to <em>The Final Problem</em> — now in three views. Tab one is
            the lexical substrate. Tab two is the extraction. Tab three is the reverse: pick any structured fact and watch
            the citing sentences light up.
          </p>
          {passage ? (
            <PassageWalkthrough passage={passage} />
          ) : (
            <div className="rounded p-4 bg-dark-900/50 border border-dark-800 text-sm text-dark-400">
              Sample passage not available — run the ingest first.
            </div>
          )}
          <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
            A validator polices what Layer 2 is allowed to contain. Cognitive predicates —
            <code className="font-mono text-dark-400 mx-1">BELIEVES</code>,
            <code className="font-mono text-dark-400 mx-1">KNOWS</code>,
            <code className="font-mono text-dark-400 mx-1">knownBy</code> — are barred. They belong in Layer 3, computed at
            query time. If the model emits one, the extraction is rejected and we re-prompt. The rule from §2 has teeth.
          </p>
        </section>

        {/* ── §5: What the pipeline produced ────────────────────────────── */}
        <section className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
            §5 · Yield
          </p>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            From 250,000 words to 6,000 events.
          </h2>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            The pipeline shrinks the corpus at every step. Words become sentences become entities become events.
            Each row below is the canon-wide total at that layer — and the small numbers near the bottom are still
            thousands of citation-grounded facts.
          </p>
          <YieldFunnel
            works={canon.works}
            frequency={canon.frequency}
            totalEntities={canon.entities.length}
            totalEvents={canon.works.reduce((s, w) => s + w.eventCount, 0)}
          />

          <h3 className="text-xl font-semibold tracking-tight pt-4">
            Not every work yields the same.
          </h3>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            Normalised by word count, the short stories are denser per page than the novels — more named things and more
            discrete events packed into less prose. The novels carry a structural quirk that shows up here: their flashback
            halves are entity-thin. Switch the metric to compare.
          </p>
          <ExtractionDensity works={canon.works} />

          <h3 className="text-xl font-semibold tracking-tight pt-4">
            A handful of names carry the canon.
          </h3>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            Plot every character on a log-log rank-frequency chart and you get the classic Zipfian curve. Holmes and Watson
            sit at the head; the recurring supporting cast (Lestrade, Mycroft, Mrs Hudson, Moriarty) clusters in the next
            half-decade. The tail is the canon&apos;s churn of one-shot clients and victims.
          </p>
          <MentionLongTail entities={canon.entities} />
        </section>

        {/* ── §6: Reconciliation ────────────────────────────────────────── */}
        <section className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
            §6 · Cleaning up across works
          </p>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            The same person, named seven ways. The same name, three people.
          </h2>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            Per-work extraction is local — the model sees one work at a time. So the same character gets extracted under
            different labels across works, and (uglier) different things sometimes share a label. Two failure modes, two
            opposite fixes: merge variants when they&apos;re the same thing; keep collisions distinct when they&apos;re not.
          </p>
          <ReconciliationDiagram data={reconciliation} />
          <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
            Cross-work dedupe runs after per-work extraction. The alias rules for major recurring characters are hand-curated;
            for the long tail (one-shot clients, witnesses), label similarity plus type-equality does the job.
          </p>
        </section>

        {/* ── §7: The honest cut ────────────────────────────────────────── */}
        <section className="space-y-6">
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-dark-500">
            §7 · What goes wrong
          </p>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            The honest cut.
          </h2>
          <p className="text-dark-300 leading-relaxed max-w-3xl">
            The pipeline works. It also breaks. Four named failure modes from this ingest. Not theoretical — these are in
            the data right now.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {FAILURE_MODES.map((f) => (
              <div key={f.title} className="rounded-lg border border-dark-800 bg-dark-900/50 p-5">
                <p className="text-xs font-mono uppercase tracking-[0.15em] text-crimson-400 mb-2">
                  {f.tag}
                </p>
                <h3 className="text-base font-semibold text-dark-100 mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-dark-300 leading-relaxed mb-3">
                  {f.body}
                </p>
                <p className="text-xs font-mono text-dark-500">
                  {f.example}
                </p>
              </div>
            ))}
          </div>
          <p className="text-dark-400 leading-relaxed max-w-3xl">
            The pipeline is good enough to demonstrate the architecture — and good enough to power the widgets above —
            but not yet good enough to make strong quantitative claims without a caveat. The next ingest will resolve
            most of this: entity reconciliation, event de-duplication, and case-outcome correction are the priority passes.
          </p>
        </section>

        {/* ── §8: What you can now ask ──────────────────────────────────── */}
        <section className="space-y-4 pt-8 border-t border-dark-800">
          <h2 className="text-xl font-semibold">What you can now ask</h2>
          <p className="text-dark-400 leading-relaxed max-w-3xl">
            Architecture pays off in queries that would have been impossible before. Three teasers that all live on{" "}
            <a href="/analysis" className="text-crimson-400 hover:text-crimson-300 underline underline-offset-2">
              the /analysis page
            </a>:
          </p>
          <ul className="space-y-2 text-dark-400 leading-relaxed max-w-3xl">
            <li>
              <span className="text-dark-100 font-medium">Position primitive.</span> Holmes is missing from half his own
              novels — <em>Valley of Fear</em> is 60% Holmesless, <em>A Study in Scarlet</em> 51%. The Presence Strip widget
              shows it instantly.
            </li>
            <li>
              <span className="text-dark-100 font-medium">Search primitive.</span> &ldquo;Elementary, my dear Watson&rdquo; appears
              zero times in the canon we have. The Citation Scoreboard proves it.
            </li>
            <li>
              <span className="text-dark-100 font-medium">Relation primitive.</span> Doyle wrote a star, not a network —
              almost every named character connects only through Holmes and Watson, never to each other. The Co-occurrence
              Network makes the topology obvious.
            </li>
          </ul>
        </section>

        {/* ── §9: Next ──────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Next: Sally, Anne, and the harder question</h2>
          <p className="text-dark-400 leading-relaxed max-w-3xl">
            Everything above is Layers 1 and 2 — facts about the world the books describe. The next post is about Layer 3:
            <em> what does this character know?</em> That&apos;s a different shape of problem, and the smallest possible test
            for it is the Sally-Anne false-belief task. Same architecture, much sharper question. More soon.
          </p>
        </section>

      </div>

      <CraneFooter />
    </main>
  );
}

const FAILURE_MODES: { tag: string; title: string; body: string; example: string }[] = [
  {
    tag: "Common nouns",
    title: "Pollution in the location list",
    body: "The extractor labels common nouns as locations when they appear in a spatial context. \"Hall\", \"corridor\", \"window\", \"mantelpiece\" — all extracted as named places. They need filtering or downweighting.",
    example: "→ 501 locations canon-wide; ~12% are common-noun false positives.",
  },
  {
    tag: "Within-work duplication",
    title: "Three Moriartys in The Final Problem",
    body: "The same character gets multiple entity IDs within a single work. Final Problem has professor_moriarty (the Professor), colonel_james_moriarty (his brother, correct), and a lowercase moriarty (a duplicate of the Professor).",
    example: "→ Per-work dedupe is needed before cross-work merge.",
  },
  {
    tag: "Event explosion",
    title: "Eight identical events in Silver Blaze",
    body: "The event \"Holmes says he must go to Dartmoor and King's Pyland\" is extracted eight times in a single section. The headline event count of 6,121 across the canon is inflated by 30–50%.",
    example: "→ Affects any frequency or density analysis until de-duplicated.",
  },
  {
    tag: "Status over-tagging",
    title: "Cases marked \"unresolved\" mid-investigation",
    body: "Of 114 cases extracted, 70 are tagged unresolved. The extractor marks the outcome from the first section the case appears in, regardless of whether it's resolved later. Case-outcome analysis is unreliable until the pass runs to completion.",
    example: "→ Only 13 of 114 cases currently tagged \"solved\".",
  },
];
