import Link from "next/link";
import CraneHeader from "@/components/CraneHeader";
import CraneFooter from "@/components/CraneFooter";

export default function Home() {
  return (
    <main className="min-h-screen bg-dark-950 text-white flex flex-col">
      <CraneHeader
        right={
          <nav className="flex items-center gap-1">
            <Link href="/post0" className="text-xs text-dark-400 hover:text-dark-100 px-3 py-1.5 rounded hover:bg-dark-800/60 transition-colors">
              Post 0
            </Link>
            <Link href="/analysis" className="text-xs text-dark-400 hover:text-dark-100 px-3 py-1.5 rounded hover:bg-dark-800/60 transition-colors">
              Analysis
            </Link>
            <Link href="/graph" className="text-xs text-dark-400 hover:text-dark-100 px-3 py-1.5 rounded hover:bg-dark-800/60 transition-colors">
              Graph
            </Link>
            <Link href="/read" className="text-xs text-dark-400 hover:text-dark-100 px-3 py-1.5 rounded hover:bg-dark-800/60 transition-colors">
              Read
            </Link>
            <Link href="/demo" className="text-xs text-dark-400 hover:text-dark-100 px-3 py-1.5 rounded hover:bg-dark-800/60 transition-colors">
              Q&A
            </Link>
          </nav>
        }
      />

      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* Crimson ambient glow */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(225,29,72,0.10) 0%, transparent 70%)" }}
        />

        <div className="relative z-10 text-center space-y-8 max-w-xl px-8">
          <div className="space-y-2">
            <h1 className="text-5xl font-bold tracking-tight leading-none">Sherlock</h1>
            <p className="text-xs font-mono uppercase tracking-[0.22em] text-crimson-500">
              A Crane AI showcase
            </p>
          </div>

          <p className="text-dark-400 text-base leading-relaxed max-w-md mx-auto">
            Knowledge graph &amp; theory-of-mind engine for Sherlock Holmes stories.
            Graph-grounded RAG — no vector search, no guessing who knew what.
          </p>

          <div className="flex gap-3 justify-center flex-wrap pt-2">
            <Link
              href="/graph"
              className="px-6 py-2.5 bg-crimson-500 hover:bg-crimson-600 rounded-lg font-medium text-sm transition-all duration-200 hover:-translate-y-px text-white"
              style={{ boxShadow: "0 4px 20px rgba(225,29,72,0.35)" }}
            >
              Knowledge Graph
            </Link>
            <Link
              href="/read"
              className="px-6 py-2.5 bg-dark-900 hover:bg-dark-800 border border-dark-800 hover:border-dark-700 rounded-lg font-medium text-sm transition-all duration-200 text-dark-200"
            >
              Read
            </Link>
            <Link
              href="/demo"
              className="px-6 py-2.5 bg-dark-900 hover:bg-dark-800 border border-dark-800 hover:border-dark-700 rounded-lg font-medium text-sm transition-all duration-200 text-dark-200"
            >
              Character Q&amp;A
            </Link>
          </div>
        </div>
      </div>

      <CraneFooter />
    </main>
  );
}
