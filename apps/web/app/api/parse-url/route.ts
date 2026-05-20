import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; INNEX/1.0; +https://innex.app)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ title: null, error: `HTTP ${res.status}` });
    }

    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const ogTitleMatch = html.match(
      /<meta\s+property="og:title"\s+content="([^"]+)"/i
    );
    const title = ogTitleMatch?.[1] || titleMatch?.[1] || null;

    return NextResponse.json({
      title: title?.trim() || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch URL";
    return NextResponse.json({ title: null, error: message });
  }
}
