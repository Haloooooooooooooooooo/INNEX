export type ProviderKey = "deepseek" | "openai";
export type LlmUseCase = "parse" | "internalize" | "qa" | "relation" | "general";

export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  chatModel: string;
  visionModel?: string;
  embeddingModel?: string;
}

export interface EmbeddingEndpointConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export const LLM_PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  deepseek: {
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    chatModel: process.env.DEEPSEEK_CHAT_MODEL || "deepseek-chat",
  },
  openai: {
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY || "",
    chatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    visionModel: process.env.OPENAI_VISION_MODEL || "gpt-4o",
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  },
};

function normalizeProvider(input: string | undefined, fallback: ProviderKey): ProviderKey {
  if (input === "deepseek" || input === "openai") return input;
  return fallback;
}

export const LLM_ROUTING = {
  parse: {
    provider: normalizeProvider(process.env.LLM_PARSE_PROVIDER, "deepseek"),
    model: process.env.LLM_PARSE_MODEL || "",
  },
  internalize: {
    provider: normalizeProvider(process.env.LLM_INTERNALIZE_PROVIDER, "deepseek"),
    model: process.env.LLM_INTERNALIZE_MODEL || "",
  },
  qa: {
    provider: normalizeProvider(process.env.LLM_QA_PROVIDER, "deepseek"),
    model: process.env.LLM_QA_MODEL || "",
  },
  relation: {
    provider: normalizeProvider(process.env.LLM_RELATION_PROVIDER, "deepseek"),
    model: process.env.LLM_RELATION_MODEL || process.env.DEEPSEEK_RELATION_MODEL || "deepseek-v4-pro",
  },
  general: {
    provider: normalizeProvider(process.env.LLM_GENERAL_PROVIDER, "deepseek"),
    model: process.env.LLM_GENERAL_MODEL || "",
  },
  embedding: {
    provider: normalizeProvider(process.env.LLM_EMBEDDING_PROVIDER, "openai"),
    model: process.env.LLM_EMBEDDING_MODEL || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  },
};

export const EMBEDDING_DIMENSIONS = 1536;

export const EMBEDDING_ENDPOINT: EmbeddingEndpointConfig = {
  baseURL: process.env.EMBEDDING_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.EMBEDDING_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
  model:
    process.env.EMBEDDING_OPENAI_MODEL ||
    process.env.LLM_EMBEDDING_MODEL ||
    process.env.OPENAI_EMBEDDING_MODEL ||
    "text-embedding-3-small",
};

export function getChatTarget(useCase: LlmUseCase, override?: { provider?: ProviderKey; model?: string }) {
  const route = LLM_ROUTING[useCase] || LLM_ROUTING.general;
  const provider = override?.provider || route.provider;
  const model = override?.model || route.model || LLM_PROVIDERS[provider].chatModel;
  return { provider, model };
}

export function getEmbeddingTarget(override?: { provider?: ProviderKey; model?: string }) {
  const provider = override?.provider || LLM_ROUTING.embedding.provider;
  const model =
    override?.model ||
    LLM_ROUTING.embedding.model ||
    EMBEDDING_ENDPOINT.model ||
    LLM_PROVIDERS[provider].embeddingModel ||
    "text-embedding-3-small";
  return { provider, model };
}

export function hasProviderKey(provider: ProviderKey) {
  return Boolean(LLM_PROVIDERS[provider].apiKey);
}
