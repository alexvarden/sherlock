import type { LexicalGraph, LexicalNode, SectionMeta } from "./types";

const ABBREVIATIONS = ["Mr", "Mrs", "Ms", "Dr", "St", "Jr", "Sr", "vs", "etc", "Prof", "Capt"];

// ── Sentence tokenizer ────────────────────────────────────────────────────
// Coarse but safe for narrative prose. Masks common abbreviation periods
// before splitting, then unmasks.

export function tokenizeSentences(text: string): string[] {
  const MASK = "";
  let masked = text;
  for (const abbr of ABBREVIATIONS) {
    masked = masked.replace(new RegExp(`\\b${abbr}\\.`, "g"), `${abbr}${MASK}`);
  }
  // Initials like "U.S." or "i.e." — mask interior periods
  masked = masked.replace(/\b([A-Za-z])\.(?=[A-Za-z]\.)/g, `$1${MASK}`);

  const out: string[] = [];
  // Split on sentence-ending punctuation followed by whitespace and a likely sentence-starter.
  const re = /([^.!?\n]+[.!?]+(?:["”’)]+)?)(?:\s+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked)) !== null) {
    const sentence = match[1].replace(new RegExp(MASK, "g"), ".").trim();
    if (sentence) out.push(sentence);
  }
  // Trailing fragment without terminal punctuation
  const consumed = out.join(" ").replace(/\s+/g, " ").length;
  const remainder = masked.replace(new RegExp(MASK, "g"), ".").trim();
  if (remainder && consumed < remainder.length) {
    const tail = remainder.slice(consumed).trim();
    if (tail) out.push(tail);
  }
  return out;
}

// ── Section segmentation (re-used from old splitter) ──────────────────────

export type SectionGranularity = "story" | "chunk" | "paragraph" | "chapter";
export type LexicalGranularity = "sentence" | "paragraph";

// ── Per-source chapter detection patterns ──────────────────────────────────
// Each novel uses different chapter markers. The pipeline picks the right
// pattern based on the source slug.

export interface ChapterPattern {
  label: string;
  pattern: RegExp;
  sectionIdPrefix?: string;  // e.g. "silver-blaze" for Memoirs stories
}

const CHAPTER_PATTERNS: Record<string, ChapterPattern> = {
  // "CHAPTER I." / "CHAPTER II." etc — used by A Study in Scarlet
  "a-study-in-scarlet": {
    label: "A Study in Scarlet",
    pattern: /^\s*(PART\s+[IVXLC]+\.?.*|CHAPTER\s+[IVXLC]+\.?.*)\s*$/im,
  },
  // "Chapter I" — used by The Sign of the Four
  "sign-of-the-four": {
    label: "The Sign of the Four",
    pattern: /^\s*Chapter\s+[IVXLC\d]+\.?.*$/im,
  },
  // "Chapter 1." / "Chapter 2." — used by Hound of the Baskervilles
  "hound-of-the-baskervilles": {
    label: "The Hound of the Baskervilles",
    pattern: /^\s*Chapter\s+\d+\.?.*$/im,
  },
  // Part I / Part II + Chapter structure — Valley of Fear
  "valley-of-fear": {
    label: "The Valley of Fear",
    pattern: /^\s*(PART\s+[IVXLC]+\.?.*|Chapter\s+\d+\.?.*)\s*$/im,
  },
};

// Memoirs individual stories use simple part markers within
const MEMOIRS_STORY_SLUGS = [
  "silver-blaze", "cardboard-box", "yellow-face", "stockbrokers-clerk",
  "gloria-scott", "musgrave-ritual", "reigate-squires", "crooked-man",
  "resident-patient", "greek-interpreter", "naval-treaty", "final-problem",
];

for (const slug of MEMOIRS_STORY_SLUGS) {
  CHAPTER_PATTERNS[slug] = {
    label: slug,
    pattern: /^\s*$/,  // no internal chapter markers — split by chunk within story
    sectionIdPrefix: slug,
  };
}

export function getChapterPattern(slug: string): ChapterPattern | undefined {
  return CHAPTER_PATTERNS[slug];
}

interface RawSection {
  id: string;
  index: number;
  title: string;
  text: string;
}

const CHAPTER_RE = /^(chapter\s+[IVXLC\d]+|part\s+[IVXLC\d]+)[^\n]*/i;

interface SegmentOptions {
  granularity: SectionGranularity;
  chunkWords: number;
  chapterPattern?: RegExp;
  sectionIdPrefix?: string;
}

function segmentSections(text: string, opts: SegmentOptions): RawSection[] {
  const { granularity, chunkWords, sectionIdPrefix } = opts;
  const chapterRe = opts.chapterPattern ?? CHAPTER_RE;
  const prefix = sectionIdPrefix ? `${sectionIdPrefix}-` : "";
  // Normalise CRLF → LF, then split on blank-line paragraph breaks.
  // Inside each paragraph, collapse the hard-wrap newlines that Gutenberg files
  // use so the sentence tokenizer (which treats \n as a hard boundary) doesn't
  // mis-split mid-sentence.
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (granularity === "story") {
    return [{ id: `${prefix}section_1`, index: 0, title: "Story", text: paragraphs.join("\n\n") }];
  }

  if (granularity === "paragraph") {
    return paragraphs.map((p, i) => ({
      id: `${prefix}section_${i + 1}`, index: i, title: `Section ${i + 1}`, text: p,
    }));
  }

  if (granularity === "chapter") {
    // Split on chapter markers; each chapter becomes one section
    const out: RawSection[] = [];
    let current: string[] = [];
    let idx = 0;
    let currentTitle = "Preamble";
    const flush = () => {
      if (current.length === 0) return;
      out.push({
        id: `${prefix}section_${idx + 1}`,
        index: idx,
        title: currentTitle,
        text: current.join("\n\n"),
      });
      idx++;
      current = [];
    };
    for (const para of paragraphs) {
      if (chapterRe.test(para)) {
        flush();
        currentTitle = para.replace(/\s+/g, " ").trim();
      }
      current.push(para);
    }
    flush();
    return out;
  }

  // chunk: word-count grouped. Boundaries (in priority order):
  //   1. Chapter markers — always force flush
  //   2. Scene-break ornaments (*** / --- / ✦ etc.) — force flush, ornament dropped
  //   3. Paragraph end after reaching target word count
  //   4. Sentence boundary (last-resort, only if a single paragraph blows past 2× target)
  const SCENE_BREAK_RE = /^\s*(?:[*•✦#]\s*){3,}\s*$|^\s*(?:[-—–]\s*){3,}\s*$/;
  const hardCeiling = chunkWords * 2;
  const out: RawSection[] = [];
  let current: string[] = [];
  let count = 0;
  let idx = 0;
  const flush = () => {
    if (current.length === 0) return;
    out.push({ id: `${prefix}section_${idx + 1}`, index: idx, title: `Section ${idx + 1}`, text: current.join("\n\n") });
    idx++;
    current = [];
    count = 0;
  };
  const pushParagraph = (para: string) => {
    const wc = para.split(/\s+/).length;
    // Sentence-level fallback: a single paragraph exceeds the hard ceiling.
    // Split into sentences and emit them as their own pseudo-paragraphs, flushing on overrun.
    if (wc > hardCeiling) {
      const sentences = tokenizeSentences(para);
      for (const sent of sentences) {
        const sc = sent.split(/\s+/).length;
        current.push(sent);
        count += sc;
        if (count >= chunkWords) flush();
      }
      return;
    }
    current.push(para);
    count += wc;
    if (count >= chunkWords) flush();
  };
  for (const para of paragraphs) {
    if (SCENE_BREAK_RE.test(para)) {
      if (current.length > 0) flush();
      continue; // ornament itself is not content
    }
    if (chapterRe.test(para) && current.length > 0) flush();
    pushParagraph(para);
  }
  flush();
  return out;
}

// ── Build the lexical graph ───────────────────────────────────────────────

export function buildLexicalGraph(
  text: string,
  options: {
    sectionGranularity?: SectionGranularity;
    lexicalGranularity?: LexicalGranularity;
    chunkWords?: number;
    sourceSlug?: string;       // if set, uses per-source chapter detection
  } = {}
): LexicalGraph {
  const sectionGranularity = options.sectionGranularity ?? "chunk";
  const lexicalGranularity = options.lexicalGranularity ?? "sentence";
  const chunkWords = options.chunkWords ?? 150;

  const pattern = options.sourceSlug ? getChapterPattern(options.sourceSlug) : undefined;
  const rawSections = segmentSections(text, {
    granularity: sectionGranularity,
    chunkWords,
    chapterPattern: pattern?.pattern,
    sectionIdPrefix: pattern?.sectionIdPrefix,
  });

  const sections: SectionMeta[] = rawSections.map((s) => ({
    id: s.id,
    index: s.index,
    title: s.title,
    wordCount: s.text.split(/\s+/).length,
  }));

  const nodes: LexicalNode[] = [];
  let position = 0;

  for (const section of rawSections) {
    if (lexicalGranularity === "sentence") {
      // Tokenize each paragraph independently to preserve paragraph boundaries
      const paragraphs = section.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      for (const para of paragraphs) {
        const sentences = tokenizeSentences(para);
        for (const text of sentences) {
          nodes.push({
            id: `sentence_${position + 1}`,
            section: section.id,
            position,
            text,
            entities: [],
          });
          position++;
        }
      }
    } else {
      // paragraph-level lexical nodes
      const paragraphs = section.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      for (const para of paragraphs) {
        nodes.push({
          id: `para_${position + 1}`,
          section: section.id,
          position,
          text: para,
          entities: [],
        });
        position++;
      }
    }
  }

  return { granularity: lexicalGranularity, sections, nodes };
}
