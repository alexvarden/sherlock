import * as fs from "fs";
import * as path from "path";

// ── Download and prepare Gutenberg sources for cross-corpus ingest ────────

interface SourceConfig {
  slug: string;
  name: string;
  gutenbergId: number;
  url: string;
  outputPath: string;
}

const SOURCES: SourceConfig[] = [
  {
    slug: "a-study-in-scarlet",
    name: "A Study in Scarlet",
    gutenbergId: 244,
    url: "https://www.gutenberg.org/files/244/244-0.txt",
    outputPath: "data/raw/a-study-in-scarlet.txt",
  },
  {
    slug: "sign-of-the-four",
    name: "The Sign of the Four",
    gutenbergId: 2097,
    url: "https://www.gutenberg.org/files/2097/2097-0.txt",
    outputPath: "data/raw/sign-of-the-four.txt",
  },
  {
    slug: "hound-of-the-baskervilles",
    name: "The Hound of the Baskervilles",
    gutenbergId: 2852,
    url: "https://www.gutenberg.org/files/2852/2852-0.txt",
    outputPath: "data/raw/hound-of-the-baskervilles.txt",
  },
  {
    slug: "valley-of-fear",
    name: "The Valley of Fear",
    gutenbergId: 3289,
    url: "https://www.gutenberg.org/files/3289/3289-0.txt",
    outputPath: "data/raw/valley-of-fear.txt",
  },
  {
    slug: "memoirs",
    name: "The Memoirs of Sherlock Holmes",
    gutenbergId: 834,
    url: "https://www.gutenberg.org/cache/epub/834/pg834.txt",
    outputPath: "data/raw/memoirs-complete.txt",
  },
];

// Gutenberg header/footer patterns to strip
const HEADER_END_PATTERNS = [
  /\*\*\* START OF (THE|THIS) PROJECT GUTENBERG EBOOK .+ \*\*\*/i,
  /\*\*\*START OF THE PROJECT GUTENBERG EBOOK .+ \*\*\*/i,
];

const FOOTER_START_PATTERNS = [
  /\*\*\* END OF (THE|THIS) PROJECT GUTENBERG EBOOK .+ \*\*\*/i,
  /\*\*\*END OF THE PROJECT GUTENBERG EBOOK .+ \*\*\*/i,
];

function stripGutenbergMetadata(text: string): string {
  const lines = text.split("\n");
  let startIdx = 0;
  let endIdx = lines.length;

  // Find where content starts (after header)
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_END_PATTERNS.some((p) => p.test(lines[i]))) {
      startIdx = i + 1;
      break;
    }
  }

  // Find where content ends (before footer)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FOOTER_START_PATTERNS.some((p) => p.test(lines[i]))) {
      endIdx = i;
      break;
    }
  }

  return lines.slice(startIdx, endIdx).join("\n").trim();
}

function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")  // ' and '
    .replace(/[\u201C\u201D]/g, '"')  // " and "
    .replace(/\u2026/g, "...");       // …
}

