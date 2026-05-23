import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { detectType } from "@/lib/parse/detector";
import { parseContent } from "@/lib/parse/generator";
import { PARSE_RULES } from "@/lib/parse/config";
import { analyzeImageForSummaryAndTags, extractTextFromImageDataUrl } from "@/lib/llm/client";
import { extractDocumentTextDetailed } from "@/lib/parse/document-extractor";

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
  // For URL types, use the fetched page content rather than just the URL string
  const extraction = await extractReadableTextFromFiles(uploadedFiles, detected);
  const extractedFromFiles = extraction.text;
  const detectedForParsing =
    extractedFromFiles && extractedFromFiles.trim().length > 0
      ? { ...detected, readable: true as const }
      : detected;
  const parseInputSource =
    effectiveUrlContent ? "url_content" :
    extractedFromFiles ? "file_extracted_text" :
    (typeof attachment_extracted_text === "string" && attachment_extracted_text.trim()) ? "attachment_extracted_text" :
    (typeof content === "string" && content.trim()) ? "content" :
    "none";
  const parseContent_input =
    effectiveUrlContent ||
    extractedFromFiles ||
    (typeof attachment_extracted_text === "string" ? attachment_extracted_text : null) ||
    content ||
    null;
  const parsed = await parseContent(
    parseContent_input,
    effectiveUrlTitle,
    detected.source_url || null,
    detectedForParsing,
    normalizedAttachments
  );
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
    // Hard guarantee: always produce summary/tags for image captures.
    if (!parsed.debug.model_summary_succeeded) {
      parsed.summary =
        "已收录图片内容。当前OCR/视觉模型暂不可用或未开通，系统已保留原图，后续可重试识别并补全摘要。";
      parsed.debug.notes.push("image_summary_forced_fallback");
      parsed.debug.model_summary_succeeded = true;
    }
    if (!parsed.debug.model_tags_succeeded) {
      parsed.tags = ["图片", "待识别", "补全"];
      parsed.debug.notes.push("image_tags_forced_fallback");
      parsed.debug.model_tags_succeeded = true;
    }
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
    notes: [...parsed.debug.notes, ...extraction.notes],
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
    parseDebugNotes: parseDebug.notes,
    hasReadableText: Boolean(persistedRawContent && persistedRawContent.trim().length > 0),
  });

  return NextResponse.json(fullItem, { status: 201 });
}

function maybeTriggerParseRetry(input: {
  origin: string;
  request: Request;
  itemId: string;
  parseDebugNotes: string[] | undefined;
  hasReadableText: boolean;
}) {
  const { origin, request, itemId, parseDebugNotes, hasReadableText } = input;
  if (!hasReadableText) return;
  const notes = Array.isArray(parseDebugNotes) ? parseDebugNotes : [];
  const shouldRetry = notes.some((n) => n.startsWith("summary_error:") || n.startsWith("tags_error:"));
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
  const notes: string[] = ["extractor_version:pdfjs_v2"];
  if (!files.length) return { text: null, notes: ["no_uploaded_files"] };
  if (!(detected.readable === true || detected.readable === "partial")) {
    return { text: null, notes: ["type_not_readable_in_capture"] };
  }

  const chunks: string[] = [];
  let imageOcrAttempted = 0;
  let imageOcrSucceeded = 0;
  let docExtractAttempted = 0;
  let docExtractSucceeded = 0;

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

    if (file.size <= PARSE_RULES.DOCUMENT_READ_MAX_BYTES) {
      docExtractAttempted += 1;
      try {
        const extracted = await extractDocumentTextDetailed(file);
        const text = extracted.text;
        if (extracted.meta.strategy === "pdf_text" || extracted.meta.strategy === "pdf_low_text") {
          notes.push(
            `pdf_extract_meta:${file.name}:strategy=${extracted.meta.strategy},pages=${extracted.meta.page_count || 0},chars=${extracted.meta.extracted_chars},cpp=${extracted.meta.chars_per_page || 0}`
          );
          if (extracted.meta.likely_scanned_pdf) {
            notes.push(`pdf_likely_scanned:${file.name}`);
          }
        }
        if (text && text.trim()) {
          chunks.push(text.slice(0, 6000));
          docExtractSucceeded += 1;
        } else {
          notes.push(`doc_extract_empty:${file.name}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "doc_extract_unknown_error";
        notes.push(`doc_extract_failed:${file.name}:${msg.slice(0, 120)}`);
      }
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

async function fileToDataUrl(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
