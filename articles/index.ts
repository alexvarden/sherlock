// The Sherlock content manifest — pure, serialisable metadata only.
// SAFE to import from anywhere, including client components. Article *bodies*
// (which read fs at build time) live in ./bodies and must only be imported
// from a server component. The host app (crane-ai) merges this list into its
// article registry and resolves the body separately for rendering.
export type SherlockArticle = {
  slug: string;
  title: string;
  projectId: "sherlock";
  orderInProject: number;
  excerpt: string;
  publishedAt: string | null;
  readingTime: number;
  tags: string[];
  /** Written but deliberately withheld. Excluded from every surface. */
  hidden?: boolean;
};

export const sherlockArticles: SherlockArticle[] = [
  {
    slug: "the-game-is-afoot",
    title: "The Game is aFoot — Ingesting the works of Sherlock Holmes",
    projectId: "sherlock",
    orderInProject: 1,
    excerpt:
      "Three layers, two deterministic, one LLM-driven. How Doyle's prose becomes a queryable graph — and where the interesting failure modes actually are.",
    publishedAt: "2026-07-15",
    // Published 2026-08-05. Set to true to withhold: the piece stays reachable
    // at its URL for review but leaves the listing, project pages, sitemap and
    // RSS, and is noindexed. Distinct from publishedAt: null, which means
    // "announced but not written" and 404s.
    hidden: false,
    readingTime: 16,
    tags: ["graphs", "ingest", "pipelines"],
  },
  {
    slug: "lexical-graphs",
    title: "Lexical graphs: how to ingest a document and not lose the plot",
    projectId: "sherlock",
    orderInProject: 2,
    excerpt:
      "Document ingestion pipelines that preserve narrative structure, not just semantic similarity.",
    publishedAt: null,
    readingTime: 14,
    tags: ["pipelines", "ingest"],
  },
  {
    slug: "theory-of-mind-graphs",
    title: "Theory of mind in a graph — passing the Sally-Anne test",
    projectId: "sherlock",
    orderInProject: 3,
    excerpt:
      "Can a graph understand what a character knows? We implement theory of mind using graph traversal and validity windows.",
    publishedAt: null,
    readingTime: 18,
    tags: ["cognition", "graphs"],
  },
  {
    slug: "time-in-knowledge-graphs",
    title: "Time inside a knowledge graph — validity windows",
    projectId: "sherlock",
    orderInProject: 4,
    excerpt:
      "Knowledge changes over time. Characters learn things. How do we model temporal validity in a graph?",
    publishedAt: null,
    readingTime: 15,
    tags: ["temporal", "schema"],
  },
  {
    slug: "interactive-ebook",
    title: "An ebook you can talk to. Ask Watson what he thinks at chapter 3.",
    projectId: "sherlock",
    orderInProject: 5,
    excerpt:
      "The final piece: an interactive reading experience where you can interrogate characters at any point in the narrative.",
    publishedAt: null,
    readingTime: 20,
    tags: ["demo", "narrative"],
  },
];