async function downloadFile(url: string): Promise<string> {
  console.log(`   Fetching ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return await response.text();
}

async function downloadSource(config: SourceConfig) {
  console.log(`\n[${config.gutenbergId}] ${config.name}`);
  
  const outputPath = path.join(process.cwd(), config.outputPath);
  
  if (fs.existsSync(outputPath)) {
    console.log(`   ✓ Already exists: ${config.outputPath}`);
    return;
  }

  try {
    const raw = await downloadFile(config.url);
    const stripped = stripGutenbergMetadata(raw);
    const normalized = normalizeQuotes(stripped);
    
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, normalized, "utf-8");
    
    const wordCount = normalized.split(/\s+/).length;
    const sizeKb = (normalized.length / 1024).toFixed(1);
    
    console.log(`   ✓ Downloaded: ${config.outputPath}`);
    console.log(`     ${wordCount.toLocaleString()} words, ${sizeKb} KB`);
  } catch (err) {
    console.error(`   ✗ Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Story boundaries in Memoirs (based on actual Gutenberg format)
const MEMOIRS_STORIES = [
  { slug: "silver-blaze", title: "I\\. Silver Blaze" },
  { slug: "cardboard-box", title: "II\\. The Adventure of the Cardboard Box" },
  { slug: "yellow-face", title: "III\\. The Yellow Face" },
  { slug: "stockbrokers-clerk", title: "IV\\. The Stockbroker's Clerk" },
  { slug: "gloria-scott", title: 'V\\. The [_"]+Gloria Scott[_"]+' },
  { slug: "musgrave-ritual", title: "VI\\. The Musgrave Ritual" },
  { slug: "reigate-squires", title: "VII\\. The Reigate Squires" },
  { slug: "crooked-man", title: "VIII\\. The Crooked Man" },
  { slug: "resident-patient", title: "IX\\. The Resident Patient" },
  { slug: "greek-interpreter", title: "X\\. The Greek Interpreter" },
  { slug: "naval-treaty", title: "XI\\. The Naval Treaty" },
  { slug: "final-problem", title: "XII\\. The Final Problem" },
];

// Helper to escape regex special chars except those we want to keep as patterns
function escapeForRegex(str: string): string {
  // Don't escape \. or [_"] as those are intentional regex patterns
  return str;
}

function splitMemoirsIntoStories() {
  const memoirsPath = path.join(process.cwd(), "data/raw/memoirs-complete.txt");
  
  if (!fs.existsSync(memoirsPath)) {
    console.log("\n⚠  Memoirs not yet downloaded, skipping split");
    return;
  }

  console.log("\n[Split] Splitting Memoirs into individual stories...");
  
  const fullText = fs.readFileSync(memoirsPath, "utf-8");
  const memoirsDir = path.join(process.cwd(), "data/raw/memoirs");
  fs.mkdirSync(memoirsDir, { recursive: true });

  for (let i = 0; i < MEMOIRS_STORIES.length; i++) {
    const story = MEMOIRS_STORIES[i];
    const nextStory = MEMOIRS_STORIES[i + 1];
    
    // Find story start (skip TOC - find SECOND occurrence of title)
    const startPattern = new RegExp(`^\\s*${story.title}\\s*$`, "img");
    const matches = Array.from(fullText.matchAll(startPattern));
    
    if (matches.length < 2) {
      console.log(`   ✗ Could not find story start (found ${matches.length} matches): ${story.title}`);
      continue;
    }
    
    // Use second match (first is TOC, second is actual story)
    const startIdx = matches[1].index!;
    // Move past the title line to start of actual content
    const contentStartIdx = startIdx + matches[1][0].length;
    
    // Find story end (start of next story, or end of file)
    let endIdx = fullText.length;
    if (nextStory) {
      const endPattern = new RegExp(`^\\s*${nextStory.title}\\s*$`, "im");
      // Search from content start (skip at least 500 chars to avoid matching TOC)
      const searchFrom = contentStartIdx + 500;
      const endMatch = fullText.slice(searchFrom).match(endPattern);
      if (endMatch && endMatch.index !== undefined) {
        endIdx = searchFrom + endMatch.index;
      }
    }
    
    const storyText = fullText.slice(startIdx, endIdx).trim();
    const outputPath = path.join(memoirsDir, `${story.slug}.txt`);
    
    fs.writeFileSync(outputPath, storyText, "utf-8");
    
    const wordCount = storyText.split(/\s+/).length;
    const endInfo = nextStory ? `→ ${nextStory.slug}` : "→ EOF";
    console.log(`   ✓ ${story.slug.padEnd(20)} ${wordCount.toLocaleString().padStart(6)} words  ${endInfo}`);
  }
  
  console.log(`\n   → ${MEMOIRS_STORIES.length} stories written to data/raw/memoirs/`);
}

async function main() {
  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  Download Gutenberg sources                ║");
  console.log("╚═════════════════════════════════════════════╝");
  console.log("");
  console.log("Downloading 4 sources from Project Gutenberg:");
  console.log("  - The Sign of the Four");
  console.log("  - The Hound of the Baskervilles");
  console.log("  - The Valley of Fear");
  console.log("  - The Memoirs of Sherlock Holmes");
  console.log("");
  console.log("Note: A Study in Scarlet already exists");
  console.log("");

  for (const source of SOURCES) {
    await downloadSource(source);
  }

  splitMemoirsIntoStories();

  console.log("");
  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  ✅ Download complete                       ║");
  console.log("╚═════════════════════════════════════════════╝");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Run pilot ingest: npm run ingest:pilot");
  console.log("  2. Review quality (see article-notes/PILOT-INGEST.md)");
  console.log("  3. If quality passes, proceed with full canon ingest");
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
