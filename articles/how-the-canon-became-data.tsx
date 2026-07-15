import ThreeLayerDiagram from "../components/widgets/ThreeLayerDiagram";
import LexicalHierarchy from "../components/widgets/LexicalHierarchy";
import LexicalGraphView from "../components/widgets/LexicalGraphView";
import CypherQueryDemo from "../components/widgets/CypherQueryDemo";
import PassageWalkthrough from "../components/widgets/PassageWalkthrough";
import ReconciliationDiagram from "../components/widgets/ReconciliationDiagram";
import YieldFunnel from "../components/widgets/YieldFunnel";
import ExtractionDensity from "../components/widgets/ExtractionDensity";
import PresenceStrip from "../components/widgets/PresenceStrip";
import CitationScoreboard from "../components/widgets/CitationScoreboard";
import CoOccurrenceNetwork from "../components/widgets/CoOccurrenceNetwork";
import TrajectoryTracker from "../components/widgets/TrajectoryTracker";
import IngestLoopDiagram from "../components/widgets/IngestLoopDiagram";
import KnowledgeGraphViewer from "../components/KnowledgeGraphViewer";
import {
  loadSamplePassage,
  loadReconciliationData,
  loadCypherDemos,
  loadCanonData,
  loadSampleClue,
  loadGraphViewerData,
} from "../lib/article-data";

