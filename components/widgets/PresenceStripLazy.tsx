"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { WorkSummary } from "../../lib/canon-types";

// Defers both the JS and the data of the presence strip. The inner module
// statically imports the derived presence payload (lib/derived/), so all of
// it lives in a code-split chunk fetched only when the reader scrolls near —
// none of it rides in the article's RSC payload.
const PresenceStripWithData = dynamic(() => import("./PresenceStripWithData"), {
  ssr: false,
  loading: () => <Placeholder />,
});

function Placeholder() {
  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/50 h-[560px] flex items-center justify-center">
      <p className="text-sm text-dark-600">Loading presence data…</p>
    </div>
  );
}

export default function PresenceStripLazy({ works }: { works: WorkSummary[] }) {
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

  return <div ref={ref}>{near ? <PresenceStripWithData works={works} /> : <Placeholder />}</div>;
}
