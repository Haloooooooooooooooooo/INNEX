import { generateCompletion } from "@/lib/llm/client";
import { withRetry } from "@/lib/llm/resilience";
import { hasProviderKey } from "@/lib/llm/provider";
import {
  PARSE_TITLE_PROMPT,
  parseTitleUserPrompt,
  PARSE_SUMMARY_PROMPT,
  parseSummaryUserPrompt,
  PARSE_TAGS_PROMPT,
  parseTagsUserPrompt,
} from "./prompts";
import type { DetectResult } from "./detector";
import { getSource } from "./detector";

export type ParsedFields = {
  title: string;
  source: string;
  summary: string | null;
  tags: string[];
  debug: {
    model_summary_attempted: boolean;
    model_summary_succeeded: boolean;
    model_tags_attempted: boolean;
    model_tags_succeeded: boolean;
    notes: string[];
  };
};

function sanitizeInputText(content: string): string {
  return content
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdownArtifacts(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\d+(\.\d+)*\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^-{3,}$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSummaryText(content: string): string | null {
  const plain = stripMarkdownArtifacts(content)
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!plain) return null;
  const MAX = 220;
  if (plain.length <= MAX) return plain;
  const head = plain.slice(0, MAX);
  const lastPunc = Math.max(
    head.lastIndexOf("。"),
    head.lastIndexOf("！"),
    head.lastIndexOf("？"),
    head.lastIndexOf("."),
    head.lastIndexOf("!"),
    head.lastIndexOf("?")
  );
  const compact = (lastPunc > 40 ? head.slice(0, lastPunc + 1) : head).trim();
  return compact || null;
}

function normalizeTags(tags: string[]): string[] {
  const generic = new Set([
    "app",
    "product",
    "scenario",
    "content",
    "technology",
    "system",
    "platform",
    "framework",
    "knowledge",
    "chapter",
    "section",
    "part",
    "agent",
    "system",
    "document",
    "markdown",
    "note",
    "content",
    "summary",
    "第一章",
    "第二章",
    "第三章",
    "第四章",
    "第五章",
    "第六章",
    "第七章",
    "第八章",
    "第九章",
    "第十章",
    "本章",
    "章节",
    "小节",
    "部分",
    "内容",
    "文档",
    "笔记",
    "核心论点",
    "要点",
    "总结",
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const v0 = stripMarkdownArtifacts((t || "").trim())
      .replace(/^第[一二三四五六七八九十百千万\d]+章/, "")
      .replace(/^第[一二三四五六七八九十百千万\d]+节/, "")
      .trim();
    const v = v0.length > 14 ? v0.slice(0, 14).trim() : v0;
    if (!v || v.length <= 1) continue;
    if (generic.has(v.toLowerCase()) || generic.has(v)) continue;
    if (/^第[一二三四五六七八九十百千万\d]+[章节部分篇]$/.test(v)) continue;
    if (/^(chapter|section|part)\s*\d+$/i.test(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}

function fallbackTitle(content: string): string | null {
  const normalized =
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || content.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const clause = normalized.split(/[。！？!?;；,:：]/).map((x) => x.trim()).find(Boolean) || normalized;
  return clause.slice(0, 30);
}

function nowStampForTitle(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

async function llmTitleFromContent(content: string): Promise<string | null> {
  if (!content.trim()) return null;
  try {
    const title = await generateCompletion(PARSE_TITLE_PROMPT, parseTitleUserPrompt(content), {
      temperature: 0.3,
      maxOutputTokens: 100,
      useCase: "parse",
    });
    const normalized = title.trim().replace(/^["']|["']$/g, "").slice(0, 40);
    return normalized || null;
  } catch {
    return null;
  }
}

async function llmSummary(content: string): Promise<string | null> {
  if (!content.trim()) return null;
  try {
    return await generateCompletion(PARSE_SUMMARY_PROMPT, parseSummaryUserPrompt(content), {
      temperature: 0.3,
      maxOutputTokens: 150,
      useCase: "parse",
    });
  } catch {
    return null;
  }
}

async function llmTags(content: string): Promise<string[]> {
  if (!content.trim()) return ["-"];
  try {
    const rawTags = await generateCompletion(PARSE_TAGS_PROMPT, parseTagsUserPrompt(content), {
      temperature: 0.3,
      maxOutputTokens: 200,
      useCase: "parse",
    });
    const parsed = JSON.parse(rawTags.trim());
    if (!Array.isArray(parsed) || parsed.length === 0) return ["-"];
    return parsed.slice(0, 3);
  } catch {
    return ["-"];
  }
}

async function llmSummaryWithError(content: string): Promise<{ value: string | null; error?: string }> {
  if (!content.trim()) return { value: null, error: "empty_input" };
  const prompt = parseSummaryUserPrompt(compressContentForSummary(content));
  return llmWithParseFallback("summary", prompt, PARSE_SUMMARY_PROMPT, {
    maxOutputTokens: 180,
    postprocess: (value) => normalizeSummaryText(value || ""),
    emptyError: "summary_empty",
    retry: { attempts: 3, timeoutMs: 25000, retryDelayMs: 700 },
  });
}

function parseTagsFromModelOutput(raw: string): string[] | null {
  const text = (raw || "").trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const tags = normalizeTags(parsed.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean));
      if (tags.length > 0) return tags;
    }
  } catch {
    // continue with tolerant parsing
  }

  const bracketMatch = text.match(/\[([\s\S]*?)\]/);
  const payload = bracketMatch ? bracketMatch[1] : text;
  const tags = payload
    .split(/[,\n，、]/)
    .map((x) => x.replace(/["'`[\]]/g, "").trim())
    .filter(Boolean);
  const normalized = normalizeTags(tags);
  return normalized.length > 0 ? normalized : null;
}

async function llmTagsWithError(content: string): Promise<{ value: string[]; error?: string }> {
  if (!content.trim()) return { value: ["-"], error: "empty_input" };
  const prompt = parseTagsUserPrompt(compressContentForTags(content));
  const result = await llmWithParseFallback("tags", prompt, PARSE_TAGS_PROMPT, {
    maxOutputTokens: 220,
    postprocess: parseTagsFromModelOutput,
    emptyError: "tags_empty",
    retry: { attempts: 3, timeoutMs: 25000, retryDelayMs: 700 },
  });
  if (result.value && result.value.length > 0) return { value: result.value };
  return { value: ["-"], error: result.error || "tags_empty" };
}

function heuristicTagsFromText(content: string): string[] {
  const cleaned = content
    .replace(/[`~!@#$%^&*()_\-+=[\]{}|\\;:'",.<>/?，。！？、；：（）【】《》\n\r\t]/g, " ")
    .toLowerCase();

  const zhWords = cleaned.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  const enWords = cleaned.match(/[a-z][a-z0-9\-]{2,20}/g) || [];
  const words = [...zhWords, ...enWords];

  const stop = new Set([
    "这个",
    "那个",
    "我们",
    "你们",
    "他们",
    "进行",
    "以及",
    "或者",
    "因为",
    "所以",
    "如果",
    "可以",
    "一个",
    "主要",
    "about",
    "with",
    "from",
    "that",
    "this",
    "have",
    "will",
    "your",
    "into",
    "then",
    "than",
    "when",
    "where",
  ]);

  const freq = new Map<string, number>();
  for (const w of words) {
    const t = w.trim();
    if (!t || stop.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }

  return normalizeTags(
    Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
  );
}

function heuristicSummaryFromText(content: string): string | null {
  const normalized = stripMarkdownArtifacts(content).replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const sentences = normalized
    .split(/(?<=[。！？!?\.])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return normalizeSummaryText(normalized.slice(0, 120));
  }

  const summary = sentences.slice(0, 2).join(" ").trim();
  return normalizeSummaryText(summary);
}

function normalizeModelError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("ssl") || m.includes("tls") || m.includes("handshake")) return "model_network_error";
  if (m.includes("timeout")) return "model_timeout";
  if (m.includes("unauthorized") || m.includes("401")) return "model_unauthorized";
  if (m.includes("429") || m.includes("rate")) return "model_rate_limited";
  return "model_unavailable";
}

async function llmWithParseFallback<T>(
  phase: "summary" | "tags",
  userPrompt: string,
  systemPrompt: string,
  options: {
    maxOutputTokens: number;
    postprocess: (value: string) => T | null;
    emptyError: string;
    retry?: { attempts: number; timeoutMs: number; retryDelayMs: number };
  }
): Promise<{ value: T | null; error?: string }> {
  const providerOrder = ["deepseek"] as const;
  let lastError = "model_unavailable";

  for (const provider of providerOrder) {
    if (!hasProviderKey(provider)) {
      console.warn("[parse.model.skipped]", { phase, provider, reason: "api_key_missing" });
      if (lastError === "model_unavailable") {
        lastError = `${provider}_api_key_missing`;
      }
      continue;
    }
    try {
      const raw = await withRetry(
        () =>
          generateCompletion(systemPrompt, userPrompt, {
            temperature: 0.3,
            maxOutputTokens: options.maxOutputTokens,
            useCase: "parse",
            provider,
          }),
        options.retry || { attempts: 2, timeoutMs: 12000, retryDelayMs: 500 }
      );
      const parsed = options.postprocess(raw);
      if (parsed !== null) return { value: parsed };
      lastError = options.emptyError;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown_error";
      lastError = normalizeModelError(msg);
      console.error("[parse.model.failed]", {
        phase,
        provider,
        normalized_reason: lastError,
        raw_error: msg.slice(0, 600),
      });
    }
  }
  return { value: null, error: lastError };
}

function compressContentForTags(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 2200) return normalized;
  const head = normalized.slice(0, 1000);
  const midStart = Math.max(0, Math.floor(normalized.length / 2) - 300);
  const middle = normalized.slice(midStart, midStart + 600);
  const tail = normalized.slice(-600);
  return `${head}\n...\n${middle}\n...\n${tail}`;
}

function compressContentForSummary(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 2600) return normalized;
  const head = normalized.slice(0, 1500);
  const tail = normalized.slice(-900);
  return `${head}\n...\n${tail}`;
}

export async function parseContent(
  contentForParsing: string | null,
  urlTitle: string | null,
  sourceUrl: string | null,
  detected: DetectResult,
  attachments: { name: string; type: string; size: number }[]
): Promise<ParsedFields> {
  const raw = sanitizeInputText((contentForParsing || "").trim());
  const source = getSource(detected, sourceUrl || null, attachments);
  const { type, readable } = detected;

  let summary: string | null = null;
  let tags: string[] = ["-"];
  const canGenerateFromText = (readable === true || readable === "partial") && raw.length > 0;

  const debug = {
    model_summary_attempted: false,
    model_summary_succeeded: false,
    model_tags_attempted: false,
    model_tags_succeeded: false,
    notes: [] as string[],
  };

  if (canGenerateFromText) {
    debug.model_summary_attempted = true;
    const summaryResult = await llmSummaryWithError(raw);
    summary = summaryResult.value;
    debug.model_summary_succeeded = Boolean(summaryResult.value?.trim());
    if (!summary) {
      const fallbackSummary = heuristicSummaryFromText(raw);
      if (fallbackSummary) {
        summary = fallbackSummary;
        debug.notes.push("summary_heuristic_fallback_used");
      }
    }
    if (!debug.model_summary_succeeded) {
      debug.notes.push("summary_model_failed_or_empty");
      if (summaryResult.error) debug.notes.push(`summary_error:${summaryResult.error}`);
    }

    debug.model_tags_attempted = true;
    const tagsResult = await llmTagsWithError(raw);
    tags = tagsResult.value;
    debug.model_tags_succeeded = tags.length > 0 && !(tags.length === 1 && tags[0] === "-");
    if (!debug.model_tags_succeeded) {
      debug.notes.push("tags_model_failed_or_empty");
      if (tagsResult.error) debug.notes.push(`tags_error:${tagsResult.error}`);
    }
  } else if (type === "video") {
    summary = "This link is a video. Summary will be available after processing.";
  } else if (type === "document") {
    summary = null;
    debug.notes.push("document_summary_deferred");
  } else if (type === "image") {
    summary = "Image content needs processing before it can be summarized.";
  } else if (type === "attachment_group") {
    summary = "Attachments need processing before summary is available.";
  } else {
    summary = null;
  }

  let title = "-";
  if (type === "text") {
    if (readable === false) {
      title = raw.slice(0, 5);
    } else {
      title = (await llmTitleFromContent(raw)) || fallbackTitle(raw) || raw.slice(0, 5) || "-";
    }
  } else if (type === "document") {
    title = attachments[0]?.name || "Document";
  } else if (type === "url" || type === "video") {
    if (urlTitle?.trim()) {
      title = urlTitle.trim();
    } else if (canGenerateFromText) {
      title = (await llmTitleFromContent(summary || raw)) || fallbackTitle(summary || raw) || "-";
    } else {
      title = "-";
    }
  } else if (type === "image") {
    if (canGenerateFromText) {
      title = (await llmTitleFromContent(raw)) || fallbackTitle(raw) || `${nowStampForTitle()} Image`;
    } else {
      title = `${nowStampForTitle()} Image`;
    }
  } else if (type === "attachment_group") {
    if (attachments.length > 1) {
      title = `${nowStampForTitle()} Attachments`;
    } else if (attachments.length === 1) {
      title = attachments[0].name || `${nowStampForTitle()} Attachment`;
    } else {
      title = `${nowStampForTitle()} Attachment`;
    }
  }

  if (tags.length === 1 && tags[0] === "-" && canGenerateFromText) {
    const fallback = heuristicTagsFromText(raw);
    if (fallback.length > 0) {
      tags = fallback;
      debug.notes.push("tags_heuristic_fallback_used");
    }
  }

  return { title, source, summary, tags, debug };
}