// Shell-agnostic article body. The host app (crane-ai) supplies <Header/>,
// reading-tracker, and the <main> wrapper; this component owns everything
// inside the article. Data is read from committed static JSON at build time —
// no live Neo4j query is needed to render the article.
//
// NOTE: content is intentionally kept as outline-level bullets, not finished
// prose. Structure and facts first; voice pass comes later.
export default async function HowTheCanonBecameData() {
  const passage = loadSamplePassage();
  const reconciliation = loadReconciliationData();
  const cypherDemos = loadCypherDemos();
  const canon = loadCanonData();
  const clue = loadSampleClue();
  const graphData = loadGraphViewerData();

  const totalSentences = canon.works.reduce((s, w) => s + w.sentenceCount, 0);
  const totalSections = canon.works.reduce((s, w) => s + w.sectionCount, 0);
  const totalWords = canon.works.reduce((s, w) => s + w.wordCount, 0);
  const totalEvents = canon.works.reduce((s, w) => s + w.eventCount, 0);

  const byWordCount = [...canon.works].sort((a, b) => b.wordCount - a.wordCount);

  const famousQuoteCounts: Record<string, number> = {};
  for (const q of ["elementary, my dear watson", "the game is afoot", "you know my methods"]) {
    const needle = q.toLowerCase();
    famousQuoteCounts[q] = canon.sentences.reduce(
      (n, s) => n + (s.text.toLowerCase().includes(needle) ? 1 : 0),
      0
    );
  }

  const bullet = "text-dark-200 leading-relaxed max-w-3xl list-disc pl-5 space-y-2";

  return (
    <article className="space-y-24">

      {/* ── Hook ──────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <p className="mono text-xs uppercase tracking-[0.2em] text-crimson-400">
          Post 0 · Methods
        </p>
        <h1 className="text-4xl sm:text-5xl font-semibold leading-tight">
          The Game is aFoot
          <span className="block text-xl sm:text-2xl font-normal text-dark-400 mt-2">
            Ingesting the adventures of Sherlock Holmes
          </span>
        </h1>
        <ul className={bullet}>
          <li>Star Trek: Data runs a holodeck program as Sherlock Holmes, interacting with characters inside the stories.</li>
          <li>Question: is that buildable now? Step into 221B Baker Street, work a case with Holmes.</li>
          <li>An LLM has read the Doyle canon. Not the same as being reliable about it — it answers fluently, and guesses when it doesn&apos;t know.</li>
          <li>Before that&apos;s possible, need a system that can point at the text, not paraphrase it. This post: building that substrate.</li>
        </ul>
        <blockquote className="border-l-2 border-crimson-400 pl-4 pt-2">
          <span className="block text-lg sm:text-xl italic text-dark-100 leading-snug">
            “Data, data, data — I cannot make bricks without clay.”
          </span>
          <span className="mono text-xs text-dark-400 mt-2 block">
            — Holmes, <em>The Copper Beeches</em>
          </span>
        </blockquote>
      </section>

      {/* ── 1: Why the obvious answers don't work ────────────────────── */}
      <section className="space-y-4">
        <p className="mono text-xs uppercase tracking-[0.2em] text-dark-400">
          1 · Why the obvious answers don&apos;t work
        </p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Getting the clay: ingest the whole canon
        </h2>
        <ul className={bullet}>
          <li>Public domain, Project Gutenberg: {totalWords.toLocaleString()} words across {canon.works.length} works.</li>
        </ul>
        <div className="space-y-1.5 max-w-3xl">
          {byWordCount.map((w) => {
            const widthPct = (w.wordCount / byWordCount[0].wordCount) * 100;
            return (
              <div key={w.slug} className="flex items-center gap-3">
                <div className="w-40 text-xs truncate text-dark-200" title={w.name}>
                  <em>{w.name}</em>
                </div>
                <div className="flex-1 h-5 bg-dark-950/60 rounded border border-dark-800 relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-crimson-500/70"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <div className="w-16 text-xs text-dark-400 text-right tabular-nums mono">
                  {(w.wordCount / 1000).toFixed(0)}k
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
          Four novels, thirteen short stories. The novels are five to eight times the length of a story — a split
          that shows up again later in extraction density.
        </p>
        <h3 className="text-lg font-semibold text-dark-100 pt-2">Three possible approaches:</h3>
        <div className="space-y-4 max-w-3xl">
          {[
            {
              n: "01",
              title: "Full canon in a long context window.",
              body: "Expensive. Still no positional grounding. Doesn\u2019t scale past one author.",
            },
            {
              n: "02",
              title: "Vector search.",
              body: "Embed paragraphs, cosine similarity at query time. Works for vague asks (\u201csummarise the Moriarty meeting\u201d). Fails on precise ones \u2014 \u201cwhere was Watson at paragraph 7 of Hound?\u201d No concept of position or perspective.",
            },
            {
              n: "03",
              title: "Fine-tune on the canon.",
              body: "Bakes in every spoiler. Can\u2019t ask \u201cwhat does this character know at paragraph 4\u201d \u2014 model knows every ending at training time.",
            },
          ].map((item) => (
            <div key={item.n} className="flex gap-4 items-start">
              <span className="mono text-xl sm:text-2xl font-bold text-crimson-400/40 leading-none tabular-nums">
                {item.n}
              </span>
              <p className="text-dark-200 leading-relaxed pt-1">
                <span className="text-dark-100 font-medium">{item.title}</span> {item.body}
              </p>
            </div>
          ))}
        </div>
        <p className="text-dark-200 leading-relaxed max-w-3xl">
          Missing in all three: <span className="text-dark-100 font-medium">addressability</span>. Fix: build the address space first, layer meaning on top after.
        </p>
      </section>

      {/* ── 2: Three layers, one rule ────────────────────────────────── */}
      <section className="space-y-6">
        <p className="mono text-xs uppercase tracking-[0.2em] text-dark-400">
          2 · Three layers, one rule
        </p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Architecture
        </h2>
        <ul className={bullet}>
          <li>Lexical → objective → character state. Each layer one job, not mixed.</li>
          <li>Lexical: text exactly as Doyle wrote it.</li>
          <li>Objective: extracted things and happenings.</li>
          <li>Character state: perspective, computed at query time, never stored.</li>
          <li>The rule: <span className="text-dark-100 font-medium">the graph stores reality, not knowledge.</span> Belief exists only in the character-state layer.</li>
        </ul>
        <ThreeLayerDiagram />

      </section>

      {/* ── 3a: The lexical graph — shape and hierarchy ──────────────── */}
      <section className="space-y-6">
        <p className="mono text-xs uppercase tracking-[0.2em] text-dark-400">
          3 · The lexical graph
        </p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Address space made of sentences
        </h2>
        <h3 className="text-lg font-semibold text-dark-100 pt-2">Generally</h3>
        <ul className={bullet}>
          <li>A lexical graph represents text as nodes and edges instead of a flat string or a bag of embeddings.</li>
          <li>Nodes are lexical units — words, sentences, paragraphs. Edges encode relationships between them: sequence (what comes next), containment (what paragraph a unit belongs to), reference (what a unit is about, once something points back at it).</li>
          <li>The payoff: once text is a graph, you traverse it — step to the next node, step up to a parent, step across a reference edge — instead of embedding it and measuring distance.</li>
        </ul>
        <h3 className="text-lg font-semibold text-dark-100 pt-4">Here</h3>
        <ul className={bullet}>
          <li>Directed graph: three edge types on one set of nodes — positional (sentence → next sentence), containment (sentence → paragraph), and, after entity extraction runs, mention (entity → sentence).</li>
          <li>Sentences = atomic nodes. Stable ID + global position.</li>
          <li>Above sentences: paragraphs, then works, then author at root.</li>
        </ul>
        <LexicalHierarchy
          workCount={canon.works.length}
          sectionCount={totalSections}
          sentenceCount={totalSentences}
        />
        <p className="text-dark-300 leading-relaxed max-w-3xl">
          Nesting = address space. Every layer above cites at sentence level —
          <code className="mono text-dark-200 mx-1">final-problem/section_1/sentence_3</code>
          finds the exact line. That precision is what makes citation-grounded querying possible.
        </p>
      </section>

      {/* ── 3b: The payoff of addressability ──────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          Now every sentence is an address, entities can tag onto it
        </h2>
        <ul className={bullet}>
          <li>Every sentence already has a stable ID and position. Entity extraction tags entities onto that same namespace — a mention attaches to a sentence ID, not to a raw character offset in a blob of text.</li>
          <li>Once entities are addressable coordinates rather than plain strings, two sentences that share an entity are connected — even if they come from two entirely different documents, ingested independently of each other.</li>
          <li>Arbitrarily extendable: ingest a new document, tag its entities, it joins the same traversable map. No re-indexing the existing corpus, no retraining anything.</li>
        </ul>
        {passage ? (
          <LexicalGraphView passage={passage} />
        ) : (
          <div className="rounded p-4 bg-dark-900/50 border border-dark-800 text-sm text-dark-400">
            Sample passage not available — run the ingest first.
          </div>
        )}
        <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
          Bottom chain: lexical layer. Top pills: extracted entities. Dotted lines: mention edges,
          entity back into sentence. Hover an entity to isolate its citations.
        </p>
        <h3 className="text-lg font-semibold text-dark-100 pt-2">Where this shows up outside fiction</h3>
        <ul className={bullet}>
          <li>Legal / e-discovery: tie every clause mentioning a counterparty or term across thousands of unrelated contracts, traversed instead of keyword-matched.</li>
          <li>Financial research: link an earnings-call sentence to the 10-K sentence it corroborates or contradicts, across otherwise unconnected filings.</li>
          <li>Clinical records: a patient&apos;s medications and conditions addressable per note, per visit, per provider — one traversable timeline even when the notes come from different systems.</li>
          <li>Investigative journalism: the same name surfacing across thousands of independently-leaked documents, followed as graph edges instead of re-run keyword searches.</li>
        </ul>
      </section>

      {/* ── 3c: What it actually lets you ask ────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          We can now query the text
        </h2>
        <ul className={bullet}>
          <li>By position, by entity, by paragraph.</li>
          <li>Four sample queries below.</li>
        </ul>
        <CypherQueryDemo demos={cypherDemos} />
      </section>

      {/* ── 4: Entity extraction ──────────────────────────────────────── */}
      <section className="space-y-6">
        <p className="mono text-xs uppercase tracking-[0.2em] text-dark-400">
          4 · Entity extraction
        </p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          From free text to structured facts
        </h2>
        <h3 className="text-lg font-semibold text-dark-100 pt-2">Generally</h3>
        <ul className={bullet}>
          <li>Entity extraction (also called information extraction: NER plus relation/event extraction) turns unstructured text into structured records — named things, and the relationships or events connecting them.</li>
          <li>Standard NLP technique, applied everywhere text hides structure: resumes into candidate profiles, invoices into line items, contracts into parties and clauses.</li>
          <li>The generalisable part: once entities are pulled out, they become join keys — between text and a database row, between text and another document, between text and a graph.</li>
        </ul>
        <h3 className="text-lg font-semibold text-dark-100 pt-4">Here</h3>
        <ul className={bullet}>
          <li>Lexical is deterministic. Entity extraction isn&apos;t: one LLM call per paragraph, output entities, events, state, who-saw-what.</li>
          <li>Every event carries <code className="mono text-dark-200">source_nodes</code> — the sentence IDs it came from. Reversible: every claim traces back to text.</li>
          <li>Two things make this stricter than typical NER: state changes are anchored to the event that caused them, not a timestamp; and speech is captured as an event, not a belief.</li>
          <li>The loop is resumable: every paragraph checkpoints to disk, so a crash mid-canon resumes instead of restarting. Rejected extractions re-prompt.</li>
          <li>Ingest model: <code className="mono text-dark-200">claude-sonnet-4-6</code>. One call per paragraph — {totalSections.toLocaleString()} calls for the full corpus. Cost figures: pending a clean re-ingest with token capture.</li>
        </ul>
        <IngestLoopDiagram />
        <h3 className="text-lg font-semibold text-dark-100 pt-4">Watch the graph assemble</h3>
        <ul className={bullet}>
          <li>The full extraction for <em>The Final Problem</em>, in the project&apos;s graph viewer. Scrub the timeline: entities and events appear as the story reaches them, edges form between participants.</li>
          <li>State changes are anchored to the event that caused them, not a timestamp — an object can move locations over the story without contradiction.</li>
          <li>Speech is captured as a <code className="mono text-dark-200">COMMUNICATES</code> event: the act of saying is objective fact, whether the content is true is a separate question. That separation is what lets the character-state layer derive false beliefs later without ever storing one.</li>
          <li>The perspective dropdown is a preview of the character-state layer: pick a character and the graph narrows to what they witnessed or were told.</li>
        </ul>
        {graphData ? (
          <div className="rounded-xl border border-dark-800 overflow-hidden h-[560px]">
            <KnowledgeGraphViewer
              slug={graphData.slug}
              lexical={graphData.lexical}
              objective={graphData.objective}
              embedded
              autoPlay
            />
          </div>
        ) : (
          <div className="rounded p-4 bg-dark-900/50 border border-dark-800 text-sm text-dark-400">
            Graph data not available — run the ingest first.
          </div>
        )}
        {clue && (
          <div className="rounded-lg border border-dark-800 bg-dark-900/50 p-5 space-y-3">
            <p className="mono text-xs uppercase tracking-[0.15em] text-crimson-400">
              Clues: deduction as data
            </p>
            <ul className={bullet}>
              <li>The extractor also captures clues — an object, the case it belongs to, who read it, and what they inferred. The inference is attributed to a character, not asserted as world-fact: a preview of the character-state layer.</li>
              <li>The first clue in the data is the canon&apos;s most famous deduction — Holmes reading the visitor&apos;s walking stick in the opening scene of <em>Hound</em>:</li>
            </ul>
            <div className="rounded bg-dark-950/60 p-4 space-y-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1 mono text-xs">
                <span className="text-dark-500">object <span className="text-dark-200 ml-1">{clue.objectLabel}</span></span>
                <span className="text-dark-500">case <span className="text-dark-200 ml-1">{clue.caseLabel}</span></span>
                <span className="text-dark-500">discovered_by <span className="text-dark-200 ml-1">{clue.discoveredByLabel}</span></span>
              </div>
              <p className="text-sm text-dark-200 leading-relaxed">
                <span className="mono text-xs text-dark-500 mr-2">significance</span>
                {clue.significance}
              </p>
              <div className="space-y-1 border-t border-dark-800 pt-3">
                {clue.sentences.map((s) => (
                  <p key={s.id} className="text-xs text-dark-400 leading-relaxed">
                    <span className="mono text-dark-600 mr-2">{s.id}</span>
                    {s.text}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
        <h3 className="text-lg font-semibold text-dark-100 pt-2">Where this shows up outside fiction</h3>
        <ul className={bullet}>
          <li>Invoice / PO processing: vendor, line items, and amounts pulled from a scanned document into a structured record, each field still pointing back at the source line.</li>
          <li>Clinical coding: diagnoses and medications extracted from free-text notes into billing codes, traceable back to the note that justified them.</li>
          <li>KYC / compliance screening: names and entities pulled from filings and correspondence, checked against watchlists as structured records rather than re-read prose.</li>
        </ul>
        <p className="text-dark-200 leading-relaxed max-w-3xl">
          Same passage as before, three views: lexical substrate, extraction, reverse citation (pick a fact, watch the citing sentences light up).
        </p>
        {passage ? (
          <PassageWalkthrough passage={passage} />
        ) : (
          <div className="rounded p-4 bg-dark-900/50 border border-dark-800 text-sm text-dark-400">
            Sample passage not available — run the ingest first.
          </div>
        )}

      </section>

      {/* ── 5: What the pipeline produced ────────────────────────────── */}
      <section className="space-y-6">
        <p className="mono text-xs uppercase tracking-[0.2em] text-dark-400">
          5 · Yield
        </p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          {Math.round(totalWords / 1000).toLocaleString()},000 words → {Math.round(totalEvents / 1000).toLocaleString()},000 events
        </h2>
        <ul className={bullet}>
          <li>Shrinks at every step: words → sentences → entities → events.</li>
          <li>Each row below: canon-wide total at that layer.</li>
        </ul>
        <YieldFunnel
          works={canon.works}
          frequency={canon.frequency}
          totalEntities={canon.entities.length}
          totalEvents={totalEvents}
        />

        <h3 className="text-xl font-semibold tracking-tight pt-4">
          Yield varies by work
        </h3>
        <ul className={bullet}>
          <li>Normalised by word count: short stories denser per page than novels.</li>
          <li>Novels: flashback halves are entity-thin.</li>
        </ul>
        <ExtractionDensity works={canon.works} />
      </section>

      {/* ── 6: Reconciliation ────────────────────────────────────────── */}
      <section className="space-y-6">
        <p className="mono text-xs uppercase tracking-[0.2em] text-dark-400">
          6 · Cleaning up across works
        </p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Same person, different labels. Same label, different things.
        </h2>
        <ul className={bullet}>
          <li>Per-work extraction is local — model sees one work at a time.</li>
          <li>Two failure modes, two opposite fixes: merge variants (alias map) when same thing; keep distinct (type-aware dedupe) when not.</li>
          <li>Collision example: three Hudsons. Mrs Hudson (housekeeper), Hudson (seaman, <em>Gloria Scott</em>), Hudson Street (location, <em>The Crooked Man</em>). Same surname, not the same entity — one isn&apos;t even a person.</li>
        </ul>
        <ReconciliationDiagram data={reconciliation} />
        <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
          Cross-work dedupe runs after per-work extraction. Alias rules for major recurring characters: hand-curated.
          Long tail (one-shot clients, witnesses): label similarity plus type-equality.
        </p>
      </section>

      {/* ── 7: What you can now ask ──────────────────────────────────── */}
      <section className="space-y-6">
        <p className="mono text-xs uppercase tracking-[0.2em] text-dark-400">
          7 · What you can now ask
        </p>
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Queries impossible without the address space
        </h2>
        <p className="text-dark-200 leading-relaxed max-w-3xl">
          Four, live against the same canon-wide data used above. Full portfolio — five primitives, including
          aggregate — on <code className="mono text-dark-300">/analysis</code>.
        </p>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-dark-100">Time: where was Watson, when?</h3>
          <ul className={bullet}>
            <li>The exact question that broke vector search in section 1. Now answerable: each strip is one character&apos;s location over story time, built from <code className="mono text-dark-300">LOCATED_AT</code> state edges and their validity windows.</li>
            <li>Pick a work, add characters, read off who was where as the story unfolds.</li>
          </ul>
        </div>
        <TrajectoryTracker trajectories={canon.trajectories} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-dark-100">Position: is Holmes even in his own novels?</h3>
          <ul className={bullet}>
            <li>Each mark: one sentence naming the selected character, positioned across the work.</li>
            <li>Holmes, in <em>A Study in Scarlet</em> or <em>The Valley of Fear</em>: long stretch with no marks — flashback paragraphs narrated with Holmes off-page.</li>
          </ul>
        </div>
        <PresenceStrip works={canon.works} entities={canon.entities} presence={canon.presence} />

        <div className="space-y-3 pt-4">
          <h3 className="text-lg font-semibold text-dark-100">Search: did Holmes ever say that?</h3>
          <ul className={bullet}>
            <li>Case-insensitive substring scan, every sentence in the canon.</li>
            <li>&ldquo;The game is afoot&rdquo;: genuine. &ldquo;Elementary, my dear Watson&rdquo;: zero hits.</li>
          </ul>
        </div>
        <CitationScoreboard famousQuoteCounts={famousQuoteCounts} totalSentences={totalSentences} />

        <div className="space-y-3 pt-4">
          <h3 className="text-lg font-semibold text-dark-100">Relation: social shape of the canon</h3>
          <ul className={bullet}>
            <li>Edge between two characters: shared a paragraph somewhere in the canon. Weight: how often.</li>
            <li>Holmes and Watson at the centre. Almost everyone else connects through one of them — a star, not a network.</li>
          </ul>
        </div>
        <CoOccurrenceNetwork entities={canon.entities} edges={canon.coOccurrence} />
      </section>

      {/* ── 9: Next ──────────────────────────────────────────────────── */}
      <section className="space-y-4 pt-8 border-t border-dark-800">
        <h2 className="text-xl font-semibold">Next: the harder question</h2>
        <ul className={bullet}>
          <li>Above: the lexical graph and entity extraction. Facts about the world, and primitives to query them.</li>
          <li>Next post: the character-state layer. What does this character know, at this point in the story?</li>
          <li>Same architecture, sharper question.</li>
        </ul>
      </section>

    </article>
  );
}

