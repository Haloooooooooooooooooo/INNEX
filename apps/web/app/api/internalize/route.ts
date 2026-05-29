import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { extractTextFromImageDataUrl, generateCompletion, generateEmbedding } from "@/lib/llm/client";
import { ERROR_CODES, errorBody } from "@/lib/api/error-codes";
import { withRetry } from "@/lib/llm/resilience";
import { extractDocumentTextDetailed } from "@/lib/parse/document-extractor";
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
  const tailChunks = chunkSourceText([inferSection, relatedSection].filter(Boolean).join("\n\n"), 900).map(
    (x) => `[延展片段]\n${x}`
  );

  const merged = [...factChunks, ...coreChunks, ...tailChunks];
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
      if (Array.isArray(parsed)) concepts = parsed;
    } catch {
      concepts = [];
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

    stage = "insert_note";
    const { data: note, error: noteError } = await supabase
      .from("notes")
      .insert({
        user_id: user.id,
        capture_item_id: item.id,
        title: item.title,
        content: markdown,
        summary: summary.trim(),
        concepts,
        tags: generatedTags,
        source: item.source,
        source_url: item.source_url || null,
      })
      .select()
      .single();

    if (noteError || !note) {
      return NextResponse.json(
        errorBody(
          ERROR_CODES.internalize_failed,
          noteError?.message || "Failed to create note",
          traceId
        ),
        { status: 500 }
      );
    }

    const chunks = buildNoteChunksForRetrieval(markdown);
    stage = "embed_chunks";
    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await withRetry(() => generateEmbedding(chunks[i]), {
          attempts: 2,
          timeoutMs: 20000,
        });
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
      const firstChunk = await supabase
        .from("note_chunks")
        .select("embedding")
        .eq("note_id", note.id)
        .eq("chunk_index", 0)
        .single();

      if (firstChunk?.data?.embedding) {
        const { data: similar } = await supabase.rpc("match_note_chunks", {
          query_embedding: firstChunk.data.embedding,
          match_threshold: 0.7,
          match_count: 5,
          p_user_id: user.id,
        });

        if (similar) {
          const seenNoteIds = new Set<string>();
          const targetNoteIds = Array.from(
            new Set((similar as Array<{ note_id: string }>).map((x) => x.note_id).filter((id) => id && id !== note.id))
          ).slice(0, 12);
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
            ...(generatedTags || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean),
            ...(Array.isArray(concepts) ? concepts : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean),
          ]);

          for (const match of similar as Array<{ note_id: string }>) {
            if (match.note_id === note.id || seenNoteIds.has(match.note_id)) continue;
            seenNoteIds.add(match.note_id);

            const similarity = Number((match as { similarity?: number }).similarity ?? 0.72);
            const targetMeta = targetNoteMeta.get(match.note_id);
            const targetKeywords = new Set<string>([
              ...((targetMeta?.tags || []) as string[]).map((x) => String(x).trim().toLowerCase()).filter(Boolean),
              ...((targetMeta?.concepts || []) as string[]).map((x) => String(x).trim().toLowerCase()).filter(Boolean),
            ]);
            const overlap = [...sourceKeywords].filter((k) => targetKeywords.has(k)).slice(0, 3);
            const overlapCount = overlap.length;
            const relationType = overlapCount >= 2 ? "supports" : "related";
            const confidenceBase = overlapCount >= 2 ? similarity + 0.06 : similarity;
            const confidence = Math.max(0.5, Math.min(0.98, confidenceBase));
            const evidenceSummaryParts = [
              `embedding相似度=${similarity.toFixed(3)}`,
              overlapCount > 0 ? `共享概念=${overlap.join("、")}` : "共享概念不足",
              targetMeta?.summary ? `目标摘要片段=${String(targetMeta.summary).slice(0, 80)}` : "目标摘要缺失",
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
                source_chunk: 0,
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

            if (rel) relations.push(rel);
            if (seenNoteIds.size >= 5) break;
          }
        }
      }
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
    for (let i = 0; i < chunks.length; i += 1) {
      try {
        const embedding = await withRetry(() => generateEmbedding(chunks[i]), {
          attempts: 2,
          timeoutMs: 20000,
        });
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
