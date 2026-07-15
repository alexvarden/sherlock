"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

interface Props {
  workCount: number;
  sectionCount: number;
  sentenceCount: number;
}

interface TreeNode {
  id: string;
  label: string;
  level: number; // 0 author · 1 work · 2 paragraph · 3 sentence
}

const LEVEL_META = [
  { label: "Author", colour: "#5c5252" },
  { label: "Work", colour: "#7a6e6e" },
  { label: "Paragraph", colour: "#a19a9a" },
  { label: "Sentence", colour: "#c9c2c2" },
];

// Red is reserved exclusively for the currently selected path — nodes and
// edges you've actually drilled into.
const SELECTED_COLOUR = "#e11d48";

// Illustrative example children — the real graph has thousands of these; here
// we only ever show a representative handful per parent to convey the shape.
const EXAMPLE_WORKS = ["final-problem", "a-scandal-in-bohemia", "the-red-headed-league", "the-five-orange-pips"];

const ROOT: TreeNode = { id: "doyle", label: "doyle", level: 0 };

function childrenOf(node: TreeNode): TreeNode[] {
  if (node.level === 0) {
    return EXAMPLE_WORKS.map((w) => ({ id: `${node.id}/${w}`, label: w, level: 1 }));
  }
  if (node.level === 1) {
    return [1, 2, 3].map((n) => ({ id: `${node.id}/paragraph_${n}`, label: `paragraph_${n}`, level: 2 }));
  }
  if (node.level === 2) {
    return [1, 2, 3, 4].map((n) => ({ id: `${node.id}/sentence_${n}`, label: `sentence_${n}`, level: 3 }));
  }
  return [];
}

interface Edge {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colour: string;
  selected: boolean;
}

