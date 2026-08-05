import { spawnSync } from "child_process";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

// This route spawns the ingest pipeline, which writes to data/processed and,
// with an API key present, spends money on an LLM. It is a local development
// convenience and nothing else — the "Ingest" button only appears when the
// explorer is rendered with devTools, but that is a UI prop and never gated
// this endpoint. Two guards, because neither is sufficient alone:
//
//   1. Refuse outside development. Otherwise anyone who can reach the route can
//      trigger a five-minute subprocess and burn API credit, unauthenticated.
//   2. Validate the slug against a strict charset. It is path-joined by
//      scripts/ingest.ts (data/processed/<slug>), so ".." or a slash is an
//      arbitrary-file-write primitive. spawnSync takes an argv array rather
//      than a shell string, so shell metacharacters were never the risk here —
//      path traversal was.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const { slug, sourceFile } = await req.json() as { slug: string; sourceFile: string };

  if (!slug || !sourceFile) {
    return NextResponse.json({ ok: false, message: "Missing slug or sourceFile" }, { status: 400 });
  }

  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json(
      { ok: false, message: "Invalid slug: lowercase letters, digits and hyphens only" },
      { status: 400 }
    );
  }

  const hasLLM = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

  const result = spawnSync(
    path.join(process.cwd(), "node_modules/.bin/tsx"),
    ["scripts/ingest.ts", slug],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SPLIT_ONLY: hasLLM ? "false" : "true",
      },
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
    }
  );

  if (result.status !== 0) {
    const err = (result.stderr?.trim() || result.error?.message || "Unknown error").slice(0, 500);
    return NextResponse.json({ ok: false, message: err }, { status: 500 });
  }

  revalidatePath("/graph");
  const message = hasLLM
    ? "Full ingest complete"
    : "Sections updated (add an API key to run full LLM ingest)";
  return NextResponse.json({ ok: true, message });
}
