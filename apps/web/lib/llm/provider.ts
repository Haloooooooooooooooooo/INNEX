export const LLM_PROVIDERS = {
  deepseek: {
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY!,
    chatModel: "deepseek-chat",
  },
  openai: {
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    visionModel: "gpt-4o",
    embeddingModel: "text-embedding-3-small",
  },
};

export const EMBEDDING_DIMENSIONS = 1536;
