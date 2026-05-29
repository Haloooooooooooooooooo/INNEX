import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import {
  EMBEDDING_ENDPOINT,
  LLM_PROVIDERS,
  getChatTarget,
  getEmbeddingTarget,
  hasProviderKey,
  type LlmUseCase,
  type ProviderKey,
} from "./provider";

function withV1Suffix(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function providerBaseURL(provider: ProviderKey): string {
  const base = LLM_PROVIDERS[provider].baseURL;
  if (provider === "deepseek") return withV1Suffix(base);
  return base;
}

const clients: Record<ProviderKey, ReturnType<typeof createOpenAI>> = {
  deepseek: createOpenAI({
    baseURL: providerBaseURL("deepseek"),
    apiKey: LLM_PROVIDERS.deepseek.apiKey,
  }),
  openai: createOpenAI({
    baseURL: providerBaseURL("openai"),
    apiKey: LLM_PROVIDERS.openai.apiKey,
  }),
};

const embeddingClient = createOpenAI({
  baseURL: EMBEDDING_ENDPOINT.baseURL,
  apiKey: EMBEDDING_ENDPOINT.apiKey,
});

function isNotFoundError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || "");
  const m = msg.toLowerCase();
  return m.includes("not found") || m.includes("404") || m.includes("deepseek_http_404");
}

function isRetryableDeepseekError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || "");
  const m = msg.toLowerCase();
  return (
    m.includes("deepseek_empty_response") ||
    m.includes("timeout") ||
    m.includes("deepseek_http_429") ||
    m.includes("deepseek_http_500") ||
    m.includes("deepseek_http_502") ||
    m.includes("deepseek_http_503") ||
    m.includes("deepseek_http_504")
  );
}

