import { generateCompletion } from "@/lib/llm/client";
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
};

export async function parseContent(
  content: string | null,
  urlTitle: string | null,
  detected: DetectResult,
  attachments: { name: string; type: string; size: number }[]
): Promise<ParsedFields> {
  const raw = (content || "").trim();
  const source = getSource(detected, urlTitle || null, attachments);
  const { type, readable } = detected;

  // ---- TITLE ----
  let title: string;
  if (type === "url" || type === "video") {
    // URL: use fetched page title
    title = urlTitle?.trim() || "未命名";
  } else if (type === "document") {
    title = attachments[0]?.name || "文档";
  } else if (readable === true) {
    // Readable text/image: LLM generates title
    try {
      title = await generateCompletion(
        PARSE_TITLE_PROMPT,
        parseTitleUserPrompt(raw),
        { temperature: 0.3, maxOutputTokens: 100 }
      );
      title = title.trim().replace(/^["']|["']$/g, "").slice(0, 40);
      if (!title) title = raw.slice(0, 5);
    } catch {
      title = raw.length > 5 ? raw.slice(0, 5) : raw;
    }
  } else if (type === "image" && readable === false) {
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    title = `${ts}图片`;
  } else if (type === "attachment_group" && readable === false) {
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    title = `${ts}附件组`;
  } else {
    // text < 50 chars — use first 5 chars
    title = raw.slice(0, 5);
  }

  // ---- SUMMARY ----
  let summary: string | null = null;
  if (readable === true || readable === "partial") {
    try {
      summary = await generateCompletion(
        PARSE_SUMMARY_PROMPT,
        parseSummaryUserPrompt(raw),
        { temperature: 0.3, maxOutputTokens: 150 }
      );
    } catch (e) {
      console.error("[parse] summary generation failed:", e);
      summary = null;
    }
  } else if (readable === false) {
    if (type === "text") {
      summary = null; // < 50 chars, no summary
    } else if (type === "document") {
      summary = "文件过大，内化后才能生成";
    } else if (type === "image") {
      summary = "图片太多，内化后才能读取";
    } else if (type === "attachment_group") {
      summary = "附件太大，内化后才能读取";
    }
  }

  // ---- TAGS ----
  let tags: string[] = [];
  if (readable === true || readable === "partial") {
    try {
      const rawTags = await generateCompletion(
        PARSE_TAGS_PROMPT,
        parseTagsUserPrompt(raw),
        { temperature: 0.3, maxOutputTokens: 200 }
      );
      const parsed = JSON.parse(rawTags.trim());
      if (Array.isArray(parsed)) tags = parsed.slice(0, 8);
    } catch (e) {
      console.error("[parse] tag extraction failed:", e);
      tags = [];
    }
  } else {
    tags = ["-"];
  }

  return { title, source, summary, tags };
}
