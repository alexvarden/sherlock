"use server";

import type { SearchSentence } from "@/lib/canon-types";
import { loadCanonData } from "@/lib/canon-aggregate";

// Module-level cache: load the canon once per server process.
let cachedSentences: SearchSentence[] | null = null;

function getSentences(): SearchSentence[] {
  if (!cachedSentences) {
    cachedSentences = loadCanonData().sentences;
  }
  return cachedSentences;
}

export async function searchCanon(query: string): Promise<SearchSentence[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const sentences = getSentences();
  const results: SearchSentence[] = [];
  for (const s of sentences) {
    if (s.text.toLowerCase().includes(q)) {
      results.push(s);
      if (results.length >= 50) break;
    }
  }
  return results;
}
