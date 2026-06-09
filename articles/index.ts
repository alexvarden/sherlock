import type { ComponentType } from "react";
import HowTheCanonBecameData from "./how-the-canon-became-data";

// The Sherlock content manifest. This package is the single source of truth for
// its own articles — the host app (crane-ai) merges this list into its article
// registry and renders `Body` inside its shell. Entries without a `Body` are
// announced/draft posts not yet authored; the host falls back to a placeholder.
export type SherlockArticle = {
  slug: string;
  title: string;
  projectId: "sherlock";
  orderInProject: number;
  excerpt: string;
  publishedAt: string | null;
  readingTime: number;
  tags: string[];
  /** Shell-agnostic article body (async server component). Absent = not yet written. */
  Body?: ComponentType;
};

export const sherlockArticles: SherlockArticle[] = [
  {
    slug: "how-the-canon-became-data",
    title: "How the canon became data",
    projectId: "sherlock",
    orderInProject: 1,
    excerpt:
      "Three layers, two deterministic, one LLM-driven. How Doyle's prose becomes a queryable graph — and where the interesting failure modes actually are.",
    publishedAt: null,
    readingTime: 16,
    tags: ["graphs", "ingest", "pipelines"],
    Body: HowTheCanonBecameData,
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
