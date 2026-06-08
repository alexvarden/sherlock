"use client";

import { useState } from "react";

export default function IngestButton({ slug, sourceFile }: { slug: string; sourceFile: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleClick() {
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, sourceFile }),
      });
      const data = await res.json() as { ok: boolean; message: string };
      setResult(data);
      if (data.ok) window.location.reload();
    } catch {
      setResult({ ok: false, message: "Request failed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={pending}
        className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
          pending
            ? "bg-dark-700 text-dark-500 cursor-not-allowed"
            : "bg-dark-800 text-dark-200 hover:bg-dark-700 hover:text-white border border-dark-700"
        }`}
      >
        {pending ? "Ingesting…" : "Ingest"}
      </button>
      {result && !result.ok && (
        <span className="text-xs text-crimson-400">{result.message}</span>
      )}
    </div>
  );
}
