import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

    if (html) {
      title = extractTitle(html);
      description = extractDescription(html);
      textContent = extractText(html);
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
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch URL";
    return NextResponse.json({ title: null, content: null, error: message });
  }
}
