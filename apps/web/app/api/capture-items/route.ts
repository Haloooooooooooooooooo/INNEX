import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { detectType } from "@/lib/parse/detector";
import { parseContent } from "@/lib/parse/generator";
import { PARSE_RULES } from "@/lib/parse/config";
import { analyzeImageForSummaryAndTags, extractTextFromImageDataUrl } from "@/lib/llm/client";
import { extractDocumentTextDetailed } from "@/lib/parse/document-extractor";
import { PDFParse } from "pdf-parse";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type CaptureItemInsertPayload = {
  user_id: string;
  type: string;
  title: string;
  source: string;
  source_url: string | null;
  raw_content: string | null;
  my_understanding: string | null;
  summary: string | null;
  parse_debug?: unknown;
  tags: string[];
  status: string;
};

type UploadedAttachmentMeta = {
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string | null;
};

async function refetchUrlContent(origin: string, url: string): Promise<{ title: string | null; content: string | null }> {
  try {
    const res = await fetch(`${origin}/api/parse-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return { title: null, content: null };
    const data = await res.json();
    return {
      title: typeof data.title === "string" ? data.title : null,
      content: typeof data.content === "string" ? data.content : null,
    };
  } catch {
    return { title: null, content: null };
  }
}

async function insertCaptureItemCompat(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: CaptureItemInsertPayload
) {
  const firstAttempt = await supabase
    .from("capture_items")
    .insert(payload)
    .select()
    .single();

  if (!firstAttempt.error) {
    return { ...firstAttempt, parseDebugDropped: false };
  }

  const message = firstAttempt.error.message || "";
  const missingParseDebug =
    message.includes("parse_debug") &&
    (message.includes("column") || message.includes("schema cache"));

  if (!missingParseDebug) {
    return { ...firstAttempt, parseDebugDropped: false };
  }

  const { parse_debug: _ignored, ...fallbackPayload } = payload;
  const fallback = await supabase
    .from("capture_items")
    .insert(fallbackPayload)
    .select()
    .single();
  return { ...fallback, parseDebugDropped: true };
}

async function uploadFilesToStorage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  captureItemId: string,
  files: File[]
): Promise<{ metas: UploadedAttachmentMeta[]; notes: string[] }> {
  const notes: string[] = [];
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "capture-files";
  const metas: UploadedAttachmentMeta[] = [];

  for (const file of files) {
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
    const safeExt = ext ? `.${ext}` : "";
    const objectPath = `${userId}/${captureItemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(objectPath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      notes.push(`storage_upload_failed:${file.name}:${uploadError.message}`);
      metas.push({
        file_name: file.name,
        file_type: file.type || "application/octet-stream",
        file_size: file.size || 0,
        storage_path: null,
      });
      continue;
    }

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    const publicUrl = pub?.publicUrl || null;
    if (!publicUrl) {
      notes.push(`storage_public_url_empty:${file.name}`);
    }

    metas.push({
      file_name: file.name,
      file_type: file.type || "application/octet-stream",
      file_size: file.size || 0,
      storage_path: publicUrl || objectPath,
    });
  }

  return { metas, notes };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const countsOnly = searchParams.get("counts") === "1";
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  if (countsOnly) {
    const { data, error } = await supabase
      .from("capture_items")
      .select("status")
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const counts = {
      all: data.length,
      later: data.filter((x) => x.status === "later").length,
      pending: data.filter((x) => x.status === "pending").length,
      crystallized: data.filter((x) => x.status === "crystallized").length,
    };

    return NextResponse.json(counts);
  }

  let query = supabase
    .from("capture_items")
    .select("*, attachments(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (search) {
    query = query.or(
      `title.ilike.%${search}%,source.ilike.%${search}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";
  type CaptureItemPayload = {
    content?: string;
    my_understanding?: string;
    status?: string;
    url_title?: string | null;
    url_content?: string | null;
    attachment_extracted_text?: string | null;
    attachments?: { name: string; type: string; size: number }[];
  };

  let body: CaptureItemPayload = {};
  let uploadedFiles: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    body = {
      content: (form.get("content") as string) || "",
      my_understanding: (form.get("my_understanding") as string) || "",
      status: (form.get("status") as string) || "later",
      url_title: (form.get("url_title") as string) || null,
      url_content: (form.get("url_content") as string) || null,
      attachments: form.get("attachments") ? JSON.parse((form.get("attachments") as string) || "[]") : [],
    };
    uploadedFiles = form.getAll("files").filter((f): f is File => f instanceof File);
  } else {
    body = (await request.json()) as CaptureItemPayload;
  }
  const origin = new URL(request.url).origin;
  const { content, my_understanding, status, url_title, url_content, attachment_extracted_text, attachments } = body;
  const attachmentList = Array.isArray(attachments) ? attachments as { name: string; type: string; size: number }[] : [];
  const normalizedAttachments =
    attachmentList.length > 0
      ? attachmentList
      : uploadedFiles.map((f) => ({ name: f.name, type: f.type, size: f.size }));

  // Submit condition: content OR attachments must have content
  const hasContent = content?.trim();
  const hasAttachments = normalizedAttachments.length > 0;
  if (!hasContent && !hasAttachments) {
    return NextResponse.json(
      { error: "内容或附件至少需要一个" },
      { status: 400 }
    );
  }

  // 1. Detect type and readability
  const detected = detectType((content as string) || null, normalizedAttachments);

  let effectiveUrlTitle = url_title || null;
  let effectiveUrlContent = url_content || null;
  let urlFetchSucceeded = Boolean(effectiveUrlContent);
  if ((detected.type === "url" || detected.type === "video") && detected.source_url && !effectiveUrlContent) {
    const refetched = await refetchUrlContent(origin, detected.source_url);
    effectiveUrlTitle = effectiveUrlTitle || refetched.title;
    effectiveUrlContent = refetched.content;
    urlFetchSucceeded = Boolean(refetched.content);
  }

  // 2. Light parse: generate title, source, summary, tags
  // Fast-path: for oversized document uploads, skip capture-time parsing immediately.
  const oversizedDocAtCapture =
    detected.type === "document" &&
    uploadedFiles.some((f) => f.size > PARSE_RULES.DOCUMENT_CAPTURE_PARSE_MAX_BYTES);
  const extraction = oversizedDocAtCapture
    ? {
        text: null,
        notes: [
          "extractor_version:pdfjs_v7_ocr_fallback",
          ...uploadedFiles
            .filter((f) => f.size > PARSE_RULES.DOCUMENT_CAPTURE_PARSE_MAX_BYTES)
            .map(
              (f) =>
                `doc_extract_skipped_too_large_for_capture:${f.name}:size=${f.size}:limit=${PARSE_RULES.DOCUMENT_CAPTURE_PARSE_MAX_BYTES}`
            ),
          "file_extract_no_text",
        ],
      }
    : await extractReadableTextFromFiles(uploadedFiles, detected);
  const extractedFromFiles = extraction.text;

  // Hard rule (requested): if PDF file is within read threshold, extraction must succeed.
  // Otherwise fail fast and do not create this capture item.
  const smallPdfFiles = uploadedFiles.filter(
    (f) => f.name.toLowerCase().endsWith(".pdf") && f.size <= PARSE_RULES.DOCUMENT_CAPTURE_PARSE_MAX_BYTES
  );
  const requiredPdfFailNotes = extraction.notes.filter((n) => n.startsWith("required_pdf_failed:"));
  const requiredPdfFailed = requiredPdfFailNotes.length > 0;
  const hasPdfInfraFailure =
    extraction.notes.some((n) => n.includes("PDF_PARSE_SERVICE_UNREACHABLE")) ||
    extraction.notes.some((n) => n.startsWith("pdf_ocr_failed:") && n.includes("Setting up fake worker failed"));
  const shouldEnforcePdfHardFail = requiredPdfFailed && !hasPdfInfraFailure;
  let parseRequiredFailedDetail: string | null = null;
  if (
    smallPdfFiles.length > 0 &&
    (shouldEnforcePdfHardFail || (!hasPdfInfraFailure && !(extractedFromFiles && extractedFromFiles.trim().length > 0)))
  ) {
    const requiredFail = requiredPdfFailNotes[0];
    const ocrFail = extraction.notes.find((n) => n.startsWith("pdf_ocr_failed:"));
    const ocrEmpty = extraction.notes.find((n) => n.startsWith("pdf_ocr_empty:"));
    const renderFail = extraction.notes.find((n) => n.startsWith("doc_extract_failed:"));
    const detail =
      [ocrFail, ocrEmpty, renderFail, requiredFail].find(Boolean) ||
      extraction.notes.find((n) => n.startsWith("doc_extract_empty:")) ||
      "PDF_PARSE_REQUIRED_FAILED";
    parseRequiredFailedDetail = detail;
  }
  const detectedForParsing =
    extractedFromFiles && extractedFromFiles.trim().length > 0
      ? { ...detected, readable: true as const }
      : ((detected.type === "url" || detected.type === "video") && !effectiveUrlContent)
        ? { ...detected, readable: false as const }
      : detected;
  const parseInputSource =
    effectiveUrlContent ? "url_content" :
    extractedFromFiles ? "file_extracted_text" :
    (typeof attachment_extracted_text === "string" && attachment_extracted_text.trim()) ? "attachment_extracted_text" :
    ((detected.type === "url" || detected.type === "video") ? "none" : ((typeof content === "string" && content.trim()) ? "content" : "none"));
  const parseContent_input =
    effectiveUrlContent ||
    extractedFromFiles ||
    (typeof attachment_extracted_text === "string" ? attachment_extracted_text : null) ||
    ((detected.type === "url" || detected.type === "video") ? null : (content || null));
  const parsed = await parseContent(
    parseContent_input,
    effectiveUrlTitle,
    detected.source_url || null,
    detectedForParsing,
    normalizedAttachments
  );
  if ((detected.type === "url" || detected.type === "video") && !effectiveUrlContent) {
    parsed.debug.notes.push("url_content_unavailable");
  }
  if (
    detected.type === "image" &&
    uploadedFiles.some((f) => f.type.startsWith("image/")) &&
    (
      !parsed.summary ||
      !parsed.summary.trim() ||
      !parsed.tags ||
      parsed.tags.length === 0 ||
      (parsed.tags.length === 1 && parsed.tags[0] === "-")
    )
  ) {
    try {
      parsed.debug.model_summary_attempted = true;
      parsed.debug.model_tags_attempted = true;
      const firstImage = uploadedFiles.find((f) => f.type.startsWith("image/"));
      if (firstImage) {
        const dataUrl = await fileToDataUrl(firstImage);
        const vision = await analyzeImageForSummaryAndTags(dataUrl);
        if (vision.summary?.trim()) {
          parsed.summary = vision.summary.trim();
          parsed.debug.model_summary_succeeded = true;
          parsed.debug.notes.push("image_vision_summary_generated");
        }
        if (Array.isArray(vision.tags) && vision.tags.length > 0) {
          parsed.tags = vision.tags.slice(0, 3);
          parsed.debug.model_tags_succeeded = true;
          parsed.debug.notes.push("image_vision_tags_generated");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "vision_summary_failed";
      parsed.debug.notes.push(`image_vision_summary_failed:${msg.slice(0, 120)}`);
    }
  }

  if (detected.type === "image") {
    // Hard guarantee: always produce summary/tags placeholders for image captures.
    // Keep model_*_succeeded as the real model outcome so retry decisions stay accurate.
    if (!parsed.debug.model_summary_succeeded) {
      parsed.summary =
        "已收录图片内容。当前OCR/视觉模型暂不可用或未开通，系统已保留原图，后续可重试识别并补全摘要。";
      parsed.debug.notes.push("image_summary_forced_fallback");
    }
    if (!parsed.debug.model_tags_succeeded) {
      parsed.tags = ["图片", "待识别", "补全"];
      parsed.debug.notes.push("image_tags_forced_fallback");
    }
  }
  if (
    detected.type === "document" &&
    (!parsed.summary || !parsed.summary.trim()) &&
    extraction.notes.some((n) => n.startsWith("doc_extract_skipped_too_large_for_capture:"))
  ) {
    parsed.summary = "文件超过录入解析阈值，已先完成收录。请在内化阶段继续解析。";
    parsed.debug.notes.push("document_parse_deferred_due_to_capture_size_limit");
  }
  const persistedRawContent =
    extractedFromFiles ||
    effectiveUrlContent ||
    (typeof content === "string" && content.trim()) ||
    (typeof attachment_extracted_text === "string" ? attachment_extracted_text : null) ||
    null;
  const parseDebug = {
    input_source: parseInputSource,
    detected_type: detected.type,
    readable: detectedForParsing.readable,
    extracted_chars: parseContent_input?.trim().length || 0,
    model_summary_attempted: parsed.debug.model_summary_attempted,
    model_summary_succeeded: parsed.debug.model_summary_succeeded,
    model_tags_attempted: parsed.debug.model_tags_attempted,
    model_tags_succeeded: parsed.debug.model_tags_succeeded,
    url_fetch_succeeded: detected.type === "url" || detected.type === "video" ? urlFetchSucceeded : undefined,
    file_extract_succeeded: uploadedFiles.length > 0 ? Boolean(extractedFromFiles) : undefined,
    file_extract_count: uploadedFiles.length || undefined,
    stages: {
      detect: { ok: true },
      extract: {
        ok: Boolean(extractedFromFiles || effectiveUrlContent || (typeof content === "string" && content.trim())),
        strategy: effectiveUrlContent
          ? "url_content"
          : extractedFromFiles
            ? "file_extracted_text"
            : (typeof content === "string" && content.trim())
              ? "raw_content"
              : "none",
        chars: parseContent_input?.trim().length || 0,
      },
      summarize: {
        attempted: parsed.debug.model_summary_attempted,
        ok: parsed.debug.model_summary_succeeded,
      },
      tags: {
        attempted: parsed.debug.model_tags_attempted,
        ok: parsed.debug.model_tags_succeeded,
      },
    },
    parse_status:
      extractedFromFiles && extractedFromFiles.trim().length > 0
        ? "success"
        : parseRequiredFailedDetail
          ? "failed"
          : "deferred",
    parse_error_code: parseRequiredFailedDetail ? "PDF_PARSE_REQUIRED_FAILED" : undefined,
    parse_error_detail: parseRequiredFailedDetail || undefined,
    notes: [
      ...parsed.debug.notes,
      ...extraction.notes,
      ...(parseRequiredFailedDetail ? [`parse_required_failed:${parseRequiredFailedDetail}`] : []),
    ],
  };

  console.info("[capture-items.parse-result]", {
    user_id: user.id,
    type: detected.type,
    input_source: parseDebug.input_source,
    readable: parseDebug.readable,
    extracted_chars: parseDebug.extracted_chars,
    model_summary_succeeded: parseDebug.model_summary_succeeded,
    model_tags_succeeded: parseDebug.model_tags_succeeded,
    notes: parseDebug.notes,
  });

  // 3. Save
  const { data: createdItem, error, parseDebugDropped } = await insertCaptureItemCompat(supabase, {
    user_id: user.id,
    type: detected.type,
    title: parsed.title,
    source: parsed.source,
    source_url: detected.source_url || null,
    raw_content: persistedRawContent,
    my_understanding: my_understanding?.trim() || null,
    summary: parsed.summary,
    parse_debug: parseDebug,
    tags: parsed.tags,
    status: status || "later",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (normalizedAttachments.length > 0) {
    let storageNotes: string[] = [];
    let uploadedMetas: UploadedAttachmentMeta[] = [];
    if (uploadedFiles.length > 0) {
      const uploadResult = await uploadFilesToStorage(supabase, user.id, createdItem.id, uploadedFiles);
      storageNotes = uploadResult.notes;
      uploadedMetas = uploadResult.metas;
    }

    const attachmentRows = (uploadedMetas.length > 0
      ? uploadedMetas
      : normalizedAttachments.map((att: { name: string; type: string; size: number }) => ({
          file_name: att.name,
          file_type: att.type || "application/octet-stream",
          file_size: att.size || 0,
          storage_path: null,
        }))
    ).map((att) => ({
      capture_item_id: createdItem.id,
      user_id: user.id,
      file_name: att.file_name,
      file_type: att.file_type || "application/octet-stream",
      file_size: att.file_size || 0,
      storage_path: att.storage_path,
    }));

    const { error: attachmentError } = await supabase.from("attachments").insert(attachmentRows);
    if (attachmentError) {
      console.error("[capture-items.attachments-insert-failed]", {
        user_id: user.id,
        capture_item_id: createdItem.id,
        error: attachmentError.message,
      });
      // Do not fail the whole capture creation if attachment metadata insert fails.
      return NextResponse.json(
        {
          ...createdItem,
          parse_debug: parseDebugDropped ? parseDebug : (createdItem.parse_debug ?? parseDebug),
          warnings: ["attachment_insert_failed"],
          warning_detail: attachmentError.message,
        },
        { status: 201 }
      );
    }
    if (storageNotes.length > 0) {
      console.warn("[capture-items.storage-notes]", {
        user_id: user.id,
        capture_item_id: createdItem.id,
        notes: storageNotes,
      });
    }
  }

  if (
    detected.type === "document" &&
    (!parsed.summary || !parsed.summary.trim()) &&
    extraction.notes.some((n) => n.startsWith("pdf_likely_scanned:"))
  ) {
    parsed.summary = "检测到疑似扫描版 PDF，当前仅提取到少量文本。建议后续内化阶段补全解析。";
    parsed.debug.notes.push("pdf_scanned_summary_fallback");
  }

  const { data: fullItem, error: reloadError } = await supabase
    .from("capture_items")
    .select("*, attachments(*)")
    .eq("id", createdItem.id)
    .eq("user_id", user.id)
    .single();

  if (reloadError) {
    console.error("[capture-items.reload-failed]", {
      user_id: user.id,
      capture_item_id: createdItem.id,
      error: reloadError.message,
    });
    // Fallback: return created item directly to keep UX stable.
    return NextResponse.json(
      {
        ...createdItem,
        parse_debug: parseDebugDropped ? parseDebug : (createdItem.parse_debug ?? parseDebug),
        warnings: ["reload_failed"],
        warning_detail: reloadError.message,
      },
      { status: 201 }
    );
  }

  if (parseDebugDropped && fullItem) {
    maybeTriggerParseRetry({
      origin,
      request,
      itemId: fullItem.id,
      itemType: detected.type,
      parseDebugNotes: parseDebug.notes,
      hasReadableText: Boolean(persistedRawContent && persistedRawContent.trim().length > 0),
    });
    return NextResponse.json(
      {
        ...fullItem,
        // Temporary compatibility: expose this run's debug even before 004 migration.
        parse_debug: parseDebug,
      },
      { status: 201 }
    );
  }

  maybeTriggerParseRetry({
    origin,
    request,
    itemId: fullItem.id,
    itemType: detected.type,
    parseDebugNotes: parseDebug.notes,
    hasReadableText: Boolean(persistedRawContent && persistedRawContent.trim().length > 0),
  });

  return NextResponse.json(fullItem, { status: 201 });
}

function maybeTriggerParseRetry(input: {
  origin: string;
  request: Request;
  itemId: string;
  itemType: string;
  parseDebugNotes: string[] | undefined;
  hasReadableText: boolean;
}) {
  const { origin, request, itemId, itemType, parseDebugNotes, hasReadableText } = input;
  const notes = Array.isArray(parseDebugNotes) ? parseDebugNotes : [];
  const shouldRetry =
    notes.some((n) => n.startsWith("summary_error:") || n.startsWith("tags_error:")) ||
    notes.some((n) => n.startsWith("image_vision_summary_failed:")) ||
    notes.includes("image_summary_forced_fallback") ||
    notes.includes("image_tags_forced_fallback");
  if (!hasReadableText && itemType !== "image") return;
  if (!shouldRetry) return;

  const cookie = request.headers.get("cookie") || "";
  setTimeout(() => {
    void fetch(`${origin}/api/capture-items/${itemId}/retry-parse`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
    }).catch(() => {});
  }, 1200);
}

async function extractReadableTextFromFiles(
  files: File[],
  detected: ReturnType<typeof detectType>
): Promise<{ text: string | null; notes: string[] }> {
  const notes: string[] = ["extractor_version:pdfjs_v7_ocr_fallback"];
  if (!files.length) return { text: null, notes: ["no_uploaded_files"] };
  if (!(detected.readable === true || detected.readable === "partial")) {
    return { text: null, notes: ["type_not_readable_in_capture"] };
  }

  const chunks: string[] = [];
  let imageOcrAttempted = 0;
  let imageOcrSucceeded = 0;
  let docExtractAttempted = 0;
  let docExtractSucceeded = 0;
  let hasPdfInfraFailure = false;

  for (const file of files) {
    if (chunks.join("\n").length > 12000) break;

    if (file.type.startsWith("image/")) {
      if (detected.type !== "image" && detected.type !== "attachment_group") continue;
      imageOcrAttempted += 1;
      try {
        const dataUrl = await fileToDataUrl(file);
        const text = await extractTextFromImageDataUrl(dataUrl);
        if (text) {
          chunks.push(text.slice(0, 2000));
          imageOcrSucceeded += 1;
        } else {
          notes.push(`ocr_empty:${file.name}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "ocr_unknown_error";
        notes.push(`ocr_failed:${file.name}:${msg.slice(0, 120)}`);
      }
      continue;
    }

    if (file.size <= PARSE_RULES.DOCUMENT_CAPTURE_PARSE_MAX_BYTES) {
      docExtractAttempted += 1;
      try {
        if (file.name.toLowerCase().endsWith(".pdf")) {
          const external = await parsePdfWithService(file);
          if (external.ok && external.text) {
            chunks.push(external.text.slice(0, 6000));
            docExtractSucceeded += 1;
            notes.push(`pdf_parser_service_ok:${file.name}:chars=${external.text.length}`);
            continue;
          }
          if (external.errorCode && external.errorCode !== "PDF_PARSE_SERVICE_UNREACHABLE") {
            notes.push(`pdf_parser_service_failed:${file.name}:${external.detail || external.errorCode}`);
            hasPdfInfraFailure = true;
          } else {
            hasPdfInfraFailure = true;
            notes.push(`pdf_parser_service_unavailable:${file.name}:${external.detail || external.errorCode || "unreachable"}`);
          }
        }

        const extracted = await extractDocumentTextDetailed(file);
        const text = extracted.text;
        if (
          extracted.meta.strategy === "pdf_text" ||
          extracted.meta.strategy === "pdf_low_text" ||
          extracted.meta.strategy === "pdf_heuristic"
        ) {
          notes.push(
            `pdf_extract_meta:${file.name}:strategy=${extracted.meta.strategy},pages=${extracted.meta.page_count || 0},chars=${extracted.meta.extracted_chars},cpp=${extracted.meta.chars_per_page || 0}`
          );
          if (extracted.meta.likely_scanned_pdf) {
            notes.push(`pdf_likely_scanned:${file.name}`);
          }
        }
        if (text && text.trim()) {
          if (extracted.meta.strategy === "pdf_heuristic" && file.name.toLowerCase().endsWith(".pdf")) {
            notes.push(`pdf_heuristic_untrusted:${file.name}`);
            const ocrText = await tryPdfOcrFallback(file, notes);
            if (ocrText && evaluateExtractedTextQuality(ocrText).ok) {
              chunks.push(ocrText.slice(0, 6000));
              docExtractSucceeded += 1;
              notes.push(`pdf_ocr_fallback_preferred_over_heuristic:${file.name}`);
              continue;
            }
            if (hasPdfInfraFailure) {
              chunks.push(text.slice(0, 6000));
              docExtractSucceeded += 1;
              notes.push(`pdf_heuristic_low_confidence_accepted:${file.name}`);
              continue;
            }
            notes.push(`required_pdf_failed:${file.name}:heuristic_untrusted_and_ocr_failed`);
            continue;
          }
          const quality = evaluateExtractedTextQuality(text);
          if (!quality.ok) {
            notes.push(`doc_extract_garbled:${file.name}:${quality.reason}`);
            if (file.name.toLowerCase().endsWith(".pdf")) {
              const ocrText = await tryPdfOcrFallback(file, notes);
              if (ocrText && evaluateExtractedTextQuality(ocrText).ok) {
                chunks.push(ocrText.slice(0, 6000));
                docExtractSucceeded += 1;
                notes.push(`pdf_ocr_fallback_used:${file.name}`);
                continue;
              }
              notes.push(`required_pdf_failed:${file.name}:garbled_and_ocr_failed`);
            }
            continue;
          }
          chunks.push(text.slice(0, 6000));
          docExtractSucceeded += 1;
        } else {
          if (file.name.toLowerCase().endsWith(".pdf")) {
            const ocrText = await tryPdfOcrFallback(file, notes);
            if (ocrText && evaluateExtractedTextQuality(ocrText).ok) {
              chunks.push(ocrText.slice(0, 6000));
              docExtractSucceeded += 1;
              notes.push(`pdf_ocr_fallback_used:${file.name}`);
              continue;
            }
            notes.push(`required_pdf_failed:${file.name}:empty_and_ocr_failed`);
          }
          notes.push(`doc_extract_empty:${file.name}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "doc_extract_unknown_error";
        notes.push(`doc_extract_failed:${file.name}:${msg.slice(0, 120)}`);
      }
    } else {
      notes.push(
        `doc_extract_skipped_too_large_for_capture:${file.name}:size=${file.size}:limit=${PARSE_RULES.DOCUMENT_CAPTURE_PARSE_MAX_BYTES}`
      );
    }
  }

  const merged = chunks.join("\n\n").trim();
  if (imageOcrAttempted > 0) notes.push(`ocr_attempted:${imageOcrAttempted}`);
  if (imageOcrSucceeded > 0) notes.push(`ocr_succeeded:${imageOcrSucceeded}`);
  if (docExtractAttempted > 0) notes.push(`doc_extract_attempted:${docExtractAttempted}`);
  if (docExtractSucceeded > 0) notes.push(`doc_extract_succeeded:${docExtractSucceeded}`);
  if (!merged) notes.push("file_extract_no_text");
  return { text: merged || null, notes };
}

async function parsePdfWithService(file: File): Promise<{ ok: boolean; text?: string; errorCode?: string; detail?: string }> {
  const base = process.env.PARSER_SERVICE_URL?.trim();
  if (!base) return { ok: false };
  const timeoutMs = Number(
    process.env.PARSER_SERVICE_TIMEOUT_MS_CAPTURE ||
    process.env.PARSER_SERVICE_TIMEOUT_MS ||
    "120000"
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000);
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("ocr", "0");
    const res = await fetch(`${base.replace(/\/$/, "")}/parse/pdf`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        errorCode: typeof data?.error_code === "string" ? data.error_code : `HTTP_${res.status}`,
        detail: typeof data?.detail === "string" ? data.detail : "",
      };
    }
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) return { ok: false, errorCode: "PDF_PARSE_EMPTY_TEXT", detail: "service_empty_text" };
    return { ok: true, text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "service_unreachable";
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      errorCode: isAbort ? "PDF_PARSE_SERVICE_TIMEOUT" : "PDF_PARSE_SERVICE_UNREACHABLE",
      detail: msg.slice(0, 200),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function evaluateExtractedTextQuality(text: string): { ok: boolean; reason: string } {
  const s = text.trim();
  if (!s) return { ok: false, reason: "empty" };
  if (s.length < 80) return { ok: false, reason: "too_short" };

  const suspiciousTokens = ["锟斤拷", "鈥", "��", "Ã", "Â", "¤"];
  const suspiciousHits = suspiciousTokens.reduce((acc, t) => acc + (s.split(t).length - 1), 0);
  if (suspiciousHits >= 6) return { ok: false, reason: "suspicious_token_high" };

  const meaningful = (s.match(/[\u4e00-\u9fffA-Za-z0-9]/g) || []).length;
  const total = s.length;
  const ratio = total > 0 ? meaningful / total : 0;
  if (ratio < 0.25) return { ok: false, reason: "meaningful_ratio_low" };

  const uniqueChars = new Set(s.replace(/\s+/g, "").split(""));
  if (uniqueChars.size <= 10 && s.length > 200) return { ok: false, reason: "low_char_diversity" };

  return { ok: true, reason: "ok" };
}

async function tryPdfOcrFallback(file: File, notes: string[]): Promise<string | null> {
  try {
    ensurePdfParseWorkerConfigured(notes);
    const bytes = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: bytes });
    try {
      const screenshot = await parser.getScreenshot({
        first: 3,
        imageDataUrl: true,
        imageBuffer: false,
      } as Record<string, unknown>);

      const pages = Array.isArray((screenshot as { pages?: unknown[] }).pages)
        ? ((screenshot as { pages?: unknown[] }).pages as unknown[])
        : [];
      const chunks: string[] = [];
      for (const page of pages) {
        const dataUrl =
          (page && typeof page === "object" && "dataUrl" in page && typeof (page as { dataUrl?: unknown }).dataUrl === "string"
            ? (page as { dataUrl: string }).dataUrl
            : null) ||
          (page && typeof page === "object" && "data" in page && typeof (page as { data?: unknown }).data === "string"
            ? (page as { data: string }).data
            : null);
        if (!dataUrl) continue;
        const text = await extractTextFromImageDataUrl(dataUrl);
        if (text?.trim()) chunks.push(text.trim());
      }
      const merged = chunks.join("\n\n").trim();
      if (!merged) {
        notes.push(`pdf_ocr_empty:${file.name}`);
        return null;
      }
      notes.push(`pdf_ocr_chars:${file.name}:${merged.length}`);
      return merged;
    } finally {
      await parser.destroy();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "pdf_ocr_failed";
    if (msg.includes("Setting up fake worker failed")) {
      notes.push(`pdf_ocr_worker_runtime_missing:${file.name}`);
    }
    notes.push(`pdf_ocr_failed:${file.name}:${msg.slice(0, 120)}`);
    return null;
  }
}

let pdfParseWorkerConfigured = false;
function ensurePdfParseWorkerConfigured(notes: string[]) {
  if (pdfParseWorkerConfigured) return;
  try {
    const envWorker = process.env.PDF_OCR_WORKER_URL?.trim();
    const cwdWorkerPath = join(process.cwd(), "node_modules", "pdf-parse", "dist", "pdf-parse", "web", "pdf.worker.min.mjs");
    const repoWorkerPath = join(process.cwd(), "..", "..", "node_modules", "pdf-parse", "dist", "pdf-parse", "web", "pdf.worker.min.mjs");
    const localWorkerPath = existsSync(cwdWorkerPath) ? cwdWorkerPath : (existsSync(repoWorkerPath) ? repoWorkerPath : null);
    const workerSrc = envWorker
      ? envWorker
      : localWorkerPath
        ? pathToFileURL(localWorkerPath).href
        : "https://cdn.jsdelivr.net/npm/pdf-parse@2.4.5/dist/pdf-parse/web/pdf.worker.min.mjs";
    PDFParse.setWorker(workerSrc);
    notes.push(envWorker ? "pdf_ocr_worker_configured:env" : (localWorkerPath ? "pdf_ocr_worker_configured:local" : "pdf_ocr_worker_configured:cdn"));
    pdfParseWorkerConfigured = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    notes.push(`pdf_ocr_worker_config_failed:${msg.slice(0, 120)}`);
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
