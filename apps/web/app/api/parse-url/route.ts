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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; INNEX/1.0; +https://innex.app)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ title: null, content: null, error: `HTTP ${res.status}` });
    }

    const html = await res.text();

    // Title: og:title > <title>
    const ogTitleMatch = html.match(
      /<meta\s+property="og:title"\s+content="([^"]+)"/i
    );
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = ogTitleMatch?.[1] || titleMatch?.[1] || null;

    // Description: og:description > meta description
    const ogDescMatch = html.match(
      /<meta\s+property="og:description"\s+content="([^"]+)"/i
    );
    const metaDescMatch = html.match(
      /<meta\s+name="description"\s+content="([^"]+)"/i
    );
    const description = ogDescMatch?.[1] || metaDescMatch?.[1] || null;

    // Extract visible text content
    const textContent = extractText(html);

    return NextResponse.json({
      title: title?.trim() || null,
      description: description?.trim() || null,
      content: textContent || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch URL";
    return NextResponse.json({ title: null, content: null, error: message });
  }
}
