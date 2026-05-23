import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generateCompletion, generateEmbedding } from "@/lib/llm/client";
import { ERROR_CODES, errorBody } from "@/lib/api/error-codes";
import { withRetry } from "@/lib/llm/resilience";
import {
  INTERNALIZE_SYSTEM,
  internalizeUserPrompt,
  CONCEPT_EXTRACTION,
} from "@/lib/llm/prompts";

export async function POST(request: Request) {
  const traceId = randomUUID();
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
    console.info("[internalize] start", { trace_id: traceId, user_id: user.id, capture_item_id: item.id, dry_run: dryRun });

    const { data: attachments } = await supabase
      .from("capture_item_attachments")
      .select("file_name, mime_type")
      .eq("capture_item_id", item.id)
      .eq("user_id", user.id);

    const attachmentContext =
      attachments && attachments.length > 0
        ? attachments
            .map((a) => `${a.file_name}${a.mime_type ? ` (${a.mime_type})` : ""}`)
            .join("\n")
        : "";

    const sourceContent = [
      item.raw_content?.trim() || "",
      item.summary?.trim() || "",
      item.my_understanding?.trim() || "",
      attachmentContext ? `附件列表:\n${attachmentContext}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    let videoEnrichment = "";
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

    const effectiveSourceContent =
      sourceContent ||
      `标题: ${item.title || "未命名记录"}\n来源: ${item.source || "-"}\n说明: 当前记录暂未提取出可读文本，先基于元信息生成内化草稿。`;

    const internalizeInput = videoEnrichment
      ? `${effectiveSourceContent}\n\n${videoEnrichment}`
      : effectiveSourceContent;

    const userPrompt = internalizeUserPrompt(item.title, item.source, internalizeInput, item.my_understanding);
    let generatedMarkdown = "";
    let generationError: string | null = null;
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

    let summary = item.summary || "";
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

    if (dryRun) {
      console.info("[internalize] dry_run_success", { trace_id: traceId, user_id: user.id, capture_item_id: item.id });
      return NextResponse.json(
        {
          draft: {
            title: item.title,
            content: markdown,
            summary: summary.trim(),
            concepts,
            tags: item.tags || [],
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

    const { data: note, error: noteError } = await supabase
      .from("notes")
      .insert({
        user_id: user.id,
        capture_item_id: item.id,
        title: item.title,
        content: markdown,
        summary: summary.trim(),
        concepts,
        tags: item.tags || [],
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

    await supabase
      .from("capture_items")
      .update({ status: "crystallized", updated_at: new Date().toISOString() })
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
    console.error("[internalize] failed", { trace_id: traceId, user_id: user.id, capture_item_id: item.id, error: message });
    return NextResponse.json(
      errorBody(ERROR_CODES.internalize_failed, message, traceId, { status: "error" }),
      { status: 500 }
    );
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
