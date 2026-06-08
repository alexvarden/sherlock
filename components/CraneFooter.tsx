export default function CraneFooter() {
  return (
    <footer className="shrink-0 border-t border-dark-800 bg-dark-950">
      <div className="max-w-7xl mx-auto px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-dark-500">
        <p>© 2026 Crane — AI, deliberately built. Based in the UK.</p>
        <a
          href="https://crane-ai.co.uk"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono uppercase tracking-[0.18em] text-dark-500 hover:text-crimson-400 transition-colors"
        >
          crane-ai.co.uk →
        </a>
      </div>
    </footer>
  );
}
