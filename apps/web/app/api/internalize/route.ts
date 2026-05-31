import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { extractTextFromImageDataUrl, generateCompletion, generateEmbedding } from "@/lib/llm/client";
import { ERROR_CODES, errorBody } from "@/lib/api/error-codes";
import { withRetry, mapWithConcurrency } from "@/lib/llm/resilience";
import { extractDocumentTextDetailed } from "@/lib/parse/document-extractor";
import { classifyRelation } from "@/lib/graph/relation-classifier";
import {
  INTERNALIZE_SYSTEM,
  internalizeUserPrompt,
  CONCEPT_EXTRACTION,
} from "@/lib/llm/prompts";

type CaptureSourceRow = {
  id: string;
  source_type: string;
  source_label: string | null;
  source_ref: string | null;
  source_url: string | null;
  content: string;
  is_primary: boolean;
  parse_status: string;
  metadata?: Record<string, unknown> | null;
};

const DEFERRED_SUMMARY_MARKERS = [
  "文件超过录入解析阈值，已先完成收录。请在内化阶段继续解析。",
  "Document is large. Summary will be available after processing.",
];
const MIN_INTERNALIZE_SOURCE_CHARS = 120;
const XIAOHONGSHU_INLINE_OCR_LIMIT = 5;
const MAX_RELATIONS_PER_NOTE = Math.max(
  1,
  Math.min(50, Number(process.env.INTERNALIZE_MAX_RELATIONS_PER_NOTE || 24))
);
const RELATION_RECALL_CHUNK_COUNT = Math.max(
  1,
  Math.min(5, Number(process.env.INTERNALIZE_RELATION_RECALL_CHUNK_COUNT || 3))
);
const RELATION_MATCH_THRESHOLD = Math.max(
  0.3,
  Math.min(0.95, Number(process.env.INTERNALIZE_RELATION_MATCH_THRESHOLD || 0.56))
);
const EXAMPLE_HINTS = ["例如", "案例", "示例", "实战", "模板", "样例", "case", "example", "template"];
const RELATION_CONSERVATIVE_MODE = String(process.env.INTERNALIZE_RELATION_MODE || "conservative") === "conservative";
const RELATION_LLM_MAX_CANDIDATES = Math.max(1, Math.min(60, Number(process.env.INTERNALIZE_RELATION_LLM_MAX_CANDIDATES || 30)));
const RELATION_LLM_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.INTERNALIZE_LLM_CONCURRENCY || 5)));
const EMBED_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.INTERNALIZE_EMBED_CONCURRENCY || 5)));
const MAX_FALLBACK_RELATIONS_PER_NOTE = Math.max(
  0,
  Math.min(20, Number(process.env.INTERNALIZE_MAX_FALLBACK_RELATIONS_PER_NOTE || 6))
);
const RELATION_LLM_MIN_CONFIDENCE = Math.max(0.3, Math.min(0.95, Number(process.env.INTERNALIZE_RELATION_LLM_MIN_CONFIDENCE || 0.56)));
// When no LLM verdict is available (budget exhausted / call failed) on the embedding-recall
// path, only keep the lite-default edge if embedding similarity clears this higher floor.
const RELATION_LITE_SIMILARITY_FLOOR = Math.max(0.5, Math.min(0.95, Number(process.env.INTERNALIZE_RELATION_LITE_SIM_FLOOR || 0.72)));
const RELATION_TYPE_THRESHOLDS = {
  supports: Math.max(0.6, Math.min(0.95, Number(process.env.INTERNALIZE_RELATION_MIN_SUPPORTS || 0.7))),
  example_of: Math.max(0.6, Math.min(0.95, Number(process.env.INTERNALIZE_RELATION_MIN_EXAMPLE_OF || 0.68))),
  related: Math.max(0.45, Math.min(0.9, Number(process.env.INTERNALIZE_RELATION_MIN_RELATED || 0.58))),
  weak_related: Math.max(0.35, Math.min(0.8, Number(process.env.INTERNALIZE_RELATION_MIN_WEAK || 0.48))),
  fallback: Math.max(0.35, Math.min(0.8, Number(process.env.INTERNALIZE_RELATION_MIN_FALLBACK || 0.45))),
};

function isDeferredSummary(summary: string | null | undefined): boolean {
  const s = (summary || "").trim();
  if (!s) return false;
  return DEFERRED_SUMMARY_MARKERS.some((m) => s.includes(m));
}

