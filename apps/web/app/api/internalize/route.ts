import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generateCompletion, generateEmbedding } from "@/lib/llm/client";
import { ERROR_CODES, errorBody } from "@/lib/api/error-codes";
import { withRetry } from "@/lib/llm/resilience";
import { extractDocumentTextDetailed } from "@/lib/parse/document-extractor";
import {
  INTERNALIZE_SYSTEM,
  internalizeUserPrompt,
  CONCEPT_EXTRACTION,
} from "@/lib/llm/prompts";

const DEFERRED_SUMMARY_MARKERS = [
  "文件超过录入解析阈值，已先完成收录。请在内化阶段继续解析。",
  "Document is large. Summary will be available after processing.",
];
const MIN_INTERNALIZE_SOURCE_CHARS = 120;

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
    const attachmentParseDiag: string[] = [];
    const attachmentExtractedText = await extractAttachmentTextForInternalize(
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

    const primarySourceText = [item.raw_content?.trim() || "", attachmentExtractedText]
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
    const sourceContent = [
      primarySourceText,
      isDeferredSummary(item.summary) ? "" : (item.summary?.trim() || ""),
      item.my_understanding?.trim() || "",
      attachmentContext ? `附件列表:\n${attachmentContext}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

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
      generatedMarkdown = `# ${item.title || "未命名记录"}\n\n## 摘要\n${item.summary || "模型暂不可用，请手动补充摘要。"}\n\n## 我的理解\n${item.my_understanding || ""}\n\n## 原始内容\n${internalizeInput}`;
    }
    if (videoEnrichment && generatedMarkdown && !generatedMarkdown.includes("## 视频补充解析")) {
      generatedMarkdown = `${generatedMarkdown}\n\n${videoEnrichment}`;
    }
    const markdown = typeof overrideMarkdown === "string" && overrideMarkdown.trim().length > 0 ? overrideMarkdown.trim() : generatedMarkdown;

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

    const chunks = chunkMarkdown(markdown);
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
          for (const match of similar as Array<{ note_id: string }>) {
            if (match.note_id === note.id || seenNoteIds.has(match.note_id)) continue;
            seenNoteIds.add(match.note_id);

            const similarity = Number((match as { similarity?: number }).similarity ?? 0.72);
            const confidence = Math.max(0.5, Math.min(0.98, similarity));
            let rel: unknown = null;
            const insertPayload = {
              user_id: user.id,
              source_note_id: note.id,
              target_note_id: match.note_id,
              relation_type: "related",
              confidence,
              evidence: {
                method: "embedding_similarity",
                similarity,
                source_chunk: 0,
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
                  relation_type: "related",
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
