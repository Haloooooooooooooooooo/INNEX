// Type detection + readability rules

export type DetectResult = {
  type: "text" | "url" | "video" | "document" | "image" | "attachment_group";
  readable: boolean | "partial"; // true = fully readable, false = not readable, "partial" = video (title readable, content not)
  source_url?: string;
};

export function detectType(
  content: string | null,
  attachments: { name: string; type: string; size: number }[]
): DetectResult {
  const trimmed = content?.trim() || "";

  // Content has a URL
  const urlMatch = trimmed.match(/^(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    const url = urlMatch[1];
    if (/bilibili\.com|b23\.tv|youtube\.com|youtu\.be/i.test(url)) {
      return { type: "video", readable: "partial", source_url: url };
    }
    return { type: "url", readable: true, source_url: url };
  }

  // Content is text (no URL)
  if (trimmed && !urlMatch) {
    if (trimmed.length < 50) {
      return { type: "text", readable: false };
    }
    return { type: "text", readable: true };
  }

  // No content — only attachments
  if (attachments.length === 1) {
    const a = attachments[0];
    if (a.type.startsWith("image/")) {
      return { type: "image", readable: false }; // Phase 2: OCR ≤3 images
    }
    return { type: "document", readable: false }; // Phase 2: Docling for small files
  }

  if (attachments.length > 1) {
    return { type: "attachment_group", readable: false }; // Phase 2: check total size
  }

  // Fallback (shouldn't happen — submit guard prevents this)
  return { type: "text", readable: false };
}

// Map type to source label
export function getSource(detected: DetectResult, url: string | null, attachments: { name: string }[]): string {
  const { type, source_url } = detected;
  const u = source_url || url || "";

  if (type === "text") return "文字";

  if (type === "video" || type === "url") {
    if (/bilibili\.com|b23\.tv/i.test(u)) return "B站";
    if (/youtube\.com|youtu\.be/i.test(u)) return "YouTube";
    if (/mp\.weixin\.qq\.com/i.test(u)) return "微信公众号";
    if (/zhihu\.com/i.test(u)) return "知乎";
    if (/xiaohongshu\.com|xhslink\.com/i.test(u)) return "小红书";
    return "链接";
  }

  if (type === "document") {
    const ext = attachments[0]?.name?.match(/\.(\w+)$/)?.[1]?.toUpperCase() || "";
    return `文档${ext}`;
  }

  if (type === "image") return "图片";

  if (type === "attachment_group") {
    if (attachments.length === 1) return getSource({ type: "document", readable: false }, null, attachments);
    return "附件组";
  }

  return "文字";
}