function normalizedLength(value: string | null | undefined): number {
  return (value || "").replace(/\s+/g, "").length;
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of input) {
    const t = typeof x === "string" ? x.trim() : "";
    if (!t) continue;
    if (t === "-" || t === "—" || t === "暂无标签") continue;
    if (t.length < 2) continue;
    if (t.length > 20) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

function normalizeConcepts(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of input) {
    const t = typeof x === "string" ? x.replace(/[\uFFFD]/g, " ").replace(/\s+/g, " ").trim() : "";
    if (!t) continue;
    if (t === "-" || t === "—" || t === "暂无") continue;
    if (t.length < 2 || t.length > 24) continue;
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

function inferRelationTypeLite(args: {
  overlapCount: number;
  sourceTitle: string;
  sourceSummary: string;
  targetTitle: string;
  targetSummary: string;
}): "related" | "supports" | "example_of" {
  const blob = `${args.sourceTitle}\n${args.sourceSummary}\n${args.targetTitle}\n${args.targetSummary}`.toLowerCase();
  const hasExampleSignal = EXAMPLE_HINTS.some((h) => blob.includes(h));
  if (hasExampleSignal && args.overlapCount >= 1) return "example_of";
  if (args.overlapCount >= 2) return "supports";
  return "related";
}

function fallbackSummaryFromText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.slice(0, 120);
}

function heuristicTagsFromText(text: string, max = 6): string[] {
  const tokens = (text.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || [])
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 12);
  const stop = new Set(["我们", "你们", "这个", "那个", "以及", "可以", "进行", "需要", "通过", "对于", "其中", "一个", "一种", "什么", "如何", "然后", "已经"]);
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (stop.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}

function cleanMojibakeLite(text: string): string {
  return (text || "")
    .replace(/\uFFFD/g, " ")
    .replace(/[�]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TERM_NORMALIZE: Array<{ canonical: string; variants: string[] }> = [
  { canonical: "prompt", variants: ["prompt", "提示词", "提示语"] },
  { canonical: "ab测试", variants: ["a/b", "ab", "ab测试", "a-b", "a b", "a/b test", "ab test"] },
  { canonical: "agent", variants: ["agent", "智能体"] },
  { canonical: "rag", variants: ["rag", "检索增强"] },
  { canonical: "产品经理", variants: ["产品经理", "product manager", "pm"] },
  { canonical: "ai", variants: ["ai", "人工智能", "大模型", "llm", "模型"] },
  { canonical: "claude", variants: ["claude", "claude code"] },
];
const GENERIC_RELATION_TERMS = new Set(["prompt", "agent", "rag", "ab测试"]);
const DYNAMIC_TERM_MAX = Math.max(20, Math.min(120, Number(process.env.INTERNALIZE_DYNAMIC_TERM_MAX || 80)));
const DYNAMIC_TERM_MIN_FREQ = Math.max(2, Math.min(10, Number(process.env.INTERNALIZE_DYNAMIC_TERM_MIN_FREQ || 2)));

function normalizeTerm(input: string): string {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "").replace(/[\/\-_]/g, "");
  for (const row of TERM_NORMALIZE) {
    for (const v of row.variants) {
      const cv = v.toLowerCase().replace(/\s+/g, "").replace(/[\/\-_]/g, "");
      if (compact === cv || compact.includes(cv) || cv.includes(compact)) return row.canonical;
    }
  }
  return compact;
}

function extractNormalizedTerms(text: string, max = 48): string[] {
  const raw = String(text || "").toLowerCase();
  const tokens = raw.match(/[a-z0-9\u4e00-\u9fa5]{2,24}/g) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const n = normalizeTerm(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

async function buildUserDynamicLexicon(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  excludeNoteId?: string
): Promise<Set<string>> {
  const { data: rows } = await supabase
    .from("notes")
    .select("id, title, summary, tags, concepts")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(200);
  const freq = new Map<string, number>();
  for (const row of rows || []) {
    if (excludeNoteId && row.id === excludeNoteId) continue;
    const terms = new Set<string>([
      ...extractNormalizedTerms(String(row.title || ""), 18),
      ...extractNormalizedTerms(String(row.summary || ""), 18),
      ...((Array.isArray(row.tags) ? row.tags : []) as string[]).map((x) => normalizeTerm(String(x))).filter(Boolean),
      ...((Array.isArray(row.concepts) ? row.concepts : []) as string[]).map((x) => normalizeTerm(String(x))).filter(Boolean),
    ]);
    for (const t of terms) {
      if (!t || t.length < 2) continue;
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  const sorted = [...freq.entries()]
    .filter(([t, c]) => c >= DYNAMIC_TERM_MIN_FREQ && !GENERIC_RELATION_TERMS.has(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, DYNAMIC_TERM_MAX)
    .map(([t]) => t);
  return new Set(sorted);
}

function minConfidenceByType(type: string): number {
  if (type === "supports") return RELATION_TYPE_THRESHOLDS.supports;
  if (type === "example_of") return RELATION_TYPE_THRESHOLDS.example_of;
  if (type === "weak_related") return RELATION_TYPE_THRESHOLDS.weak_related;
  if (type === "fallback") return RELATION_TYPE_THRESHOLDS.fallback;
  return RELATION_TYPE_THRESHOLDS.related;
}

function hasStrongExampleSignal(textA: string, textB: string): boolean {
  const blob = `${textA}\n${textB}`.toLowerCase();
  return EXAMPLE_HINTS.some((h) => blob.includes(String(h).toLowerCase()));
}

function classifyFallbackRelationType(args: {
  sourceTitle: string;
  sourceSummary: string;
  targetTitle: string;
  targetSummary: string;
  sharedStructured: string[];
  keywordHits: string[];
  score: number;
}): "weak_related" | "fallback" {
  const shared = args.sharedStructured || [];
  const genericOnly =
    shared.length > 0 &&
    shared.every((x) => GENERIC_RELATION_TERMS.has(normalizeTerm(String(x))));
  const strongExample = hasStrongExampleSignal(
    `${args.sourceTitle}\n${args.sourceSummary}`,
    `${args.targetTitle}\n${args.targetSummary}`
  );
  if (strongExample && shared.length >= 2 && args.keywordHits.length >= 2 && args.score >= 7) return "weak_related";
  if (shared.length >= 2 && !genericOnly && args.score >= 6) return "weak_related";
  if (shared.length >= 1 || args.keywordHits.length >= 2) return "weak_related";
  return "fallback";
}

function buildInternalizeLayeredInput(args: {
  primarySourceText: string;
  supplementalText: string;
  userUnderstandingText: string;
  fallbackSummary: string;
  attachmentContext: string;
}) {
  const primary = args.primarySourceText.trim();
  const supplemental = args.supplementalText.trim();
  const userGuide = args.userUnderstandingText.trim();
  const fallbackSummary = args.fallbackSummary.trim();
  const attachmentContext = args.attachmentContext.trim();

  return [
    `### 原始正文主体\n${primary || "（无）"}`,
    supplemental ? `### 来源补充内容\n${supplemental}` : "",
    userGuide ? `### 用户理解引导\n${userGuide}` : "",
    fallbackSummary ? `### 过渡摘要（仅供参考）\n${fallbackSummary}` : "",
    attachmentContext ? `### 附件清单\n${attachmentContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function ensureInternalizeStructure(markdown: string, title: string): string {
  const canonicalSections = [
    "核心内容",
    "关键概念 / 关键信息",
    "原文支持要点（事实）",
    "推断与延展（非事实）",
    "可关联方向",
  ];
  const lines = markdown.split(/\r?\n/);
  const titleLine = lines.find((l) => /^#\s+/.test(l.trim())) || `# ${title || "未命名记录"}`;
  const sectionMap = new Map<string, string[]>();
  let currentKey: string | null = null;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const normalized = normalizeHeading(h2[1] || "");
      const matched = canonicalSections.find((x) => normalized.includes(normalizeHeading(x)));
      if (matched) {
        currentKey = matched;
        if (!sectionMap.has(matched)) sectionMap.set(matched, []);
      } else {
        currentKey = null;
      }
      continue;
    }
    if (!currentKey) continue;
    sectionMap.get(currentKey)!.push(line);
  }

  const blocks: string[] = [titleLine.trim()];
  for (const section of canonicalSections) {
    const raw = (sectionMap.get(section) || []).join("\n").trim();
    blocks.push(`## ${section}`);
    blocks.push(raw || "（未提取到该部分）");
  }
  return blocks.join("\n\n").trim();
}

function extractMarkdownSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const target = normalizeHeading(heading);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.+)$/);
    if (!m) continue;
    const current = normalizeHeading(m[1] || "");
    if (current.includes(target)) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return "";
  const buff: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    buff.push(lines[i]);
  }
  return buff.join("\n").trim();
}

function normalizeHeading(heading: string): string {
  return heading
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200D\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNoteChunksForRetrieval(markdown: string): string[] {
  const factSection = extractMarkdownSection(markdown, "原文支持要点（事实）");
  const coreSection = extractMarkdownSection(markdown, "核心内容");
  const conceptSection = extractMarkdownSection(markdown, "关键概念 / 关键信息");
  const inferSection = extractMarkdownSection(markdown, "推断与延展（非事实）");
  const relatedSection = extractMarkdownSection(markdown, "可关联方向");

  const factChunks = chunkSourceText(factSection, 700).map((x) => `[事实片段]\n${x}`);
  const coreChunks = chunkSourceText([coreSection, conceptSection].filter(Boolean).join("\n\n"), 900).map(
    (x) => `[内化片段]\n${x}`
  );
  const relationHintChunks = chunkSourceText(relatedSection, 700).map((x) => `[关联方向片段]\n${x}`);
  const tailChunks = chunkSourceText(inferSection, 900).map(
    (x) => `[延展片段]\n${x}`
  );

  // 排序即权重：事实/核心/关联方向优先，延展片段靠后，避免“推断污染建边”
  const merged = [...factChunks, ...coreChunks, ...relationHintChunks, ...tailChunks];
  const dedup: string[] = [];
  const seen = new Set<string>();
  for (const chunk of merged) {
    const key = chunk.replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedup.push(chunk.trim());
  }
  return dedup.slice(0, 30);
}

export async function POST(request: Request) {
  const traceId = randomUUID();
  let stage = "init";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      errorBody(ERROR_CODES.unauthorized, "Unauthorized", traceId),
      { status: 401 }
    );
  }

  const { captureItemId, dryRun = false, overrideMarkdown, includeVideo = false } = await request.json();
  if (!captureItemId) {
    return NextResponse.json(
      errorBody(ERROR_CODES.bad_request, "captureItemId is required", traceId),
      { status: 400 }
    );
  }

  const { data: item, error: itemError } = await supabase
    .from("capture_items")
    .select("*")
    .eq("id", captureItemId)
    .eq("user_id", user.id)
    .single();

  if (itemError || !item) {
    return NextResponse.json(
      errorBody(ERROR_CODES.not_found, "Capture item not found", traceId),
      { status: 404 }
    );
  }

  try {
    const parseDebug =
      item.parse_debug && typeof item.parse_debug === "object"
        ? (item.parse_debug as Record<string, unknown>)
        : {};
    console.info("[internalize] start", {
      trace_id: traceId,
      user_id: user.id,
      capture_item_id: item.id,
      dry_run: dryRun,
      parse_status: parseDebug.parse_status || "unknown",
      parse_error_code: parseDebug.parse_error_code || null,
    });

    stage = "load_attachments";
    const { data: attachments } = await supabase
      .from("attachments")
      .select("file_name, file_type, file_size, storage_path")
      .eq("capture_item_id", item.id)
      .eq("user_id", user.id);
    console.info("[internalize] attachments_loaded", {
      trace_id: traceId,
      capture_item_id: item.id,
      attachment_count: attachments?.length || 0,
    });

    const attachmentContext =
      attachments && attachments.length > 0
        ? attachments
            .map((a) => `${a.file_name}${a.file_type ? ` (${a.file_type})` : ""}`)
            .join("\n")
        : "";
    if (shouldRunDeferredRemoteImageOcr(parseDebug)) {
      stage = "deferred_remote_image_ocr";
      await materializeDeferredRemoteImageOcrSources(supabase, user.id, item.id, parseDebug);
    }
    const sourceRows = await loadCaptureSourceRows(supabase, user.id, item.id);
    const sourceContext = buildSourceContext(sourceRows);
    const attachmentParseDiag: string[] = [];
    let attachmentExtractedText = "";
    if (!sourceContext.hasEnoughPrimaryText) {
      attachmentExtractedText = await extractAttachmentTextForInternalize(
        supabase,
        user.id,
        (attachments || []) as Array<{
          file_name: string;
          file_type?: string | null;
          file_size?: number | null;
          storage_path?: string | null;
        }>,
        attachmentParseDiag
      );
    }

    const primarySourceText = sourceContext.primaryText || [item.raw_content?.trim() || "", attachmentExtractedText]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    const hasPrimarySourceText = normalizedLength(primarySourceText) >= MIN_INTERNALIZE_SOURCE_CHARS;
    if (!hasPrimarySourceText) {
      const parseStatus =
        typeof parseDebug.parse_status === "string" ? parseDebug.parse_status : "unknown";
      const parseErrorCode =
        typeof parseDebug.parse_error_code === "string" ? parseDebug.parse_error_code : "unknown";
      const message = `未读取到文档原文，已阻止内化。请先完成解析后重试（parse_status=${parseStatus}, parse_error_code=${parseErrorCode}）`;
      console.warn("[internalize] blocked_no_primary_source", {
        trace_id: traceId,
        user_id: user.id,
        capture_item_id: item.id,
        parse_status: parseStatus,
        parse_error_code: parseErrorCode,
        attachment_diag: attachmentParseDiag,
      });
      return NextResponse.json(
        errorBody(ERROR_CODES.no_internalize_content, message, traceId, {
          status: "error",
          parse_status: parseStatus,
          parse_error_code: parseErrorCode,
        }),
        { status: 422 }
      );
    }
    const sourceContent = buildInternalizeLayeredInput({
      primarySourceText,
      supplementalText: sourceContext.supplementalText,
      userUnderstandingText: sourceContext.userUnderstanding || item.my_understanding?.trim() || "",
      fallbackSummary: isDeferredSummary(item.summary) ? "" : (item.summary?.trim() || ""),
      attachmentContext,
    });

    let videoEnrichment = "";
    stage = "video_enrichment";
    if (includeVideo && item.type === "video" && item.source_url) {
      try {
        const videoPrompt = [
          "你是视频内容解析助手。",
          "请基于下面的页面文字信息、标题和链接，输出“视频补充解析”。",
          "要求：",
          "1) 只输出中文 markdown；",
          "2) 明确区分“可确定信息”和“推断信息”；",
          "3) 输出结构：## 视频补充解析 / ### 可确定信息 / ### 推断信息 / ### 可能的行动建议。",
          `标题：${item.title || "-"}`,
          `来源：${item.source || "-"}`,
          `链接：${item.source_url}`,
          `页面文本：\n${sourceContent || "无"}`,
        ].join("\n");

        videoEnrichment = await withRetry(
          () =>
            generateCompletion(
              "You are a careful video analysis assistant. Return Chinese markdown only.",
              videoPrompt,
              { temperature: 0.2, maxOutputTokens: 450, useCase: "internalize" }
            ),
          { attempts: 2, timeoutMs: 30000 }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "video_parse_failed";
        videoEnrichment = `## 视频补充解析\n\n视频补充解析失败：${msg}`;
      }
    }

    const internalizeInputBase = videoEnrichment
      ? `${sourceContent}\n\n${videoEnrichment}`
      : sourceContent;
    const internalizeInput = dryRun
      ? `${internalizeInputBase}\n\n[dry_run] 仅生成预览，不触发重解析。`
      : internalizeInputBase;

    const userPrompt = internalizeUserPrompt(item.title, item.source, internalizeInput, item.my_understanding);
    let generatedMarkdown = "";
    let generationError: string | null = null;
    stage = "generate_markdown";
    try {
      generatedMarkdown = await withRetry(
        () => generateCompletion(INTERNALIZE_SYSTEM, userPrompt, { useCase: "internalize" }),
        { attempts: 2, timeoutMs: 30000 }
      );
    } catch (err: unknown) {
      generationError = err instanceof Error ? err.message : "草稿生成失败";
      generatedMarkdown = `# ${item.title || "未命名记录"}\n\n## 核心内容\n${item.summary || "模型暂不可用，请手动补充核心内容。"}\n\n## 关键概念 / 关键信息\n- 待补充\n\n## 原文支持要点（事实）\n- 待补充\n\n## 推断与延展（非事实）\n- 待补充\n\n## 可关联方向\n- 待补充\n\n## 原始输入\n${internalizeInput}`;
    }
    if (videoEnrichment && generatedMarkdown && !generatedMarkdown.includes("## 视频补充解析")) {
      generatedMarkdown = `${generatedMarkdown}\n\n${videoEnrichment}`;
    }
    const markdownRaw = typeof overrideMarkdown === "string" && overrideMarkdown.trim().length > 0 ? overrideMarkdown.trim() : generatedMarkdown;
    const markdown = ensureInternalizeStructure(markdownRaw, item.title || "未命名记录");

    let concepts: string[] = [];
    stage = "extract_concepts";
    try {
      const conceptsRaw = await withRetry(
        () =>
          generateCompletion(
            "You are a concept extraction assistant. Return ONLY a JSON array of strings.",
            `${CONCEPT_EXTRACTION}\n\n内容:\n${markdown}`,
            { temperature: 0.1, maxOutputTokens: 200, useCase: "internalize" }
          ),
        { attempts: 2, timeoutMs: 25000 }
      );
      const parsed = JSON.parse(conceptsRaw.trim());
      if (Array.isArray(parsed)) concepts = normalizeConcepts(parsed);
    } catch {
      concepts = [];
    }
    if (concepts.length < 3) {
      stage = "extract_concepts_retry";
      try {
        const retryRaw = await withRetry(
          () =>
            generateCompletion(
              "你是概念抽取助手。只返回 JSON 数组，元素为2-20字中文术语，最多12个。",
              `从以下内容抽取概念，优先抽取“方法、指标、实体、流程名词”。\n\n标题：${item.title || ""}\n\n正文：\n${markdown.substring(0, 3200)}`,
              { temperature: 0.1, maxOutputTokens: 220, useCase: "internalize" }
            ),
          { attempts: 2, timeoutMs: 22000 }
        );
        const retryParsed = JSON.parse(retryRaw.trim());
        const retryConcepts = normalizeConcepts(retryParsed);
        if (retryConcepts.length > concepts.length) concepts = retryConcepts;
      } catch {
        // ignore and keep current concepts
      }
    }

    let summary = isDeferredSummary(item.summary) ? "" : (item.summary || "");
    const shouldGenerateSummary = !summary.trim();
    if (shouldGenerateSummary) {
      stage = "generate_summary";
      try {
        summary = await withRetry(
          () =>
            generateCompletion(
              "你是一个摘要助手。用一句简洁的中文总结核心要点。",
              `总结以下内容的核心要点：\n\n${markdown.substring(0, 2000)}`,
              { temperature: 0.1, maxOutputTokens: 100, useCase: "internalize" }
            ),
          { attempts: 2, timeoutMs: 20000 }
        );
      } catch {
        // keep fallback summary
      }
      if (!summary.trim()) {
        summary = fallbackSummaryFromText(markdown);
      }
    }
    summary = cleanMojibakeLite(summary || "");

    let generatedTags: string[] = normalizeTags(item.tags);
    const shouldGenerateTags = generatedTags.length === 0;
    if (shouldGenerateTags) {
      stage = "generate_tags";
      try {
        const tagsRaw = await withRetry(
          () =>
            generateCompletion(
              "你是标签提取助手。只返回 JSON 数组字符串，每个元素是 2-12 字的中文标签，最多 8 个。",
              `请根据以下内容提取标签：\n\n${markdown.substring(0, 2600)}`,
              { temperature: 0.1, maxOutputTokens: 140, useCase: "internalize" }
            ),
          { attempts: 2, timeoutMs: 20000 }
        );
        generatedTags = normalizeTags(JSON.parse(tagsRaw.trim()));
      } catch {
        generatedTags = normalizeTags(concepts);
      }
      if (!generatedTags.length) {
        generatedTags = heuristicTagsFromText(`${item.title || ""}\n${markdown}`);
      }
    }
    generatedTags = normalizeTags(generatedTags.map((x) => cleanMojibakeLite(x)));
    concepts = normalizeConcepts(concepts.map((x) => cleanMojibakeLite(x)));

    if (dryRun) {
      console.info("[internalize] dry_run_success", { trace_id: traceId, user_id: user.id, capture_item_id: item.id });
      return NextResponse.json(
        {
          draft: {
            title: item.title,
            content: markdown,
            summary: summary.trim(),
            concepts,
            tags: generatedTags,
            source: item.source,
            source_url: item.source_url || null,
            generation_error: generationError,
          },
          status: "success",
          trace_id: traceId,
        },
        { status: 200 }
      );
    }

    stage = "upsert_note";
    const notePayload = {
      user_id: user.id,
      capture_item_id: item.id,
      title: item.title,
      content: markdown,
      summary: summary.trim(),
      concepts,
      tags: generatedTags,
      source: item.source,
      source_url: item.source_url || null,
      updated_at: new Date().toISOString(),
    };
    const { data: existingNote } = await supabase
      .from("notes")
      .select("id")
      .eq("user_id", user.id)
      .eq("capture_item_id", item.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let note:
      | {
          id: string;
          title?: string | null;
          content?: string | null;
          summary?: string | null;
          source?: string | null;
          source_url?: string | null;
          capture_item_id?: string | null;
          created_at?: string;
        }
      | null = null;
    if (existingNote?.id) {
      const { data: updatedNote, error: updateErr } = await supabase
        .from("notes")
        .update(notePayload)
        .eq("id", existingNote.id)
        .eq("user_id", user.id)
        .select()
        .single();
      if (updateErr || !updatedNote) {
        return NextResponse.json(
          errorBody(
            ERROR_CODES.internalize_failed,
            updateErr?.message || "Failed to update note",
            traceId
          ),
          { status: 500 }
        );
      }
      note = updatedNote as any;
    } else {
      const { data: insertedNote, error: insertErr } = await supabase
        .from("notes")
        .insert(notePayload)
        .select()
        .single();
      if (insertErr || !insertedNote) {
        return NextResponse.json(
          errorBody(
            ERROR_CODES.internalize_failed,
            insertErr?.message || "Failed to create note",
            traceId
          ),
          { status: 500 }
        );
      }
      note = insertedNote as any;
    }
    if (!note) {
      return NextResponse.json(
        errorBody(ERROR_CODES.internalize_failed, "Failed to upsert note", traceId),
        { status: 500 }
      );
    }

    const chunks = buildNoteChunksForRetrieval(markdown);
    stage = "embed_chunks";
    // Re-internalize should refresh chunk set, avoiding stale duplicate retrieval vectors.
    await supabase.from("note_chunks").delete().eq("note_id", note.id).eq("user_id", user.id);
    // Embeddings are independent per chunk -> compute with bounded concurrency, then insert
    // in chunk_index order. A failed embedding leaves that slot null and is skipped.
    const noteChunkEmbeddings = await mapWithConcurrency(chunks, EMBED_CONCURRENCY, (chunk) =>
      withRetry(() => generateEmbedding(chunk), { attempts: 2, timeoutMs: 20000 })
    );
    for (let i = 0; i < chunks.length; i++) {
      const embedding = noteChunkEmbeddings[i];
      if (!embedding) continue;
      try {
        await supabase.from("note_chunks").insert({
          user_id: user.id,
          note_id: note.id,
          chunk_index: i,
          content: chunks[i],
          embedding: embedding as unknown as string,
          token_count: Math.ceil(chunks[i].length / 2),
        });
      } catch {
        // non-fatal
      }
    }

    stage = "embed_source_chunks";
    if (sourceRows.length > 0) {
      await rebuildSourceChunksBestEffort(supabase, user.id, item.id, sourceRows);
    }

    const relations: unknown[] = [];
    stage = "build_relations";
    try {
      // Re-internalize should regenerate outgoing auto edges from this note.
      await supabase
        .from("note_relations")
        .delete()
        .eq("user_id", user.id)
        .eq("source_note_id", note.id)
        .eq("is_auto_generated", true);

      let createdCount = 0;
      let embeddingRecallCandidates = 0;
      let fallbackUsed = false;
      let llmClassifiedCount = 0;
      let fallbackEdgesCount = 0;
      let embeddingOrLlmEdgesCount = 0;
      let semanticSeedCandidates = 0;
      let semanticSeedEdgesCount = 0;
      let strongEdgeCount = 0;
      let fallbackCompressed = false;
      const userDynamicLexicon = await buildUserDynamicLexicon(supabase, user.id, note.id);
      const chunkEmbeddings = await supabase
        .from("note_chunks")
        .select("chunk_index, content, embedding")
        .eq("note_id", note.id)
        .in("chunk_index", Array.from({ length: Math.max(RELATION_RECALL_CHUNK_COUNT * 2, 8) }, (_, i) => i))
        .order("chunk_index", { ascending: true });

      const embeddingRows =
        (chunkEmbeddings.data || [])
          .filter((r) => Boolean(r.embedding))
          .filter((r) => {
            const content = String((r as { content?: unknown }).content || "");
            // 关系召回优先“事实/核心/关联方向”，弱化“推断与延展”
            if (content.startsWith("[延展片段]")) return false;
            return true;
          })
          .slice(0, RELATION_RECALL_CHUNK_COUNT) as Array<{
          chunk_index: number;
          content: string;
          embedding: unknown;
        }>;

      if (embeddingRows.length > 0) {
        const mergedByNote = new Map<string, { note_id: string; similarity: number; source_chunk: number }>();
        for (const row of embeddingRows) {
          const { data: recallRows } = await supabase.rpc("match_note_chunks", {
            query_embedding: row.embedding,
            match_threshold: RELATION_MATCH_THRESHOLD,
            match_count: MAX_RELATIONS_PER_NOTE,
            p_user_id: user.id,
          });
          for (const r of (recallRows || []) as Array<{ note_id: string; similarity?: number }>) {
            if (!r.note_id || r.note_id === note.id) continue;
            const similarity = Number(r.similarity ?? 0);
            const prev = mergedByNote.get(r.note_id);
            if (!prev || similarity > prev.similarity) {
              mergedByNote.set(r.note_id, {
                note_id: r.note_id,
                similarity,
                source_chunk: row.chunk_index,
              });
            }
          }
        }
        // Retry with a relaxed threshold once when strict recall is empty.
        if (mergedByNote.size === 0) {
          for (const row of embeddingRows) {
            const { data: recallRows } = await supabase.rpc("match_note_chunks", {
              query_embedding: row.embedding,
              match_threshold: Math.max(0.45, RELATION_MATCH_THRESHOLD - 0.1),
              match_count: Math.min(120, MAX_RELATIONS_PER_NOTE * 3),
              p_user_id: user.id,
            });
            for (const r of (recallRows || []) as Array<{ note_id: string; similarity?: number }>) {
              if (!r.note_id || r.note_id === note.id) continue;
              const similarity = Number(r.similarity ?? 0);
              const prev = mergedByNote.get(r.note_id);
              if (!prev || similarity > prev.similarity) {
                mergedByNote.set(r.note_id, {
                  note_id: r.note_id,
                  similarity,
                  source_chunk: row.chunk_index,
                });
              }
            }
          }
        }

        const similar = Array.from(mergedByNote.values())
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, MAX_RELATIONS_PER_NOTE);
        embeddingRecallCandidates = similar.length;

        if (similar.length > 0) {
          const seenNoteIds = new Set<string>();
          const targetNoteIds = Array.from(
            new Set((similar as Array<{ note_id: string }>).map((x) => x.note_id).filter((id) => id && id !== note.id))
          ).slice(0, MAX_RELATIONS_PER_NOTE);
          const targetNoteMeta = new Map<
            string,
            { title: string | null; summary: string | null; tags: string[] | null; concepts: string[] | null }
          >();
          if (targetNoteIds.length > 0) {
            const { data: noteRows } = await supabase
              .from("notes")
              .select("id, title, summary, tags, concepts")
              .eq("user_id", user.id)
              .in("id", targetNoteIds);
            for (const row of noteRows || []) {
              targetNoteMeta.set(row.id, {
                title: row.title || null,
                summary: row.summary || null,
                tags: Array.isArray(row.tags) ? (row.tags as string[]) : null,
                concepts: Array.isArray(row.concepts) ? (row.concepts as string[]) : null,
              });
            }
          }

          const sourceKeywords = new Set<string>([
            ...(generatedTags || []).map((x) => normalizeTerm(String(x))).filter(Boolean),
            ...(Array.isArray(concepts) ? concepts : []).map((x) => normalizeTerm(String(x))).filter(Boolean),
          ]);

          // Build deduped, ordered candidate list (preserves original dedup + MAX cap).
          const orderedCandidates: Array<{ note_id: string; similarity: number; source_chunk: number }> = [];
          for (const match of similar as Array<{ note_id: string; similarity: number; source_chunk: number }>) {
            if (match.note_id === note.id || seenNoteIds.has(match.note_id)) continue;
            seenNoteIds.add(match.note_id);
            orderedCandidates.push(match);
            if (seenNoteIds.size >= MAX_RELATIONS_PER_NOTE) break;
          }

          // Precompute per-candidate derived data (pure CPU, no I/O).
          const prepped = orderedCandidates.map((match) => {
            const similarity = Number((match as { similarity?: number }).similarity ?? 0.72);
            const targetMeta = targetNoteMeta.get(match.note_id);
            const targetKeywords = new Set<string>([
              ...((targetMeta?.tags || []) as string[]).map((x) => normalizeTerm(String(x))).filter(Boolean),
              ...((targetMeta?.concepts || []) as string[]).map((x) => normalizeTerm(String(x))).filter(Boolean),
            ]);
            const overlap = [...sourceKeywords].filter((k) => targetKeywords.has(k)).slice(0, 3);
            const overlapCount = overlap.length;
            const liteType = inferRelationTypeLite({
              overlapCount,
              sourceTitle: note.title || "",
              sourceSummary: summary || "",
              targetTitle: targetMeta?.title || "",
              targetSummary: targetMeta?.summary || "",
            });
            const confidenceBase = overlapCount >= 2 ? similarity + 0.06 : similarity;
            const liteConfidence = Math.max(0.5, Math.min(0.98, confidenceBase));
            return { match, similarity, targetMeta, overlap, overlapCount, liteType, liteConfidence };
          });

          // Phase 1: concurrent LLM typing for the first `budget` candidates (bounded concurrency).
          const llmBudget = Math.max(0, RELATION_LLM_MAX_CANDIDATES - llmClassifiedCount);
          const llmTargets = prepped.slice(0, llmBudget);
          const decisions = await mapWithConcurrency(llmTargets, RELATION_LLM_CONCURRENCY, (p) =>
            classifyRelation({
              source: { title: note.title || "", summary: summary || "", tags: generatedTags || [], concepts: concepts || [] },
              target: {
                title: p.targetMeta?.title || "",
                summary: p.targetMeta?.summary || "",
                tags: p.targetMeta?.tags || [],
                concepts: p.targetMeta?.concepts || [],
              },
              recall: { similarity: p.similarity, overlap: p.overlap, keywordHits: [], sourceChunk: p.match.source_chunk },
              mode: RELATION_CONSERVATIVE_MODE ? "conservative" : "balanced",
            })
          );

          // Phase 2: serial apply (DB inserts + budget/dedup accounting), preserving original order/semantics.
          for (let pi = 0; pi < prepped.length; pi += 1) {
            const p = prepped[pi];
            const { match, similarity, targetMeta, overlap, overlapCount } = p;
            let relationType: "related" | "supports" | "example_of" | "weak_related" | "fallback" = p.liteType;
            let confidence = p.liteConfidence;
            let llmDecisionReason = "lite_fallback";
            let llmEvidenceSummary = "";
            const decision = pi < llmTargets.length ? decisions[pi] : null;
            if (decision) {
              llmClassifiedCount += 1;
              llmDecisionReason = decision.decision_reason || "llm_decision";
              llmEvidenceSummary = decision.evidence_summary || "";
              const typeFloor = minConfidenceByType(decision.relation_type);
              // LLM judgment has VETO power: do not build an edge when the model says the
              // notes are unrelated, or when its confidence is below the per-type threshold.
              // (Previously the edge was still inserted with the lite default, so related
              //  threshold never actually gated the embedding-recall path -> over-connection.)
              if (decision.relation_type === "none") {
                continue;
              }
              if (decision.confidence < Math.max(RELATION_LLM_MIN_CONFIDENCE, typeFloor)) {
                continue;
              }
              relationType = decision.relation_type;
              confidence = Math.max(0.45, Math.min(0.99, decision.confidence));
            } else {
              // No LLM verdict (budget exhausted or call failed): keep the lite default, but
              // require a higher embedding similarity floor so we don't blindly connect everything.
              if (similarity < RELATION_LITE_SIMILARITY_FLOOR) {
                continue;
              }
            }
            const evidenceSummaryParts = [
              `embedding相似度=${similarity.toFixed(3)}`,
              overlapCount > 0 ? `共享概念=${overlap.join("、")}` : "共享概念不足",
              targetMeta?.summary ? `目标摘要片段=${String(targetMeta.summary).slice(0, 80)}` : "目标摘要缺失",
              llmEvidenceSummary ? `LLM判据=${llmEvidenceSummary}` : "LLM判据=无",
            ];
            let rel: unknown = null;
            const insertPayload = {
              user_id: user.id,
              source_note_id: note.id,
              target_note_id: match.note_id,
              relation_type: relationType,
              confidence,
              evidence: {
                stage: "phase4_relation_generation",
                method: "embedding_similarity_plus_overlap",
                similarity,
                overlap_count: overlapCount,
                shared_concepts: overlap,
                llm_decision_reason: llmDecisionReason,
                source_chunk: match.source_chunk,
                recall_chunk_count: embeddingRows.length,
                match_threshold: RELATION_MATCH_THRESHOLD,
                evidence_summary: evidenceSummaryParts.join("；"),
              },
              is_auto_generated: true,
            };

            const insertNew = await supabase
              .from("note_relations")
              .insert(insertPayload)
              .select()
              .single();

            if (insertNew.error && String(insertNew.error.message || "").includes("column")) {
              const fallback = await supabase
                .from("note_relations")
                .insert({
                  user_id: user.id,
                  source_note_id: note.id,
                  target_note_id: match.note_id,
                  relation_type: relationType,
                })
                .select()
                .single();
              rel = fallback.data;
            } else {
              rel = insertNew.data;
            }

            if (rel) {
              relations.push(rel);
              createdCount += 1;
              embeddingOrLlmEdgesCount += 1;
            }
          }
        }
      }

      // Semantic-seed recall: when embedding recall is sparse/unstable, use lightweight
      // semantic candidates from note metadata and let LLM do strong relation typing.
      if (createdCount < MAX_RELATIONS_PER_NOTE && llmClassifiedCount < RELATION_LLM_MAX_CANDIDATES) {
        const existingTargets = new Set<string>();
        for (const r of relations as Array<{ target_note_id?: string }>) {
          if (r?.target_note_id) existingTargets.add(r.target_note_id);
        }

        const { data: seedRows } = await supabase
          .from("notes")
          .select("id, title, summary, tags, concepts")
          .eq("user_id", user.id)
          .neq("id", note.id)
          .order("created_at", { ascending: false })
          .limit(100);

        const sourceTitleTerms = extractNormalizedTerms(note.title || "", 24);
        const sourceSummaryTerms = extractNormalizedTerms(summary || "", 30);
        const sourceTagTerms = (generatedTags || []).map((x) => normalizeTerm(String(x))).filter(Boolean);
        const sourceConceptTerms = (Array.isArray(concepts) ? concepts : [])
          .map((x) => normalizeTerm(String(x)))
          .filter(Boolean);
        const sourceTerms = new Set<string>([
          ...sourceTitleTerms,
          ...sourceSummaryTerms,
          ...sourceTagTerms,
          ...sourceConceptTerms,
        ]);

        const seedScored = (seedRows || [])
          .map((row) => {
            const targetTitleTerms = extractNormalizedTerms(row.title || "", 24);
            const targetSummaryTerms = extractNormalizedTerms(row.summary || "", 30);
            const targetTagTerms = ((Array.isArray(row.tags) ? row.tags : []) as string[])
              .map((x) => normalizeTerm(String(x)))
              .filter(Boolean);
            const targetConceptTerms = ((Array.isArray(row.concepts) ? row.concepts : []) as string[])
              .map((x) => normalizeTerm(String(x)))
              .filter(Boolean);
            const targetTerms = new Set<string>([
              ...targetTitleTerms,
              ...targetSummaryTerms,
              ...targetTagTerms,
              ...targetConceptTerms,
            ]);
            const overlap = [...sourceTerms].filter((t) => targetTerms.has(t)).slice(0, 10);
            const nonGenericOverlap = overlap.filter((t) => !GENERIC_RELATION_TERMS.has(t));
            const titleOverlap = sourceTitleTerms.filter((t) => targetTitleTerms.includes(t)).slice(0, 4);
            const dynamicOverlap = overlap.filter((t) => userDynamicLexicon.has(t));
            const fallbackAiBoost = overlap.some((t) => ["ai", "agent", "claude", "prompt", "产品经理"].includes(t)) ? 1 : 0;
            // User dynamic lexicon dominates; fixed-term boost is fallback only.
            const score =
              dynamicOverlap.length * 3 +
              titleOverlap.length * 3 +
              nonGenericOverlap.length * 1.5 +
              Math.min(2, overlap.length) +
              fallbackAiBoost;
            return { row, score, overlap, nonGenericOverlap, titleOverlap, dynamicOverlap };
          })
          .filter((x) => x.score >= 2)
          .sort((a, b) => b.score - a.score)
          .slice(0, Math.min(20, MAX_RELATIONS_PER_NOTE));

        semanticSeedCandidates = seedScored.length;

        // Eligible = not already linked. LLM-classify up to the remaining budget concurrently,
        // then apply serially (insert + dual-cap accounting preserved).
        const seedEligible = seedScored.filter((s) => !existingTargets.has(s.row.id));
        const seedLlmBudget = Math.max(0, RELATION_LLM_MAX_CANDIDATES - llmClassifiedCount);
        const seedToClassify = seedEligible.slice(0, seedLlmBudget);
        const seedDecisions = await mapWithConcurrency(seedToClassify, RELATION_LLM_CONCURRENCY, (s) => {
          const pseudoSimilarity = Math.max(0.5, Math.min(0.86, 0.5 + s.score * 0.05));
          return classifyRelation({
            source: { title: note.title || "", summary: summary || "", tags: generatedTags || [], concepts: concepts || [] },
            target: {
              title: s.row.title || "",
              summary: s.row.summary || "",
              tags: Array.isArray(s.row.tags) ? (s.row.tags as string[]) : [],
              concepts: Array.isArray(s.row.concepts) ? (s.row.concepts as string[]) : [],
            },
            recall: {
              similarity: pseudoSimilarity,
              overlap: s.overlap,
              keywordHits: [...s.titleOverlap, ...s.nonGenericOverlap].slice(0, 4),
            },
            mode: RELATION_CONSERVATIVE_MODE ? "conservative" : "balanced",
          });
        });

        for (let si = 0; si < seedToClassify.length; si += 1) {
          if (createdCount >= MAX_RELATIONS_PER_NOTE) break;
          const s = seedToClassify[si];
          if (existingTargets.has(s.row.id)) continue;
          const decision = seedDecisions[si];
          if (!decision) continue;
          llmClassifiedCount += 1;

          // Semantic-seed path only accepts strong/medium relations, not weak/fallback.
          if (
            !["related", "supports", "example_of"].includes(decision.relation_type) ||
            decision.confidence < Math.max(RELATION_LLM_MIN_CONFIDENCE, minConfidenceByType(decision.relation_type))
          ) {
            continue;
          }

          const pseudoSimilarity = Math.max(0.5, Math.min(0.86, 0.5 + s.score * 0.05));
          try {
            const ins = await supabase
              .from("note_relations")
              .insert({
                user_id: user.id,
                source_note_id: note.id,
                target_note_id: s.row.id,
                relation_type: decision.relation_type,
                confidence: Math.max(0.45, Math.min(0.99, decision.confidence)),
                evidence: {
                  stage: "phase4_relation_generation",
                  method: "semantic_seed_llm",
                  seed_score: s.score,
                  similarity: pseudoSimilarity,
                  shared_concepts: s.overlap,
                  dynamic_overlap: s.dynamicOverlap,
                  evidence_summary: decision.evidence_summary || `语义种子候选重排命中（score=${s.score}）`,
                },
                is_auto_generated: true,
              })
              .select()
              .single();

            if (ins.data) {
              relations.push(ins.data);
              createdCount += 1;
              embeddingOrLlmEdgesCount += 1;
              semanticSeedEdgesCount += 1;
              existingTargets.add(s.row.id);
            }
          } catch {
            // keep best-effort
          }
        }
      }

      // Fallback supplement: build lightweight links from structured overlap signals.
      // This helps construct a broader knowledge network while keeping confidence layered.
      if (createdCount < MAX_RELATIONS_PER_NOTE) {
        fallbackUsed = true;
        // Conditional compression: only tighten fallback when this note already has
        // strong edges (related/supports/example_of). When there are no strong edges,
        // keep the looser fallback so the graph does not collapse to "node with no edge".
        const STRONG_TYPES = new Set(["related", "supports", "example_of"]);
        strongEdgeCount = (relations as Array<{ relation_type?: string }>).filter((r) =>
          STRONG_TYPES.has(String(r?.relation_type || ""))
        ).length;
        fallbackCompressed = strongEdgeCount > 0;
        const fallbackMinScore = fallbackCompressed ? 4 : 3;
        const fallbackCap = fallbackCompressed
          ? Math.max(0, Math.min(3, MAX_FALLBACK_RELATIONS_PER_NOTE))
          : MAX_FALLBACK_RELATIONS_PER_NOTE;
        const existingTargets = new Set<string>();
        for (const r of relations as Array<{ target_note_id?: string }>) {
          if (r?.target_note_id) existingTargets.add(r.target_note_id);
        }
        const { data: candidateRows } = await supabase
          .from("notes")
          .select("id, title, summary, tags, concepts")
          .eq("user_id", user.id)
          .neq("id", note.id)
          .order("created_at", { ascending: false })
          .limit(40);

        const normalize = (x: string) => normalizeTerm(x);
        const sourceTerms = new Set<string>([
          ...(generatedTags || []).map((x) => normalize(String(x))).filter(Boolean),
          ...(Array.isArray(concepts) ? concepts : []).map((x) => normalize(String(x))).filter(Boolean),
        ]);

        const sourceText = `${note.title || ""}\n${summary || ""}`.toLowerCase();
        const textTerms = Array.from(
          new Set((sourceText.match(/[\u4e00-\u9fa5a-z0-9]{2,16}/g) || []).map((x) => x.trim()).filter(Boolean))
        ).slice(0, 24);

        const scored = (candidateRows || [])
          .map((row) => {
            const targetTerms = new Set<string>([
              ...((Array.isArray(row.tags) ? row.tags : []) as string[]).map((x) => normalize(String(x))).filter(Boolean),
              ...((Array.isArray(row.concepts) ? row.concepts : []) as string[])
                .map((x) => normalize(String(x)))
                .filter(Boolean),
            ]);
            const sharedStructured = [...sourceTerms].filter((t) => targetTerms.has(t)).slice(0, 4);

            const targetText = `${row.title || ""}\n${row.summary || ""}`.toLowerCase();
            const keywordHits = textTerms.filter((t) => t.length >= 2 && targetText.includes(t)).slice(0, 5);

            const score = sharedStructured.length * 2 + keywordHits.length;
            return { row, score, sharedStructured, keywordHits };
          })
          .filter((x) => x.score >= fallbackMinScore)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_RELATIONS_PER_NOTE);

        const fallbackBudget = Math.max(
          0,
          Math.min(
            fallbackCap,
            MAX_RELATIONS_PER_NOTE - createdCount
          )
        );
        let fallbackInserted = 0;

        for (const item2 of scored) {
          if (existingTargets.has(item2.row.id)) continue;
          if (createdCount >= MAX_RELATIONS_PER_NOTE) break;
          if (fallbackInserted >= fallbackBudget) break;
          const hasFallbackEvidence = item2.sharedStructured.length >= 1 || item2.keywordHits.length >= 2;
          if (!hasFallbackEvidence) continue;
          const confidence = Math.min(0.82, 0.5 + item2.score * 0.05);
          const relationType = classifyFallbackRelationType({
            sourceTitle: note.title || "",
            sourceSummary: summary || "",
            targetTitle: item2.row.title || "",
            targetSummary: item2.row.summary || "",
            sharedStructured: item2.sharedStructured,
            keywordHits: item2.keywordHits,
            score: item2.score,
          });
          if (
            relationType === "fallback" &&
            confidence < RELATION_TYPE_THRESHOLDS.fallback
          ) {
            continue;
          }
          const evidenceSummary = [
            `结构重叠=${item2.sharedStructured.join("、") || "无"}`,
            `关键词命中=${item2.keywordHits.join("、") || "无"}`,
            `判定来源=非向量兜底粗筛(${relationType})`,
          ].join("；");

          const ins = await supabase
            .from("note_relations")
            .insert({
              user_id: user.id,
              source_note_id: note.id,
              target_note_id: item2.row.id,
              relation_type: relationType,
              confidence,
              evidence: {
                stage: "phase4_relation_generation",
                method: "structured_overlap_fallback",
                shared_concepts: item2.sharedStructured,
                keyword_hits: item2.keywordHits,
                evidence_summary: evidenceSummary,
              },
              is_auto_generated: true,
            })
            .select()
            .single();
          if (ins.data) {
            relations.push(ins.data);
            createdCount += 1;
            existingTargets.add(item2.row.id);
            fallbackEdgesCount += 1;
            fallbackInserted += 1;
          }
        }

      }
      console.info("[internalize] relation_diagnostics", {
        trace_id: traceId,
        capture_item_id: item.id,
        note_id: note.id,
        embedding_recall_candidates: embeddingRecallCandidates,
        user_dynamic_lexicon_size: userDynamicLexicon.size,
        semantic_seed_candidates: semanticSeedCandidates,
        semantic_seed_edges_count: semanticSeedEdgesCount,
        llm_classified_count: llmClassifiedCount,
        llm_max_candidates: RELATION_LLM_MAX_CANDIDATES,
        embedding_or_llm_edges_count: embeddingOrLlmEdgesCount,
        fallback_edges_count: fallbackEdgesCount,
        strong_edge_count: strongEdgeCount,
        fallback_compressed: fallbackCompressed,
        fallback_used: fallbackUsed,
        final_relations_count: createdCount,
      });
    } catch {
      // non-fatal
    }

    stage = "update_capture_status";
    await supabase
      .from("capture_items")
      .update({
        status: "crystallized",
        summary: summary.trim() || item.summary,
        tags: generatedTags,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("user_id", user.id);

    console.info("[internalize] success", {
      trace_id: traceId,
      user_id: user.id,
      capture_item_id: item.id,
      note_id: note.id,
      chunk_count: chunks.length,
      relation_count: relations.length,
      relation_recall_chunk_count: RELATION_RECALL_CHUNK_COUNT,
      relation_match_threshold: RELATION_MATCH_THRESHOLD,
      relation_max_per_note: MAX_RELATIONS_PER_NOTE,
    });

    return NextResponse.json({ note, relations, concepts, status: "success", trace_id: traceId }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internalization failed";
    console.error("[internalize] failed", {
      trace_id: traceId,
      user_id: user.id,
      capture_item_id: item.id,
      stage,
      error: message,
    });
    return NextResponse.json(
      errorBody(ERROR_CODES.internalize_failed, `${stage}: ${message}`, traceId, { status: "error" }),
      { status: 500 }
    );
  }
}

async function loadCaptureSourceRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  captureItemId: string
): Promise<CaptureSourceRow[]> {
  const isOptionalSourceInfraError = (message: string) => {
    const m = message.toLowerCase();
    return (
      (m.includes("capture_item_sources") || m.includes("source_chunks")) &&
      (
        m.includes("does not exist") ||
        m.includes("schema cache") ||
        m.includes("relationship") ||
        m.includes("could not find a relationship")
      )
    );
  };

  const result = await supabase
    .from("capture_item_sources")
    .select("id, source_type, source_label, source_ref, source_url, content, is_primary, parse_status, metadata")
    .eq("user_id", userId)
    .eq("capture_item_id", captureItemId)
    .order("created_at", { ascending: true });

  if (result.error && isOptionalSourceInfraError(String(result.error.message || ""))) {
    return [];
  }
  if (result.error) {
    throw result.error;
  }
  return (result.data || []) as CaptureSourceRow[];
}

function buildSourceContext(rows: CaptureSourceRow[]) {
  const objectiveRows = rows.filter((row) => row.source_type !== "user_understanding" && row.content?.trim());
  const primaryRows = objectiveRows.filter((row) => row.is_primary);
  const effectivePrimary = primaryRows.length > 0 ? primaryRows : objectiveRows.slice(0, 1);
  const supplementalRows = objectiveRows.filter((row) => !effectivePrimary.some((primary) => primary.id === row.id));
  const userUnderstanding = rows
    .filter((row) => row.source_type === "user_understanding")
    .map((row) => row.content.trim())
    .filter(Boolean)
    .join("\n\n");

  const primaryText = effectivePrimary.map((row) => row.content.trim()).filter(Boolean).join("\n\n").trim();
  const supplementalText = supplementalRows
    .map((row) => {
      const label = row.source_label || row.source_type;
      return `来源补充（${label}）:\n${row.content.trim()}`;
    })
    .join("\n\n")
    .trim();

  return {
    primaryText,
    supplementalText,
    userUnderstanding,
    hasEnoughPrimaryText: normalizedLength(primaryText) >= MIN_INTERNALIZE_SOURCE_CHARS,
  };
}

async function rebuildSourceChunksBestEffort(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  captureItemId: string,
  sourceRows: CaptureSourceRow[]
) {
  try {
    const deleteResult = await supabase.from("source_chunks").delete().eq("user_id", userId).eq("capture_item_id", captureItemId);
    if (deleteResult.error) {
      const msg = String(deleteResult.error.message || "").toLowerCase();
      if (msg.includes("source_chunks") && (msg.includes("does not exist") || msg.includes("schema cache"))) {
        return;
      }
      return;
    }
  } catch {
    return;
  }

  for (const row of sourceRows) {
    if (!row.content?.trim()) continue;
    const chunks = chunkSourceText(row.content);
    // Compute embeddings with bounded concurrency, then insert in chunk_index order.
    const embeddings = await mapWithConcurrency(chunks, EMBED_CONCURRENCY, (chunk) =>
      withRetry(() => generateEmbedding(chunk), { attempts: 2, timeoutMs: 20000 })
    );
    for (let i = 0; i < chunks.length; i += 1) {
      const embedding = embeddings[i];
      if (!embedding) continue;
      try {
        const insertResult = await supabase.from("source_chunks").insert({
          user_id: userId,
          capture_item_id: captureItemId,
          capture_item_source_id: row.id,
          chunk_index: i,
          content: chunks[i],
          embedding: embedding as unknown as string,
          token_count: Math.ceil(chunks[i].length / 2),
        });
        if (insertResult.error) {
          const msg = String(insertResult.error.message || "").toLowerCase();
          if (msg.includes("source_chunks") && (msg.includes("does not exist") || msg.includes("schema cache"))) {
            return;
          }
        }
      } catch {
        // best effort only
      }
    }
  }
}

function chunkSourceText(text: string, maxChars = 900): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if ((current + "\n\n" + paragraph).length > maxChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = `${current}\n\n${paragraph}`;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  if (!chunks.length && text.trim()) {
    const trimmed = text.trim();
    for (let i = 0; i < trimmed.length; i += maxChars) {
      chunks.push(trimmed.slice(i, i + maxChars));
    }
  }
  return chunks.filter((chunk) => chunk.length > 20).slice(0, 24);
}

function shouldRunDeferredRemoteImageOcr(parseDebug: Record<string, unknown>): boolean {
  return (
    parseDebug.url_platform === "xiaohongshu" &&
    parseDebug.image_ocr_deferred === true &&
    Array.isArray(parseDebug.deferred_image_urls) &&
    parseDebug.deferred_image_urls.length > XIAOHONGSHU_INLINE_OCR_LIMIT
  );
}

async function fetchRemoteImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://www.xiaohongshu.com/",
      },
    });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") || "image/jpeg";
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