export default function LexicalHierarchy({ workCount, sectionCount, sentenceCount }: Props) {
  // The drill path: selected node at each depth, root first.
  const [path, setPath] = useState<TreeNode[]>([ROOT]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [edges, setEdges] = useState<Edge[]>([]);
  const hasAnimatedRef = useRef(false);

  // On first scroll into view, step through an example drill-down:
  // doyle → a book → chapter_2 → sentence_3.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const timeouts: number[] = [];

    const runIntro = () => {
      const book = childrenOf(ROOT)[0];
      const chapters = childrenOf(book);
      const chapter = chapters[1] ?? chapters[0];
      const sentences = childrenOf(chapter);
      const sentence = sentences[2] ?? sentences[0];

      timeouts.push(window.setTimeout(() => setPath([ROOT, book]), 500));
      timeouts.push(window.setTimeout(() => setPath([ROOT, book, chapter]), 1300));
      timeouts.push(window.setTimeout(() => setPath([ROOT, book, chapter, sentence]), 2100));
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasAnimatedRef.current) {
          hasAnimatedRef.current = true;
          runIntro();
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      timeouts.forEach((t) => clearTimeout(t));
    };
  }, []);

  const levelCounts = [1, workCount, sectionCount, sentenceCount];

  // Rows to render: root, then the children of every node on the path
  // (so we always reveal exactly one layer beneath the deepest selection).
  const rows = useMemo(() => {
    const out: { parent: TreeNode | null; nodes: TreeNode[]; selectedId?: string }[] = [
      { parent: null, nodes: [ROOT], selectedId: ROOT.id },
    ];
    for (let i = 0; i < path.length; i++) {
      const kids = childrenOf(path[i]);
      if (kids.length === 0) break;
      out.push({ parent: path[i], nodes: kids, selectedId: path[i + 1]?.id });
    }
    return out;
  }, [path]);

  const pathKey = path.map((p) => p.id).join("|");

  useLayoutEffect(() => {
    const measure = () => {
      const cont = containerRef.current;
      if (!cont) return;
      const c = cont.getBoundingClientRect();
      const next: Edge[] = [];
      for (let ri = 1; ri < rows.length; ri++) {
        const parent = rows[ri].parent;
        if (!parent) continue;
        const pEl = nodeRefs.current.get(parent.id);
        if (!pEl) continue;
        const pr = pEl.getBoundingClientRect();
        const x1 = pr.left + pr.width / 2 - c.left;
        const y1 = pr.bottom - c.top;
        for (const child of rows[ri].nodes) {
          const cEl = nodeRefs.current.get(child.id);
          if (!cEl) continue;
          const cr = cEl.getBoundingClientRect();
          const selected = child.id === rows[ri].selectedId;
          next.push({
            key: `${parent.id}->${child.id}`,
            x1,
            y1,
            x2: cr.left + cr.width / 2 - c.left,
            y2: cr.top - c.top,
            colour: selected ? SELECTED_COLOUR : LEVEL_META[child.level].colour,
            selected,
          });
        }
      }
      setEdges(next);
    };

    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);

  const selectChild = (parentIndex: number, node: TreeNode) => {
    setPath((cur) => [...cur.slice(0, parentIndex + 1), node]);
  };

  const setRef = (id: string) => (el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  };

  return (
    <div ref={wrapperRef} className="rounded-xl border border-dark-800 bg-dark-900/50 p-6 space-y-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-xs font-mono uppercase tracking-[0.15em] text-dark-400">
          The lexical graph, as a graph
        </p>
        <p className="text-[10px] font-mono text-dark-600">
          click a node to reveal what it contains
        </p>
      </div>

      {/* Tree canvas */}
      <div className="overflow-x-auto">
        <div ref={containerRef} className="relative min-w-max mx-auto px-2">
          {/* Edge overlay */}
          <svg className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
            {edges.map((e) => {
              const dy = e.y2 - e.y1;
              return (
                <path
                  key={e.key}
                  d={`M ${e.x1} ${e.y1} C ${e.x1} ${e.y1 + dy / 2}, ${e.x2} ${e.y1 + dy / 2}, ${e.x2} ${e.y2}`}
                  fill="none"
                  stroke={e.colour}
                  strokeOpacity={e.selected ? 0.9 : 0.35}
                  strokeWidth={e.selected ? 2 : 1.5}
                />
              );
            })}
          </svg>

          <div className="flex flex-col gap-10">
            {rows.map((row, ri) => {
              const meta = LEVEL_META[ri];
              return (
                <div key={ri} className="grid grid-cols-[1fr_auto] items-center gap-4">
                  <div className="flex justify-center gap-3">
                    {row.nodes.map((node) => {
                      const isSelected = row.selectedId === node.id;
                      const isRoot = ri === 0;
                      const colour = meta.colour;
                      const isLeaf = node.level === 3;
                      return (
                        <button
                          key={node.id}
                          ref={setRef(node.id)}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => (isRoot ? setPath([ROOT]) : selectChild(ri - 1, node))}
                          className="relative z-10 rounded-full border-2 px-3 py-1.5 font-mono text-[11px] whitespace-nowrap transition-all duration-300 cursor-pointer hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900"
                          style={{
                            borderColor: isSelected ? SELECTED_COLOUR : `${colour}55`,
                            backgroundColor: isSelected ? `${SELECTED_COLOUR}33` : `${colour}12`,
                            color: isSelected ? "#f5f3f3" : "#b8b0b0",
                            cursor: isLeaf ? "default" : "pointer",
                          }}
                        >
                          {node.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-right text-[10px] font-mono uppercase tracking-[0.15em] text-dark-500 whitespace-nowrap">
                    {meta.label}
                    <br />
                    <span className="text-dark-600">× {levelCounts[ri].toLocaleString()}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Current address */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-dark-500 shrink-0">
          address
        </span>
        <code className="text-[11px] font-mono text-dark-300 bg-dark-900/70 rounded px-2 py-1 break-all">
          {path.map((p) => p.label).join(" / ")}
        </code>
        {path.length > 1 && (
          <button
            type="button"
            onClick={() => setPath([ROOT])}
            className="ml-auto text-[10px] font-mono uppercase tracking-[0.1em] text-dark-500 hover:text-dark-300 cursor-pointer"
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}
