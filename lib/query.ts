import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getCharacterContext } from "./graph-query";
import type { CharacterContext } from "./graph-query";

function buildLLM(): BaseChatModel {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: "claude-sonnet-4-6",
      temperature: 0.2,
      maxTokens: 1024,
    }) as unknown as BaseChatModel;
  }
  if (process.env.OPENAI_API_KEY) {
    return new ChatOpenAI({
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      configuration: {
        ...(process.env.OPENAI_ORGANISATION ? { organization: process.env.OPENAI_ORGANISATION } : {}),
        ...(process.env.OPENAI_PROJECT_ID ? { defaultHeaders: { "OpenAI-Project": process.env.OPENAI_PROJECT_ID } } : {}),
      },
    }) as unknown as BaseChatModel;
  }
  throw new Error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
}

export function buildSystemPrompt(ctx: CharacterContext, sectionId: string): string {
  const { state, visibleEvents, characterEntity } = ctx;

  const observed = state.observations
    .map((o) => `  - ${o.description} [event ${o.based_on_events.join(",")}]`)
    .join("\n") || "  (none)";

  const told = state.beliefs
    .map((b) => `  - "${b.description}" (told via event ${b.based_on_events.join(",")})`)
    .join("\n") || "  (none)";

  const myEvents = visibleEvents
    .filter((ev) => ev.participants.includes(characterEntity.id))
    .map((ev) => `  - [${ev.id}] ${ev.label}`)
    .join("\n") || "  (none)";

  return `You are ${characterEntity.label}, a character in a story. The story is currently at ${sectionId}.

You may reference ONLY the following knowledge. You do not have access to anything else — not the narrator's perspective, not other characters' thoughts, not anything that happens after this point in the story.

EVENTS YOU PERSONALLY WITNESSED:
${myEvents}

THINGS YOU DIRECTLY OBSERVED:
${observed}

THINGS YOU WERE TOLD (may be true or false; you have no way to verify them beyond what you observed):
${told}

INSTRUCTIONS:
- Answer in first person as ${characterEntity.label}.
- Be concise (2–4 sentences).
- If you don't know something because you weren't there or weren't told, say so honestly.
- If you were told something that contradicts what you observed, you may notice the inconsistency or you may not — answer according to what you genuinely believe given your perspective.
- Do NOT invent details. Do NOT use information from outside this list.`;
}

export interface QueryResult {
  answer: string;
  context: CharacterContext;
}

export async function answerCharacterQuery({
  slug,
  characterId,
  sectionId,
  question,
}: {
  slug: string;
  characterId: string;
  sectionId: string;
  question: string;
}): Promise<QueryResult> {
  const ctx = await getCharacterContext(slug, characterId, sectionId);

  const llm = buildLLM();
  const response = await llm.invoke([
    new SystemMessage(buildSystemPrompt(ctx, sectionId)),
    new HumanMessage(question),
  ]);

  const answer =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  return { answer: answer.trim(), context: ctx };
}
