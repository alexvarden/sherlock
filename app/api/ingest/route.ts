import { spawnSync } from "child_process";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { slug, sourceFile } = await req.json() as { slug: string; sourceFile: string };

  if (!slug || !sourceFile) {
    return NextResponse.json({ ok: false, message: "Missing slug or sourceFile" }, { status: 400 });
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
