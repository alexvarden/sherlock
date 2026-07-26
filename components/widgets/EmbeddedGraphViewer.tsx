"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

// Defers the 2,000-line viewer, its d3 dependencies, AND the Final Problem
// graph data (statically imported by the inner module) into one code-split
// chunk that only loads when the reader scrolls near. autoPlay therefore
// starts on approach rather than burning frames off-screen.
const Inner = dynamic(() => import("./EmbeddedGraphViewerInner"), {
  ssr: false,
  loading: () => <Placeholder />,
});

function Placeholder() {
  return (
    <div className="h-full flex items-center justify-center bg-dark-950">
      <p className="text-sm text-dark-600">Loading the graph…</p>
    </div>
  );
}

export default function EmbeddedGraphViewer() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <div ref={ref} className="h-full">{near ? <Inner /> : <Placeholder />}</div>;
}