async function materializeDeferredRemoteImageOcrSources(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  captureItemId: string,
  parseDebug: Record<string, unknown>
) {
  const imageUrls = Array.isArray(parseDebug.deferred_image_urls)
    ? parseDebug.deferred_image_urls.filter((x): x is string => typeof x === "string")
    : [];
  if (imageUrls.length === 0) return;

  try {
    await supabase
      .from("capture_item_sources")
      .delete()
      .eq("user_id", userId)
      .eq("capture_item_id", captureItemId)
      .eq("source_type", "image_ocr")
      .like("source_ref", "remote_url:%");
  } catch {
    return;
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < imageUrls.length; i += 1) {
    const remoteUrl = imageUrls[i];
    try {
      const dataUrl = await fetchRemoteImageAsDataUrl(remoteUrl);
      if (!dataUrl) continue;
      const text = await extractTextFromImageDataUrl(dataUrl);
      if (!text?.trim()) continue;
      rows.push({
        capture_item_id: captureItemId,
        user_id: userId,
        source_type: "image_ocr",
        source_label: `xhs_image_${i + 1}`,
        source_ref: `remote_url:${remoteUrl}`,
        source_url: remoteUrl,
        content: text.trim().slice(0, 4000),
        is_primary: false,
        parse_status: "success",
        metadata: {
          origin: "remote_url",
          remote_url: remoteUrl,
          image_index: i + 1,
          platform: "xiaohongshu",
          deferred_from_capture: true,
        },
      });
    } catch {
      // best effort only
    }
  }

  if (rows.length === 0) return;

  try {
    await supabase.from("capture_item_sources").insert(rows);
  } catch {
    // optional infra
  }
}

