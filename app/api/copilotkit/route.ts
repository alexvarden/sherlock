import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BuiltInAgent, convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { getCharacterContext } from "@/lib/graph-query";
import { buildSystemPrompt } from "@/lib/query";

function buildModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })("claude-sonnet-4-6");
  }
  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai(process.env.OPENAI_MODEL ?? "gpt-4o");
  }
  throw new Error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
}

const runtime = new CopilotRuntime({
  agents: async ({ request }) => {
    const slug = request.headers.get("x-story-slug") ?? "";
    const characterId = request.headers.get("x-character-id") ?? "";
    const sectionId = request.headers.get("x-section-id") ?? "";

    let systemPrompt = "You are a helpful assistant.";
    if (slug && characterId && sectionId) {
      try {
        const ctx = await getCharacterContext(slug, characterId, sectionId);
        systemPrompt = buildSystemPrompt(ctx, sectionId);
      } catch (err) {
        console.error("[copilotkit] getCharacterContext failed:", err);
      }
    }

    const capturedPrompt = systemPrompt;
    return {
      default: new BuiltInAgent({
        type: "aisdk",
        factory: ({ input }) =>
          streamText({
            model: buildModel(),
            system: capturedPrompt,
            messages: convertMessagesToVercelAISDKMessages(input.messages),
          }),
      }),
    };
  },
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  endpoint: "/api/copilotkit",
});

export const POST = handleRequest;
