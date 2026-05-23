import { PARSE_RULES, type ParseNotReadableReason } from "./config";

export type DetectResult = {
  type: "text" | "url" | "video" | "document" | "image" | "attachment_group";
  readable: boolean | "partial";
  source_url?: string;
  reason?: ParseNotReadableReason;
};

type AttachmentLite = { name: string; type: string; size: number };

export function detectType(
  content: string | null,
  attachments: AttachmentLite[]
): DetectResult {
  const trimmed = content?.trim() || "";

  const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    const url = urlMatch[1];
    if (isLikelyVideoUrl(url)) {
      return {
        type: "video",
        readable: "partial",
        source_url: url,
        reason: "video_not_readable",
      };
    }
    return { type: "url", readable: true, source_url: url };
  }

  if (trimmed) {
    if (trimmed.length < PARSE_RULES.TEXT_MIN_LENGTH) {
      return { type: "text", readable: false, reason: "text_too_short" };
    }
    return { type: "text", readable: true };
  }

  if (attachments.length === 1) {
    const a = attachments[0];
    if (a.type.startsWith("image/")) {
      return { type: "image", readable: true };
    }
    if (a.size > PARSE_RULES.DOCUMENT_READ_MAX_BYTES) {
      return { type: "document", readable: false, reason: "document_too_large" };
    }
    return { type: "document", readable: true };
  }

  if (attachments.length > 1) {
    const allImages = attachments.every((a) => a.type.startsWith("image/"));
    if (allImages) {
      if (attachments.length > PARSE_RULES.IMAGE_READ_MAX_COUNT) {
        return { type: "image", readable: false, reason: "image_too_many" };
      }
      return { type: "image", readable: true };
    }

    const totalBytes = attachments.reduce((acc, a) => acc + (a.size || 0), 0);
    if (totalBytes >= PARSE_RULES.ATTACHMENT_GROUP_READ_MAX_BYTES) {
      return {
        type: "attachment_group",
        readable: false,
        reason: "attachment_group_too_large",
      };
    }
    return { type: "attachment_group", readable: true };
  }

  return { type: "text", readable: false, reason: "text_too_short" };
}

function isLikelyVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    if (
      /bilibili\.com|b23\.tv|youtube\.com|youtu\.be|douyin\.com|iesdouyin\.com|ixigua\.com|v\.qq\.com|youku\.com|iqiyi\.com|kuaishou\.com/i.test(
        host
      )
    ) {
      return true;
    }

    // Generic fallback: explicit video-like path or query.
    if (/\/video\/|\/shorts\/|\/watch\/|\/reel\/|\/live\//i.test(path)) {
      return true;
    }
    if (u.searchParams.has("v")) return true;
  } catch {
    return false;
  }
  return false;
}

export function getSource(
  detected: DetectResult,
  url: string | null,
  attachments: { name: string }[]
): string {
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

  return "附件组";
}
