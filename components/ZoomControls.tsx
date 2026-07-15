"use client";

// Shared floating zoom controls for graph canvases — keeps the knowledge
// graph viewer and the article's network widgets visually consistent.
export default function ZoomControls({
  onFit,
  onZoom,
}: {
  onFit: () => void;
  onZoom: (factor: number) => void;
}) {
  const btn = "w-7 h-7 flex items-center justify-center rounded-md bg-dark-900/85 hover:bg-dark-800 border border-dark-800 text-dark-300 hover:text-dark-100 transition-colors text-sm";
  return (
    <div className="absolute top-3 right-3 flex flex-col gap-1 z-10">
      <button onClick={() => onZoom(1.4)} className={btn} title="Zoom in">+</button>
      <button onClick={() => onZoom(1 / 1.4)} className={btn} title="Zoom out">−</button>
      <button onClick={onFit} className={btn} title="Fit to view">⌂</button>
    </div>
  );
}
