import ThreeLayerDiagram from "../components/widgets/ThreeLayerDiagram";
import LexicalHierarchy from "../components/widgets/LexicalHierarchy";
import LexicalGraphView from "../components/widgets/LexicalGraphView";
import SqlQueryDemo from "../components/widgets/SqlQueryDemo";
import PassageWalkthrough from "../components/widgets/PassageWalkthrough";
import ReconciliationDiagram from "../components/widgets/ReconciliationDiagram";
import YieldFunnel from "../components/widgets/YieldFunnel";
import ExtractionDensity from "../components/widgets/ExtractionDensity";
import PresenceStripLazy from "../components/widgets/PresenceStripLazy";
import CitationScoreboard from "../components/widgets/CitationScoreboard";
import CoOccurrenceNetwork from "../components/widgets/CoOccurrenceNetwork";
import TrajectoryTracker from "../components/widgets/TrajectoryTracker";
import IngestLoopDiagram from "../components/widgets/IngestLoopDiagram";
import EmbeddedGraphViewer from "../components/widgets/EmbeddedGraphViewer";
import {
  loadSamplePassage,
  loadReconciliationData,
  loadSqlDemos,
  loadCanonData,
} from "../lib/article-data";
import Link from "next/link";

// Numbered section eyebrow — mirrors the ghosted-numeral style of the
// approach cards in section 1 so the numbering reads as one system.
function SectionMark({ n, label }: { n: string; label: string }) {
  return (
    <p className="flex items-baseline gap-2.5 max-w-3xl">
      <span className="mono text-lg font-bold text-crimson-400/40 leading-none tabular-nums">
        {n}
      </span>
      <span className="mono text-xs uppercase tracking-[0.2em] text-dark-400">{label}</span>
    </p>
  );
}

