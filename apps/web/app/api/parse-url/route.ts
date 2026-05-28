import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizeUrl(raw: string, baseUrl: string): string | null {
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function isLikelyContentImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (!/^https?:\/\//i.test(lower)) return false;
  if (lower.includes("/avatar")) return false;
  if (lower.includes("favicon")) return false;
  if (lower.includes("sprite")) return false;
  if (lower.includes("icon")) return false;
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(lower) || /imageView2|xhsimg|xhscdn|sns-webpic/i.test(lower);
}

function extractText(html: string): string {
  // Remove script, style, nav, header, footer
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    // Remove all HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode common entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, 4000);
}

function extractTitle(html: string): string | null {
  const ogTitleMatch = html.match(
    /<meta\s+property="og:title"\s+content="([^"]+)"/i
  );
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return ogTitleMatch?.[1]?.trim() || titleMatch?.[1]?.trim() || null;
}

function extractDescription(html: string): string | null {
  const ogDescMatch = html.match(
    /<meta\s+property="og:description"\s+content="([^"]+)"/i
  );
  const metaDescMatch = html.match(
    /<meta\s+name="description"\s+content="([^"]+)"/i
  );
  return ogDescMatch?.[1]?.trim() || metaDescMatch?.[1]?.trim() || null;
}

function extractImageUrls(html: string, pageUrl: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  const pushUrl = (candidate: string | null | undefined) => {
    if (!candidate) return;
    const normalized = normalizeUrl(candidate, pageUrl);
    if (!normalized) return;
    if (!isLikelyContentImage(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    results.push(normalized);
  };

  const imgTagRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = imgTagRegex.exec(html))) {
    pushUrl(match[1]);
  }

  const ogImageRegex = /<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/gi;
  while ((match = ogImageRegex.exec(html))) {
    pushUrl(match[1]);
  }

  const jsonUrlRegex = /https?:\/\/[^"'\\\s]+(?:xhsimg\.com|xhscdn\.com|sns-webpic-qc\.xhscdn\.com|ci\.xiaohongshu\.com)[^"'\\\s]*/gi;
  while ((match = jsonUrlRegex.exec(html))) {
    pushUrl(match[0]);
  }

  return results.slice(0, 24);
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.google.com/",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaJina(url: string): Promise<{ title: string | null; content: string | null }> {
  const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
  const text = await fetchHtml(proxyUrl, 12000);
  if (!text) return { title: null, content: null };
  const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
  const titleLine = lines.find((line) => line.startsWith("Title:"));
  const title = titleLine ? titleLine.replace(/^Title:\s*/i, "").trim() : null;
  const content = text.slice(0, 4000).trim() || null;
  return { title, content };
}

function detectUrlPlatform(url: string): "xiaohongshu" | "wechat" | "generic" {
  if (/xiaohongshu\.com|xhslink\.com/i.test(url)) return "xiaohongshu";
  if (/mp\.weixin\.qq\.com/i.test(url)) return "wechat";
  return "generic";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url } = await request.json();
  if (!url) {
    return NextResponse.json({ error: "URL required" }, { status: 400 });
  }

  try {
    const html = await fetchHtml(url, 10000);
    let title: string | null = null;
    let description: string | null = null;
    let textContent: string | null = null;
    let imageUrls: string[] = [];
    const platform = detectUrlPlatform(url);

    if (html) {
      title = extractTitle(html);
      description = extractDescription(html);
      textContent = extractText(html);
      imageUrls = extractImageUrls(html, url);
    }

    // WeChat and similar anti-crawl pages: use a reader fallback.
    if ((!textContent || textContent.length < 120) && /mp\.weixin\.qq\.com/i.test(url)) {
      try {
        const fallback = await fetchViaJina(url);
        title = title || fallback.title;
        textContent = fallback.content || textContent;
      } catch {
        // keep primary result
      }
    }

    return NextResponse.json({
      title: title || null,
      description: description || null,
      content: textContent || null,
      image_urls: imageUrls,
      image_count: imageUrls.length,
      platform,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch URL";
    return NextResponse.json({ title: null, content: null, image_urls: [], image_count: 0, platform: detectUrlPlatform(url), error: message });
  }
}
