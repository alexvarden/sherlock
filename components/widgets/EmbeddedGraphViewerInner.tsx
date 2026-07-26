"use client";

import KnowledgeGraphViewer from "../KnowledgeGraphViewer";
import lexicalJson from "../../data/processed/final-problem/lexical.json";
import objectiveJson from "../../data/processed/final-problem/objective-graph.json";
import type { LexicalGraph, ObjectiveGraph } from "../../lib/types";

// The Final Problem graph data is bundled into this chunk rather than passed
// as server-component props, keeping ~200 KB out of the article's RSC payload.
const lexical = lexicalJson as unknown as LexicalGraph;
const objective = objectiveJson as unknown as ObjectiveGraph;

export default function EmbeddedGraphViewerInner() {
  return (
    <KnowledgeGraphViewer
      slug="final-problem"
      lexical={lexical}
      objective={objective}
      embedded
      autoPlay
    />
  );
}