async function extractAttachmentTextForInternalize(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  attachments: Array<{
    file_name: string;
    file_type?: string | null;
    file_size?: number | null;
    storage_path?: string | null;
  }>,
  diagnostics: string[]
): Promise<string> {
  if (!attachments.length) return "";
  const chunks: string[] = [];
  diagnostics.push(`attachments_total:${attachments.length}`);
  for (const a of attachments.slice(0, 4)) {
    const path = a.storage_path || "";
    if (!path) continue;
    const name = a.file_name || "attachment";
    const lower = name.toLowerCase();
    const mime = a.file_type || "application/octet-stream";
    const isDoc =
      lower.endsWith(".pdf") ||
      lower.endsWith(".docx") ||
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".markdown") ||
      lower.endsWith(".csv") ||
      lower.endsWith(".json") ||
      lower.endsWith(".yaml") ||
      lower.endsWith(".yml") ||
      mime.startsWith("text/");
    if (!isDoc) continue;
    diagnostics.push(`attachment_try:${name}`);

    try {
      let fileBytes: Buffer | null = null;
      if (lower.endsWith(".pdf")) {
        const byService = await parsePdfByServiceFromUrl(path, name, mime);
        if (byService) {
          chunks.push(byService.slice(0, 12000));
          diagnostics.push(`pdf_service_ok:${name}:${byService.length}`);
          continue;
        }
        diagnostics.push(`pdf_service_empty_or_fail:${name}`);
      }
      const byUrl = await fetchBytesFromStoragePath(path);
      if (byUrl.ok && byUrl.bytes) {
        diagnostics.push(`fetch_url_ok:${name}:${byUrl.bytes.length}`);
        fileBytes = byUrl.bytes;
      } else {
        diagnostics.push(`fetch_url_fail:${name}:${!byUrl.ok ? byUrl.reason : "unknown"}`);
      }

      if (!fileBytes) {
        const byStorage = await downloadAttachmentViaStorage(supabase, userId, path);
        if (byStorage.ok && byStorage.bytes) {
          diagnostics.push(`storage_download_ok:${name}:${byStorage.bytes.length}`);
          fileBytes = byStorage.bytes;
        } else {
          diagnostics.push(
            `storage_download_fail:${name}:${!byStorage.ok ? byStorage.reason : "unknown"}`
          );
        }
      }

      if (!fileBytes) continue;
      const file = new File([new Uint8Array(fileBytes)], name, { type: mime });
      const extracted = await extractDocumentTextDetailed(file);
      const text = extracted.text?.trim() || "";
      if (text) {
        chunks.push(text.slice(0, 12000));
        diagnostics.push(`extract_ok:${name}:${text.length}`);
      } else {
        diagnostics.push(`extract_empty:${name}`);
      }
    } catch {
      diagnostics.push(`extract_exception:${name}`);
    }
  }
  return chunks.join("\n\n").trim();
}