// Shell-agnostic article body. The host app (crane-ai) supplies <Header/>,
// reading-tracker, and the <main> wrapper; this component owns everything
// inside the article. Data is read from committed static JSON at build time,
// so no live database query is needed to render the article.
export default async function TheGameIsAfoot({
  // Where the full graph tool lives. Defaults to the article's published home
  // on crane-ai; sherlock's own dev app serves it at /graph and passes that.
  graphHref = "/project/sherlock/graph",
}: {
  graphHref?: string;
} = {}) {
  const passage = loadSamplePassage();
  const reconciliation = loadReconciliationData();
  const sqlDemos = loadSqlDemos();
  const canon = loadCanonData();

  // Only the characters the network actually draws — the full 1,954-entity
  // list is ~230 KB serialised and would ride in the RSC payload.
  const coKeys = new Set(canon.coOccurrence.flatMap((e) => [e.a, e.b]));
  const networkEntities = canon.entities.filter(
    (e) => e.type === "character" && coKeys.has(e.key)
  );

  const totalSentences = canon.works.reduce((s, w) => s + w.sentenceCount, 0);
  const totalSections = canon.works.reduce((s, w) => s + w.sectionCount, 0);
  const totalWords = canon.works.reduce((s, w) => s + w.wordCount, 0);
  const totalEvents = canon.works.reduce((s, w) => s + w.eventCount, 0);

  const byWordCount = [...canon.works].sort((a, b) => b.wordCount - a.wordCount);

  const novelSlugs = new Set([
    "a-study-in-scarlet",
    "sign-of-the-four",
    "hound-of-the-baskervilles",
    "valley-of-fear",
  ]);

  const famousQuoteCounts: Record<string, number> = {};
  for (const q of ["elementary, my dear watson", "the game is afoot", "you know my methods"]) {
    const needle = q.toLowerCase();
    famousQuoteCounts[q] = canon.sentences.reduce(
      (n, s) => n + (s.text.toLowerCase().includes(needle) ? 1 : 0),
      0
    );
  }

  const prose = "text-dark-200 leading-relaxed max-w-3xl";
  const bullet = "text-dark-200 leading-relaxed max-w-3xl list-disc pl-5 space-y-2";

  return (
    <article className="space-y-24">

      {/* ── Hook ──────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <p className="mono text-xs uppercase tracking-[0.2em] text-crimson-400">
          Methods
        </p>
        <h1 className="text-4xl sm:text-5xl font-semibold leading-tight">
          The Game is aFoot
          <span className="block text-xl sm:text-2xl font-normal text-dark-400 mt-2">
            Ingesting the adventures of Sherlock Holmes
          </span>
        </h1>
        <p className={prose}>
          There is an episode of <em>Star Trek: The Next Generation</em> in which Data, the
          android, spends his off-duty hours on the holodeck playing Sherlock Holmes. The
          ship&apos;s computer has read the whole canon and rebuilds Victorian London around
          him. It is a lovely piece of science fiction, and it raises a question worth taking
          seriously. Could you build that now? Could you step into 221B Baker Street and work
          a case alongside Holmes?
        </p>
        <p className={prose}>
          The tempting answer is that large language models will have already read the works
          of Arthur Conan Doyle, and if you were to ask one about the canon it would answer
          fluently. Fluency, though, is not the same as reliability. The same model that
          quotes <em>The Final Problem</em> will also invent, with identical confidence, a
          scene that never happened, because it has read the stories but cannot point at them.
        </p>
        <p className={prose}>
          Before anything like the holodeck is possible, we need a system where every claim
          traces back to the sentence that supports it. This post is about building that
          substrate.
        </p>
        <blockquote className="border-l-2 border-crimson-400 pl-4 pt-2">
          <span className="block text-lg sm:text-xl italic text-dark-100 leading-snug">
            &ldquo;Data! Data! Data! I can&apos;t make bricks without clay.&rdquo;
          </span>
          <span className="mono text-xs text-dark-400 mt-2 block">
            Holmes, <em>The Copper Beeches</em>
          </span>
        </blockquote>
      </section>

      {/* ── 1: The corpus, and three ways to hold it ─────────────────── */}
      <section className="space-y-4">
        <SectionMark n="01" label="Getting the clay" />
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Ingesting the whole canon
        </h2>
        <p className={prose}>
          The raw material, at least, is easy to come by. The Holmes stories are in the
          public domain, and Project Gutenberg hosts clean transcriptions of all of them.
          Our corpus is {totalWords.toLocaleString()} words across {canon.works.length} works.
        </p>
        <div className="flex items-center gap-4 mono text-xs text-dark-400 max-w-3xl">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-crimson-500/70" />
            novel
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-dark-500/50" />
            short story
          </span>
        </div>
        <div className="space-y-1.5 max-w-3xl">
          {byWordCount.map((w) => {
            const widthPct = (w.wordCount / byWordCount[0].wordCount) * 100;
            const isNovel = novelSlugs.has(w.slug);
            return (
              <div key={w.slug} className="flex items-center gap-3">
                <div className="w-40 text-xs truncate text-dark-200" title={w.name}>
                  <em>{w.name}</em>
                </div>
                <div className="flex-1 h-5 bg-dark-950/60 rounded border border-dark-800 relative overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 ${isNovel ? "bg-crimson-500/70" : "bg-dark-500/50"}`}
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
          Four novels and thirteen short stories. A novel runs five to eight times the length
          of a story, a split that resurfaces later when we measure extraction density.
        </p>
        <p className={`${prose} pt-2`}>
          The harder question is what to do with all that text. There are three obvious ways
          to hand a corpus to a language model, but none of them fit our needs.
        </p>
        <div className="space-y-4 max-w-3xl">
          {[
            {
              n: "01",
              title: "Put the whole canon in a long context window.",
              body: "With a million-token context window you could just hand the whole thing to the model and let it figure out what to do with it. But research on the “lost in the middle” effect shows models retrieve facts near the start or end of a context far more reliably than facts buried in the middle. We would also pay to re-read the entire corpus every request.",
            },
            {
              n: "02",
              title: "Vector search.",
                body: "Embed every paragraph and retrieve by similarity at query time. This is the workhorse of most retrieval-augmented generation, and it is good at open-ended questions like “summarise the meeting with Moriarty”. Asking where Watson is at paragraph seven of A Study in Scarlet and a similarity based retrieval mechanism cant determine that that he hasn't met sherlock holmes yet. it lacks a grounding in facts",
            },
            {
              n: "03",
              title: "Fine-tune on the canon.",
              body: "Train the model on the stories directly. Now the knowledge lives in the weights, along with every spoiler. There is no way to ask what a character knows at paragraph four, because the model learned the ending at training time and cannot unknow it.",
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
        <p className={prose}>
          What all three are missing is{" "}
          <span className="text-dark-100 font-medium">addressability</span>, a way to refer to
          a specific sentence in a specific position and build on top of that reference. So
          the plan became to build the address space first and layer meaning on top of it
          afterwards.
        </p>
      </section>

      {/* ── 2: Architecture ──────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionMark n="02" label="Architecture" />
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          A three-layer approach
        </h2>
        <p className={prose}>
          The system is arranged as three layers, and keeping their jobs separate turns out to
          matter more than anything else in the design.
        </p>
        <ThreeLayerDiagram />
        <p className={prose}>
          The <span className="text-dark-100 font-medium">lexical graph layer</span> holds the
          text exactly as Conan Doyle wrote it, with a stable identifier for every sentence.
          It is the ground truth that everything above it points back to.
        </p>
        <p className={prose}>
          The <span className="text-dark-100 font-medium">entity extraction layer</span> holds what
          the text describes: the people, places and objects of the stories, and the relationships between them.
        </p>
        <p className={prose}>
          The <span className="text-dark-100 font-medium">character-state layer</span> holds
          perspective. What does Watson know at this point in the story? Who has heard about
          the note, and who is still in the dark? Crucially, this layer is computed at query
          time from the layer beneath it. The graph itself records only what happened. What a
          character believes about what happened is derived on demand, which is what will later
          let us model characters who are mistaken, deceived, or simply out of the room.
        </p>
      </section>

      {/* ── 3a: The lexical graph ────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionMark n="03" label="The lexical graph" />
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          An address space made of sentences
        </h2>
        <p className={prose}>
          A lexical graph represents text as nodes and edges, breaking it up into a
          hierarchical tree structure that can be traversed. In our graph, sentences are the
          atomic nodes. Each carries a stable ID and its global position in the corpus. Above
          the sentences sit paragraphs, above those the books, and at the root, the author.
        </p>
        <p className="text-dark-300 leading-relaxed max-w-3xl">
          This nesting gives every sentence its own address. A path like{" "}
          <code className="mono text-dark-200">final-problem/section_1/sentence_3</code>{" "}
          points to one exact line of the canon, and everything built in the layers above
          cites these addresses.
        </p>
        <LexicalHierarchy
          workCount={canon.works.length}
          sectionCount={totalSections}
          sentenceCount={totalSentences}
        />
 
        <h2 className="text-2xl font-semibold tracking-tight">
          Once every sentence has an address, entities can attach to it
        </h2>
        <p className={prose}>
          Every sentence now has a stable ID and a position in the full collective works, which
          gives entity extraction something solid to reference. We can tag that Holmes finds an item
          in one paragraph and the same item is discarded in a later paragraph.  
          When an entity is found, it attaches to a sentence ID, even when they come
          from entirely different documents ingested months apart. The map extends
          indefinitely, It joins the same traversable structure with no re-indexing of the existing corpus and
          no retraining of anything.
        </p>
        {passage ? (
          <LexicalGraphView passage={passage} />
        ) : (
          <div className="rounded p-4 bg-dark-900/50 border border-dark-800 text-sm text-dark-400">
            Sample passage not available. Run the ingest first.
          </div>
        )}
        <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
          The chain along the bottom is the lexical layer. The pills above it are extracted
          entities, and the dotted lines are mention edges tying each entity back into a
          sentence. Hover an entity to isolate its citations.
        </p>
        <h3 className="text-lg font-semibold text-dark-100 pt-2">
          Where this shows up outside fiction
        </h3>
        <p className={prose}>
          The pattern generalises well beyond a detective canon.
        </p>
        <ul className={bullet}>
          <li>
            In legal discovery, every clause that mentions a counterparty or a defined term
            becomes traversable across thousands of otherwise unrelated contracts.
          </li>
          <li>
            In financial research, a sentence from an earnings call can link to the line in
            the annual report it corroborates or contradicts, across filings that share
            nothing else.
          </li>
          <li>
            In clinical records, a patient&apos;s medications and conditions become addressable
            per note, per visit and per provider, forming one timeline even when the notes come
            from different systems.
          </li>
          <li>
            In recruitment, a line in a candidate&apos;s CV claiming a skill can link to the sentence in a
            reference letter or interview note that backs it up or contradicts it, across
            documents that were never written to align with each other.
          </li>
        </ul>
      </section>

      {/* ── 3c: What it lets you ask ─────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          Querying the text directly
        </h2>
        <p className={prose}>
          With the lexical graph in place, the canon becomes something you can query by
          position, by entity, or by paragraph. Here are four examples, each running against
          the ingested data.
        </p>
        <SqlQueryDemo demos={sqlDemos} />
      </section>

      {/* ── 4: Entity extraction ─────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionMark n="04" label="Entity extraction" />
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          From free text to structured facts
        </h2>
        <p className={prose}>
          Now that we have an addressable namespace, we can run each paragraph through an
          entity extraction pipeline: an LLM reads the text and returns the entities present,
          the events that occur, any state changes, and who witnessed what. Extraction targets
          a fixed list of entity types we model {" "}
          <span className="text-dark-100 font-medium">character</span>,{" "}
          <span className="text-dark-100 font-medium">location</span>,{" "}
          <span className="text-dark-100 font-medium">object</span>,{" "}
          <span className="text-dark-100 font-medium">case</span>,{" "}
          <span className="text-dark-100 font-medium">document</span>, and{" "}
          <span className="text-dark-100 font-medium mr-1">organisation</span>   rather than
          open-ended tagging. It&apos;s the same technique that turns a CV into a candidate
          profile or an invoice into line items, used here to turn Victorian prose into database join keys  that connect text to a graph.
        </p>
        <p className={prose}>
          This is also where determinism ends. Splitting sentences involved no judgement, but
          extraction relies on the model&apos;s reading, so every event it returns carries{" "}
          <code className="mono text-dark-200">source_nodes</code>, the sentence IDs it was
          drawn from, keeping every claim in the graph traceable back to the text that supports
          it.
        </p>
        <p className={prose}>
          Two choices make this stricter than typical entity recognition. First, state changes
          are anchored to the event that caused them, not to a timestamp. Every state edge
          stores <code className="mono text-dark-200">valid_from</code> as the ID of the event
          that started it, and the model never has to say when it ends. Instead, the next
          event that moves the same entity closes the previous edge automatically, so an object
          can pass through several containers over the course of a story and each move stays
          correctly ordered relative to the others, with no wall-clock time required. Second,
          speech is captured as an event in its own right, since the fact that a character said
          something is objective, while whether what they said is true is a separate question,
          held for the layer above.
        </p>
        <IngestLoopDiagram />
        <p className={prose}>
          Model choice was a chunk-size problem as much as a quality one. On{" "}
          <em>A Case of Identity</em> (5,000 words) as a test bed,{" "}
          <code className="mono text-dark-200">gpt-5-nano</code> at 600-word chunks gave 311
          events but 8 duplicate cases; <code className="mono text-dark-200">gpt-5-mini</code>{" "}
          at the same size cut that to 132 events and 3 duplicates, and 3,000-word chunks
          dropped duplicates to 2 at the cost of recall (88 events). Weaker models want smaller
                  chunks; stronger ones can take bigger chunks and resolve coreference themselves. <code className="mono text-dark-200">gpt-5-mini</code>
          at 600 words won on balance and ran the full canon:{" "}
          {totalSections.toLocaleString()} calls over {totalWords.toLocaleString()} words, at
          <code className="mono text-dark-200">gpt-5-mini</code>&apos;s $0.25 / $2.00 per million
          input/output tokens, putting the full ingest at somewhere around $1–2.
        </p>
        <h3 className="text-lg font-semibold text-dark-100 pt-4">Watch the graph assemble</h3>
        <p className={prose}>
          Below is the full extraction for <em>The Final Problem</em>, in the project&apos;s
          graph viewer. Scrub the timeline and the graph builds as the story reaches each
          point. Entities appear as they are introduced, events fire, and edges form between
          participants. Speech arrives as a{" "}
          <code className="mono text-dark-200">COMMUNICATES</code> event, which is the
          separation that will later let the character-state layer derive a false belief
          without the graph ever storing one. The perspective dropdown is a preview of that
          layer. Pick a character, and the graph narrows to what they witnessed or were told.
        </p>
        <div className="rounded-xl border border-dark-800 overflow-hidden h-[560px]">
          <EmbeddedGraphViewer />
        </div>
        <p className="text-sm">
          <Link
            href={graphHref}
            className="text-crimson-400 hover:text-crimson-300 transition-colors font-medium"
          >
            Open the full graph explorer →
          </Link>{" "}
          <span className="text-dark-500">
            all seventeen works, with the perspective filter and the live SQL.
          </span>
        </p>
      
      
        <h3 className="text-lg font-semibold text-dark-100 pt-2">
          Where this shows up outside fiction
        </h3>
        <ul className={bullet}>
          <li>
            In accounts payable, a scanned supplier invoice becomes a structured record of
            supplier, line items and VAT, ready for a Making Tax Digital submission to HMRC,
            with each field still pointing back at the line on the document it came from.
          </li>
          <li>
            In property conveyancing, a solicitor&apos;s search results and title deeds
            become structured records of covenants, easements and charges, each one
            traceable back to the clause in the document that raised it.
          </li>
          <li>
            In financial compliance, names and directorships pulled from Companies House
            filings and client correspondence are checked against the OFSI sanctions list as
            structured records, rather than by re-reading the prose.
          </li>
        </ul>
        <p className={prose}>
          Here is the same passage from earlier, seen three ways. The lexical graph, the
          entity extraction on top of it, and reverse citation, where you pick a fact and watch the
          sentences that support it light up.
        </p>
        {passage ? (
          <PassageWalkthrough passage={passage} />
        ) : (
          <div className="rounded p-4 bg-dark-900/50 border border-dark-800 text-sm text-dark-400">
            Sample passage not available. Run the ingest first.
          </div>
        )}
      </section>

      {/* ── 5: What the pipeline produced ────────────────────────────── */}
      <section className="space-y-6">
        <SectionMark n="05" label="Yield" />
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          From {Math.round(totalWords / 1000).toLocaleString()},000 words to{" "}
          {Math.round(totalEvents / 1000).toLocaleString()},000 events
        </h2>
        <p className={prose}>
          The pipeline is a distillation. The corpus shrinks at every step, from words to
          sentences to entities to events, and what survives is the structured residue the
          rest of the system runs on. Each row below is the canon-wide total at that layer.
        </p>
        <YieldFunnel
          works={canon.works}
          frequency={canon.frequency}
          totalEntities={canon.entities.length}
          totalEvents={totalEvents}
        />

        <h3 className="text-xl font-semibold tracking-tight pt-4">
          Yield varies by work
        </h3>
        <p className={prose}>
          Normalised by word count, the short stories are denser than the novels. A story has
          no room to breathe, so nearly every paragraph introduces someone or moves something.
          The novels dilute, and their long flashback halves, narrated far from Baker Street,
          are noticeably thin on extractable entities.
        </p>
        <ExtractionDensity works={canon.works} />
      </section>

      {/* ── 6: Reconciliation ────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionMark n="06" label="Cleaning up across works" />
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Reconciling entities across seventeen works
        </h2>
        <p className={prose}>
          Extraction runs one work at a time, so the model only ever sees a local view. Across
          the canon that produces two opposite problems. Sometimes one person accumulates
          several labels, and the variants need merging into a single node. And sometimes one
          label is shared by several different things, which must be kept apart.
        </p>
        <p className={prose}>
          The canon offers a perfect specimen of the second problem, because it contains
          three Hudsons: Mrs Hudson, the housekeeper at Baker Street; Hudson the seaman, who
          drives the blackmail plot of <em>The Gloria Scott</em>; and Hudson Street, an
          address in <em>The Crooked Man</em>. They share a surname, but they are three
          distinct entities, and one of them is not even a person.
        </p>
        <ReconciliationDiagram data={reconciliation} />
        <p className="text-xs text-dark-500 leading-relaxed max-w-3xl">
          Cross-work deduplication runs after per-work extraction. Alias rules for the major
          recurring characters are hand-curated, while the long tail of one-off clients and
          witnesses is resolved by label similarity combined with type equality, so a street
          can never merge with a seaman.
        </p>
      </section>

      {/* ── 7: What you can now ask ──────────────────────────────────── */}
      <section className="space-y-6">
        <SectionMark n="07" label="What you can now ask" />
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Four questions, answered from the graph
        </h2>
        <p className={prose}>
          Everything below runs live against the same canon-wide data used throughout this
          post. The full portfolio of query primitives, including aggregates, lives on{" "}
          <code className="mono text-dark-300">/analysis</code>.
        </p>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-dark-100">Time: where was Watson, when?</h3>
          <p className={prose}>
            This is the exact question that stumped vector search back in section 1. Each
            strip below is one character&apos;s location over story time, built from{" "}
            <code className="mono text-dark-300">LOCATED_AT</code> state edges and their
            validity windows. Pick a work, add characters, and read off who was where as the
            story unfolds.
          </p>
        </div>
        <TrajectoryTracker trajectories={canon.trajectories} />

        <div className="space-y-3 pt-4">
          <h3 className="text-lg font-semibold text-dark-100">
            Position: is Holmes even in his own novels?
          </h3>
          <p className={prose}>
            Each mark is one sentence naming the selected character, positioned across the
            work. Select Holmes in <em>A Study in Scarlet</em> or <em>The Valley of Fear</em>{" "}
            and a long empty stretch appears in the middle. Those are the flashback halves,
            whole sections of novel narrated with the detective entirely off-page.
          </p>
        </div>
        <PresenceStripLazy works={canon.works} />

        <div className="space-y-3 pt-4">
          <h3 className="text-lg font-semibold text-dark-100">
            Search: did Holmes ever say that?
          </h3>
          <p className={prose}>
            A case-insensitive scan of every sentence in the canon settles some folklore. The
            title of this post is genuine, but &ldquo;Elementary, my dear Watson&rdquo; scores
            zero hits, which makes it a pleasing irony that the Star Trek episode this post
            opened with is titled <em>Elementary, Dear Data</em>. Even the holodeck was built
            on a misquote.
          </p>
        </div>
        <CitationScoreboard famousQuoteCounts={famousQuoteCounts} totalSentences={totalSentences} />

        <div className="space-y-3 pt-4">
          <h3 className="text-lg font-semibold text-dark-100">
            Relation: the social shape of the canon
          </h3>
          <p className={prose}>
            An edge between two characters means they shared a paragraph somewhere in the
            canon, weighted by how often. Holmes and Watson sit at the centre, and almost
            everyone else connects through one of them. The canon&apos;s social structure is a
            star with two points of light, which is exactly how Conan Doyle wrote it.
          </p>
        </div>
        <CoOccurrenceNetwork entities={networkEntities} edges={canon.coOccurrence} />
      </section>

      {/* ── Next ─────────────────────────────────────────────────────── */}
      <section className="space-y-4 pt-8 border-t border-dark-800">
        <h2 className="text-xl font-semibold">Next: the harder question</h2>
        <p className={prose}>
          This post built the substrate, a lexical graph that gives every sentence an address
          and an entity extraction layer of structured facts that cite those addresses. The next post
          climbs to the character-state layer and asks what a given character knows at a given
          point in the story. That question is the difference between a search engine over the
          canon and a Watson you can interrogate at chapter three, one who genuinely does not
          know how the case ends. The architecture stays the same; the question gets sharper.
        </p>
      </section>

    </article>
  );
}
