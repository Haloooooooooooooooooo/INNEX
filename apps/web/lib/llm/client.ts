import { createOpenAI } from "@ai-sdk/openai";
import { generateText, embed } from "ai";
import { LLM_PROVIDERS } from "./provider";

const deepseek = createOpenAI({
  baseURL: LLM_PROVIDERS.deepseek.baseURL + "/v1",
  apiKey: LLM_PROVIDERS.deepseek.apiKey,
});

const openai = createOpenAI({
  baseURL: LLM_PROVIDERS.openai.baseURL,
  apiKey: LLM_PROVIDERS.openai.apiKey,
});

export async function generateCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxOutputTokens?: number }
): Promise<string> {
  const { text } = await generateText({
    model: deepseek(LLM_PROVIDERS.deepseek.chatModel),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: options?.temperature ?? 0.3,
    maxOutputTokens: options?.maxOutputTokens ?? 4000,
  });
  return text;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding(LLM_PROVIDERS.openai.embeddingModel),
    value: text,
  });
  return embedding;
}