async function fetchBytesFromStoragePath(
  path: string
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: string }> {
  try {
    if (!(path.startsWith("http://") || path.startsWith("https://"))) {
      return { ok: false, reason: "not_url" };
    }
    const res = await fetch(path);
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return { ok: true, bytes: Buffer.from(await res.arrayBuffer()) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch_error";
    return { ok: false, reason: msg.slice(0, 120) };
  }
}

async function downloadAttachmentViaStorage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  path: string
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: string }> {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "capture-files";
  const normalized = normalizeStorageObjectPath(path, userId);
  if (!normalized) return { ok: false, reason: "path_unresolved" };
  try {
    const { data, error } = await supabase.storage.from(bucket).download(normalized);
    if (error || !data) return { ok: false, reason: error?.message || "download_failed" };
    return { ok: true, bytes: Buffer.from(await data.arrayBuffer()) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "download_exception";
    return { ok: false, reason: msg.slice(0, 120) };
  }
}

function normalizeStorageObjectPath(path: string, userId: string): string | null {
  const raw = (path || "").trim();
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const marker = "/object/public/";
    const idx = raw.indexOf(marker);
    if (idx >= 0) {
      const rest = raw.slice(idx + marker.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) return rest.slice(slash + 1);
    }
    return null;
  }
  if (raw.startsWith(`${userId}/`)) return raw;
  return raw;
}

