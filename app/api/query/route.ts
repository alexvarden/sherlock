import { NextRequest, NextResponse } from "next/server";
import { answerCharacterQuery } from "@/lib/query";

export async function POST(req: NextRequest) {
  const { slug, characterId, sectionId, question } = (await req.json()) as {
    slug?: string;
    characterId?: string;
    sectionId?: string;
    question?: string;
  };

  if (!slug || !characterId || !sectionId || !question) {
    return NextResponse.json(
      { ok: false, message: "Missing slug, characterId, sectionId, or question" },
      { status: 400 }
    );
  }

  try {
    const result = await answerCharacterQuery({ slug, characterId, sectionId, question });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
