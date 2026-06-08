"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import type { Entity, LexicalGraph, SectionMeta } from "@/lib/types";


const PROGRESS_KEY = (slug: string) => `sherlock:read:${slug}`;

// Empty component to hide the CopilotKit toggle button
const HiddenToggleButton = React.forwardRef<HTMLButtonElement>(function HiddenToggleButton() {
  return null;
});
HiddenToggleButton.displayName = "HiddenToggleButton";

interface CharacterChat {
  characterId: string;
  characterLabel: string;
  sectionId: string;
}

export default function StoryReader({
  slug,
  lexical,
  charactersBySection,
}: {
  slug: string;
  lexical: LexicalGraph;
  charactersBySection: Record<string, Entity[]>;
}) {
  const { sections, nodes } = lexical;
  const [currentSectionId, setCurrentSectionId] = useState<string>(sections[0]?.id ?? "");
  const [chat, setChat] = useState<CharacterChat | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const restoredRef = useRef(false);

  const nodesBySection = new Map<string, string>();
  for (const section of sections) {
    const sectionNodes = nodes.filter((n) => n.section === section.id);
    nodesBySection.set(section.id, sectionNodes.map((n) => n.text).join(" "));
  }

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = localStorage.getItem(PROGRESS_KEY(slug));
      if (saved) {
        const { sectionId } = JSON.parse(saved) as { sectionId: string };
        const el = sectionRefs.current.get(sectionId);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch {
      // ignore
    }
  }, [slug]);

  useEffect(() => {
    observerRef.current?.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = (visible[0].target as HTMLElement).dataset.sectionId!;
          setCurrentSectionId(id);
          try {
            localStorage.setItem(PROGRESS_KEY(slug), JSON.stringify({ sectionId: id }));
          } catch {
            // ignore
          }
        }
      },
      { threshold: 0.2 }
    );

    for (const el of sectionRefs.current.values()) {
      observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [slug, sections]);

  const handleCharacterClick = useCallback(
    (characterId: string, characterLabel: string) => {
      setChat({ characterId, characterLabel, sectionId: currentSectionId });
    },
    [currentSectionId]
  );

  const sectionProgress = sections.findIndex((s) => s.id === currentSectionId) + 1;
  const currentChars = charactersBySection[currentSectionId] ?? [];

  return (
    <div className="flex min-h-screen">
      {/* Section sidebar */}
      <aside className="hidden lg:flex flex-col w-52 shrink-0 border-r border-dark-800 bg-dark-900/40 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="px-4 py-3 text-xs text-dark-500 uppercase tracking-wider font-mono border-b border-dark-800">
          Sections
        </div>
        {sections.map((s, i) => (
          <button
            key={s.id}
            onClick={() => {
              sectionRefs.current.get(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={`text-left px-4 py-2 text-xs transition-colors border-l-2 ${
              s.id === currentSectionId
                ? "border-crimson-500 text-dark-100 bg-dark-800/50"
                : "border-transparent text-dark-500 hover:text-dark-200"
            }`}
          >
            <span className="text-dark-700 font-mono mr-1">{i + 1}.</span> {s.title}
          </button>
        ))}
      </aside>

      {/* Main reading area */}
      <main className="flex-1 max-w-2xl mx-auto px-8 py-12">
        {/* Progress bar */}
        <div
          className="fixed top-16 left-0 right-0 h-0.5 bg-dark-800 z-10"
          role="progressbar"
          aria-label="Reading progress"
          aria-valuemin={0}
          aria-valuemax={sections.length}
          aria-valuenow={sectionProgress}
        >
          <div
            className="h-full bg-crimson-500 transition-all duration-300"
            style={{ width: `${(sectionProgress / sections.length) * 100}%` }}
          />
        </div>

        {/* Story sections */}
        {sections.map((section) => {
          const text = nodesBySection.get(section.id) ?? "";
          return (
            <section
              key={section.id}
              data-section-id={section.id}
              ref={(el) => {
                if (el) sectionRefs.current.set(section.id, el);
                else sectionRefs.current.delete(section.id);
              }}
              className="mb-16 scroll-mt-16"
            >
              <h2 className="text-xs font-mono uppercase tracking-widest text-dark-500 mb-6 border-b border-dark-800 pb-2">
                {section.title}
              </h2>
              <div className="text-dark-100 text-base">
                <ReactMarkdown>{text}</ReactMarkdown>
              </div>
            </section>
          );
        })}
      </main>

      {/* Character selector */}
      <aside className="hidden lg:flex flex-col w-44 shrink-0 sticky top-16 h-[calc(100vh-4rem)] pt-12 pl-2 pr-6">
        {currentChars.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-dark-500 uppercase tracking-wider font-mono mb-1">
              In scene
            </span>
            {currentChars.map((c) => {
              const active = chat?.characterId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => handleCharacterClick(c.id, c.label)}
                  aria-pressed={active}
                  className={`text-left text-xs px-3 py-2 rounded-lg transition-colors border ${
                    active
                      ? "bg-crimson-900/40 text-crimson-200 border-crimson-700/60"
                      : "bg-crimson-900/20 text-crimson-300 hover:bg-crimson-800/40 border-crimson-800/40 hover:border-crimson-600/60"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* CopilotKit chat sidebar — remount when character/section changes so history resets */}
      {chat && (
        <CopilotKitProvider
          key={`${chat.characterId}:${chat.sectionId}`}
          runtimeUrl="/api/copilotkit"
          headers={{
            "x-story-slug": slug,
            "x-character-id": chat.characterId,
            "x-section-id": chat.sectionId,
          }}
        >
          <CopilotSidebar
            defaultOpen
            labels={{
              modalHeaderTitle: chat.characterLabel,
              welcomeMessageText: `You are speaking with ${chat.characterLabel} — at the point in the story when "${sections.find((s) => s.id === chat.sectionId)?.title ?? chat.sectionId}" has just occurred. Ask them anything.`,
            }}
            toggleButton={HiddenToggleButton}
          />
        </CopilotKitProvider>
      )}
    </div>
  );
}