async function parsePdfByServiceFromUrl(fileUrl: string, fileName: string, mime: string): Promise<string | null> {
  const base = process.env.PARSER_SERVICE_URL?.trim();
  if (!base) return null;
  try {
    const src = await fetch(fileUrl);
    if (!src.ok) return null;
    const data = await src.arrayBuffer();
    const form = new FormData();
    form.append("file", new File([data], fileName || "file.pdf", { type: mime || "application/pdf" }));
    form.append("ocr", "0");
    const res = await fetch(`${base.replace(/\/$/, "")}/parse/pdf`, { method: "POST", body: form });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    const text = typeof json?.text === "string" ? json.text.trim() : "";
    return text || null;
  } catch {
    return null;
  }
}

function chunkMarkdown(markdown: string, maxWords = 500): string[] {
  const sections = markdown.split(/\n(?=#{2,3}\s)/);
  const chunks: string[] = [];

  for (const section of sections) {
    const words = section.split(/\s+/);
    if (words.length <= maxWords) {
      if (section.trim()) chunks.push(section.trim());
    } else {
      const paragraphs = section.split(/\n\s*\n/);
      let current = "";
      for (const para of paragraphs) {
        if ((current + para).split(/\s+/).length > maxWords && current) {
          chunks.push(current.trim());
          current = para;
        } else {
          current += (current ? "\n\n" : "") + para;
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }
  return chunks.filter((c) => c.length > 10);
}