async function deepseekChatCompletion(input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxOutputTokens: number;
}): Promise<string> {
  const baseURL = providerBaseURL("deepseek").replace(/\/$/, "");
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LLM_PROVIDERS.deepseek.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(`deepseek_http_${res.status}:${raw.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text === "string" && text.trim()) return text.trim();
  throw new Error("deepseek_empty_response");
}

async function deepseekChatCompletionRobust(input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxOutputTokens: number;
}): Promise<string> {
  let lastErr: unknown = null;
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    try {
      return await deepseekChatCompletion(input);
    } catch (err) {
      lastErr = err;
      const canRetry = i < attempts - 1 && isRetryableDeepseekError(err);
      if (!canRetry) break;
      await new Promise((r) => setTimeout(r, 450 * (i + 1)));
    }
  }
  throw (lastErr instanceof Error ? lastErr : new Error("deepseek_retry_failed"));
}

export async function generateCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    temperature?: number;
    maxOutputTokens?: number;
    useCase?: LlmUseCase;
    provider?: ProviderKey;
    model?: string;
  }
): Promise<string> {
  const request = {
    system: systemPrompt,
    prompt: userPrompt,
    temperature: options?.temperature ?? 0.3,
    maxOutputTokens: options?.maxOutputTokens ?? 4000,
  };

  const useCase = options?.useCase || "general";
  const primary = getChatTarget(useCase, {
    provider: options?.provider,
    model: options?.model,
  });

  if (primary.provider !== "deepseek") {
    throw new Error("non_deepseek_text_provider_disabled");
  }

  try {
    if (!hasProviderKey("deepseek")) {
      throw new Error("deepseek api key missing");
    }

    return await deepseekChatCompletionRobust({
      model: primary.model,
      systemPrompt: request.system,
      userPrompt: request.prompt,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
    });
  } catch (primaryError) {
    // same-provider fallback: if flash unavailable, fallback to pro
    if ((isNotFoundError(primaryError) || isRetryableDeepseekError(primaryError)) && primary.model !== "deepseek-v4-pro") {
      try {
        return await deepseekChatCompletionRobust({
          model: "deepseek-v4-pro",
          systemPrompt: request.system,
          userPrompt: request.prompt,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
        });
      } catch {
        // continue
      }
    }

    const primaryMsg = primaryError instanceof Error ? primaryError.message : "unknown primary error";
    throw new Error(`primary_failed:${primaryMsg}; deepseek_only_mode`);
  }
}

export async function generateEmbedding(
  text: string,
  options?: { provider?: ProviderKey; model?: string }
): Promise<number[]> {
  const target = getEmbeddingTarget(options);
  if (EMBEDDING_ENDPOINT.apiKey) {
    const { embedding } = await embed({
      model: embeddingClient.embedding(target.model),
      value: text,
    });
    return embedding;
  }

  if (!hasProviderKey(target.provider)) {
    throw new Error(`${target.provider} api key missing for embedding and EMBEDDING_OPENAI_API_KEY missing`);
  }

  const { embedding } = await embed({
    model: clients[target.provider].embedding(target.model),
    value: text,
  });
  return embedding;
}

export async function extractTextFromImageDataUrl(dataUrl: string): Promise<string> {
  const content = await runVisionPrompt({
    dataUrl,
    prompt: "请提取图片中的全部可见文字，保持原语言，按自然段输出，不要解释。",
    maxTokens: 1200,
    temperature: 0.1,
  });
  return normalizeVisionContent(content);
}

export async function analyzeImageForSummaryAndTags(dataUrl: string): Promise<{ summary: string; tags: string[] }> {
  const content = await runVisionPrompt({
    dataUrl,
    prompt:
      "请理解整张图片在表达什么（包括图表结构、关系、流程、结论和图中文字），并返回JSON：{\"summary\":\"2-3句中文摘要，说明图在讲什么\",\"tags\":[\"标签1\",\"标签2\",\"标签3\"]}。仅输出JSON，不要额外解释。",
    maxTokens: 400,
    temperature: 0.2,
  });
  const text = normalizeVisionContent(content);

  const parsed = safeParseVisionJson(text);
  const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
  const tags = Array.isArray(parsed?.tags) ? parsed.tags.filter((x: unknown) => typeof x === "string").slice(0, 3) : [];
  if (!summary) throw new Error("vision summary empty");
  return { summary, tags: tags.length ? tags : ["图片"] };
}

function safeParseVisionJson(raw: string): { summary?: string; tags?: string[] } {
  const text = (raw || "").trim();
  if (!text) return {};

  const candidates: string[] = [];
  candidates.push(text);

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1].trim());

  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    candidates.push(text.slice(jsonStart, jsonEnd + 1));
  }

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object") return parsed as { summary?: string; tags?: string[] };
    } catch {
      // try next
    }
  }

  // Fallback: parse loose text like "summary: ... tags: a,b,c"
  const summaryMatch = text.match(/summary\s*[:：]\s*([^\n]+)/i) || text.match(/摘要\s*[:：]\s*([^\n]+)/);
  const tagsMatch = text.match(/tags?\s*[:：]\s*([^\n]+)/i) || text.match(/标签\s*[:：]\s*([^\n]+)/);
  const summary = summaryMatch?.[1]?.trim();
  const tags = tagsMatch?.[1]
    ?.split(/[，,、\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3);
  return { summary, tags };
}

function getOcrConfig() {
  const baseURL = (process.env.OCR_OPENAI_BASE_URL || EMBEDDING_ENDPOINT.baseURL || providerBaseURL("openai")).replace(/\/$/, "");
  const apiKey = process.env.OCR_OPENAI_API_KEY || EMBEDDING_ENDPOINT.apiKey || LLM_PROVIDERS.openai.apiKey;
  const modelPrimary = process.env.OCR_OPENAI_MODEL || "Qwen/Qwen3-Omni-30B-A3B-Instruct";
  const modelFallbackA = process.env.OPENAI_VISION_MODEL || "";
  const modelFallbackB = process.env.OPENAI_CHAT_MODEL || "";
  const candidates = [modelPrimary, modelFallbackA, modelFallbackB]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  return { baseURL, apiKey, candidates };
}

function normalizeVisionContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const t = (part as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

async function runVisionPrompt(input: { dataUrl: string; prompt: string; maxTokens: number; temperature: number }) {
  const { baseURL, apiKey, candidates } = getOcrConfig();
  if (!apiKey) throw new Error("vision api key missing (OCR_OPENAI_API_KEY/EMBEDDING_OPENAI_API_KEY/OPENAI_API_KEY)");

  const payloadBuilders = [
    (model: string) => ({
      model,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      messages: [{ role: "user", content: [{ type: "text", text: input.prompt }, { type: "image_url", image_url: { url: input.dataUrl } }] }],
    }),
    (model: string) => ({
      model,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      messages: [{ role: "user", content: [{ type: "text", text: input.prompt }, { type: "image_url", image_url: input.dataUrl }] }],
    }),
  ];

  let lastError = "vision_unknown_error";
  for (const model of candidates) {
    for (const buildPayload of payloadBuilders) {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload(model)),
      });
      if (res.ok) {
        const data = await res.json();
        return data?.choices?.[0]?.message?.content;
      }
      const body = await res.text().catch(() => "");
      lastError = `vision request failed: ${res.status} model=${model} body=${body.slice(0, 220)}`;
    }
  }
  throw new Error(lastError);
}
