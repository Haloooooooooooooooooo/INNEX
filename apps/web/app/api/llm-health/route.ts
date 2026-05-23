import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generateCompletion, generateEmbedding } from "@/lib/llm/client";
import { EMBEDDING_ENDPOINT, LLM_PROVIDERS, LLM_ROUTING } from "@/lib/llm/provider";

function normalizeModelError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("ssl") || m.includes("tls") || m.includes("handshake")) return "model_network_error";
  if (m.includes("timeout")) return "model_timeout";
  if (m.includes("unauthorized") || m.includes("401")) return "model_unauthorized";
  if (m.includes("429") || m.includes("rate")) return "model_rate_limited";
  if (m.includes("not found") || m.includes("404")) return "model_not_found";
  return "model_unavailable";
}

async function probeParseProvider(provider: "deepseek") {
  const startedAt = Date.now();
  const run = async (phase: "summary" | "tags", prompt: string) => {
    try {
      const text = await generateCompletion(
        phase === "summary"
          ? "你是测试助手。请输出一句中文摘要。"
          : "你是测试助手。请输出JSON数组标签，例如 [\"测试\"]。",
        prompt,
        { useCase: "parse", provider, maxOutputTokens: 80, temperature: 0 }
      );
      return {
        ok: Boolean(text?.trim()),
        normalized_reason: "",
        raw_error: "",
      };
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "unknown_error";
      return {
        ok: false,
        normalized_reason: normalizeModelError(raw),
        raw_error: raw.slice(0, 400),
      };
    }
  };

  const summary = await run("summary", "请对“这是健康检查文本”生成一句摘要。");
  const tags = await run("tags", "请对“这是健康检查文本”生成1到3个标签。");
  return {
    provider,
    ok: summary.ok && tags.ok,
    elapsed_ms: Date.now() - startedAt,
    summary,
    tags,
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks = {
    env: {
      deepseek_api_key: Boolean(process.env.DEEPSEEK_API_KEY),
      openai_api_key: Boolean(process.env.OPENAI_API_KEY),
      openai_base_url: Boolean(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
      embedding_api_key: Boolean(process.env.EMBEDDING_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
      embedding_base_url: Boolean(process.env.EMBEDDING_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL),
    },
    routing: LLM_ROUTING,
    completion: {
      ok: false,
      provider: "deepseek_only",
      error: "",
    },
    embedding: {
      ok: false,
      model: EMBEDDING_ENDPOINT.model || LLM_PROVIDERS.openai.embeddingModel,
      dimensions: 0,
      error: "",
    },
    parse_probes: [] as Array<{
      provider: "deepseek";
      ok: boolean;
      elapsed_ms: number;
      summary: { ok: boolean; normalized_reason: string; raw_error: string };
      tags: { ok: boolean; normalized_reason: string; raw_error: string };
    }>,
  };

  try {
    const text = await generateCompletion(
      "You are a test assistant. Reply with exactly: OK",
      "Return OK"
    );
    checks.completion.ok = text.trim().length > 0;
  } catch (err: unknown) {
    checks.completion.error = err instanceof Error ? err.message : "completion check failed";
  }

  try {
    const vec = await generateEmbedding("health check");
    checks.embedding.ok = Array.isArray(vec) && vec.length > 0;
    checks.embedding.dimensions = Array.isArray(vec) ? vec.length : 0;
  } catch (err: unknown) {
    checks.embedding.error = err instanceof Error ? err.message : "embedding check failed";
  }

  checks.parse_probes = await Promise.all([probeParseProvider("deepseek")]);

  const ok =
    checks.env.deepseek_api_key &&
    checks.completion.ok &&
    checks.embedding.ok;

  return NextResponse.json(
    {
      ok,
      message: ok ? "LLM health check passed" : "LLM health check failed",
      checks,
    },
    { status: ok ? 200 : 503 }
  );
}
