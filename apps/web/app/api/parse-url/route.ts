import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { fetchExternalXhsImages } from "@/lib/parse/external-media";

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
  if (/\.(js|css)(\?|$)/i.test(lower)) return false;
  if (lower.includes("/avatar")) return false;
  if (lower.includes("favicon")) return false;
  if (lower.includes("sprite")) return false;
  if (lower.includes("icon")) return false;
  const hasImageExt = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(lower);
  const hasImageHost = /xhsimg|xhscdn|sns-webpic|imageview2/.test(lower);
  // Host hint alone is too loose; require ext or explicit image transform marker.
  const hasTransform = /imageview2|x-oss-process=image\//.test(lower);
  return hasImageExt || (hasImageHost && hasTransform);
}

function extractText(html: string, maxChars = 4000): string {
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

  return cleaned.slice(0, maxChars);
}

function extractWechatArticleHtml(html: string): string | null {
  const marker = /id=["']js_content["']/i;
  const match = marker.exec(html);
  if (!match || match.index < 0) return null;

  const fromMarker = html.slice(match.index);
  const openEnd = fromMarker.indexOf(">");
  if (openEnd < 0) return null;
  const body = fromMarker.slice(openEnd + 1);

  const endHints = [
    /id=["']js_tags["']/i,
    /id=["']js_toobar["']/i,
    /id=["']js_read_area3["']/i,
    /class=["'][^"']*wx_profile_card[^"']*["']/i,
  ];

  let endIndex = body.length;
  for (const hint of endHints) {
    const m = hint.exec(body);
    if (m?.index !== undefined && m.index >= 0) {
      endIndex = Math.min(endIndex, m.index);
    }
  }

  return body.slice(0, endIndex);
}

function trimWechatTailNoise(text: string): string {
  const src = (text || "").trim();
  if (!src) return src;

  const cutMarkers = [
    "阅读原文",
    "微信扫一扫",
    "轻触阅读原文",
    "继续滑动看下一个",
    "向上滑动看下一个",
    "赞 ，轻点两下取消赞",
    "在看 ，轻点两下取消在看",
    "分享 留言 收藏",
    "预览时标签不可点",
    "使用小程序",
    "知道了",
  ];

  let cutAt = src.length;
  for (const marker of cutMarkers) {
    const idx = src.indexOf(marker);
    if (idx >= 0) cutAt = Math.min(cutAt, idx);
  }

  const trimmed = src.slice(0, cutAt).trim();
  // Final compact to avoid long punctuation tails.
  return trimmed.replace(/\s+/g, " ").trim();
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

  const jsonUrlRegex = /https?:\/\/[^"'\\\s]+(?:xhsimg\.com|xhscdn\.com|sns-webpic-qc\.xhscdn\.com|ci\.xiaohongshu\.com|sns-webpic\.xhscdn\.com)[^"'\\\s]*/gi;
  while ((match = jsonUrlRegex.exec(html))) {
    pushUrl(match[0]);
  }

  // Extract URLs from escaped JSON strings commonly seen in SSR payloads.
  const escapedJsonUrlRegex = /https?:\\\/\\\/[^"'\\\s]+(?:xhsimg\.com|xhscdn\.com|sns-webpic-qc\.xhscdn\.com|ci\.xiaohongshu\.com|sns-webpic\.xhscdn\.com)[^"'\\\s]*/gi;
  while ((match = escapedJsonUrlRegex.exec(html))) {
    const unescaped = match[0].replace(/\\\//g, "/");
    pushUrl(unescaped);
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

async function extractImageUrlsByRenderedPage(url: string): Promise<{ urls: string[]; note: string }> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });
      const networkUrls = new Set<string>();
      page.on("request", (req) => {
        const reqUrl = req.url();
        if (isLikelyContentImage(reqUrl)) networkUrls.add(reqUrl);
      });
      page.on("response", (res) => {
        const resUrl = res.url();
        if (isLikelyContentImage(resUrl)) networkUrls.add(resUrl);
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(2500);

      const collectDomImageUrls = async () =>
        page.evaluate(() => {
          const candidates: string[] = [];
          const push = (u: string | null | undefined) => {
            if (!u) return;
            candidates.push(u);
          };
          const imgs = Array.from(document.querySelectorAll("img"));
          for (const img of imgs) {
            push((img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src);
            const dataSrc = img.getAttribute("data-src");
            if (dataSrc) push(dataSrc);
            const srcset = img.getAttribute("srcset");
            if (srcset) {
              for (const part of srcset.split(",")) {
                const candidate = part.trim().split(" ")[0];
                if (candidate) push(candidate);
              }
            }
          }
          const all = Array.from(document.querySelectorAll("*"));
          for (const el of all) {
            const bg = window.getComputedStyle(el).backgroundImage || "";
            const m = bg.match(/url\((['"]?)(.*?)\1\)/i);
            if (m?.[2]) push(m[2]);
          }
          return candidates;
        });

      // Try to turn carousel pages to expose more media URLs.
      for (let i = 0; i < 6; i += 1) {
        const clicked = await page.evaluate(() => {
          const selectors = [
            "[class*='next']",
            "[aria-label*='下一']",
            "[aria-label*='next']",
            ".swiper-button-next",
            ".slick-next",
            "button:has-text('下一张')",
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) {
              el.click();
              return true;
            }
          }
          return false;
        });
        if (!clicked) break;
        await page.waitForTimeout(1000);
      }

      const urls = await collectDomImageUrls();
      for (const u of networkUrls) urls.push(u);
      const fromPerf = await page.evaluate(() => {
        const out: string[] = [];
        const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        for (const e of entries) out.push(e.name);
        return out;
      });
      for (const u of fromPerf) urls.push(u);

      const normalized = [...new Set(
        urls
          .map((u) => normalizeUrl(u, url))
          .filter((u): u is string => Boolean(u))
          .filter((u) => isLikelyContentImage(u))
      )].slice(0, 24);
      return {
        urls: normalized,
        note: normalized.length > 0 ? `xhs_render_extract_used:${normalized.length}` : "xhs_render_extract_empty",
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg.toLowerCase().includes("executable doesn't exist")) {
      return { urls: [], note: "xhs_render_browser_missing" };
    }
    return { urls: [], note: "xhs_render_extract_failed" };
  }
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
      if (platform === "wechat") {
        const wechatMain = extractWechatArticleHtml(html);
        textContent = trimWechatTailNoise(extractText(wechatMain || html, 8000));
      } else {
        textContent = extractText(html, 4000);
      }
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

    const notes: string[] = [];
    if (platform === "xiaohongshu" && imageUrls.length === 0) {
      const rendered = await extractImageUrlsByRenderedPage(url);
      if (rendered.urls.length > 0) {
        imageUrls = rendered.urls;
      }
      notes.push(rendered.note);
    }
    if (platform === "xiaohongshu" && imageUrls.length === 0) {
      const external = await fetchExternalXhsImages(url);
      if (external.imageUrls.length > 0) {
        imageUrls = external.imageUrls;
      }
      notes.push(...external.notes);
    }
    if (platform === "xiaohongshu" && imageUrls.length === 0) {
      notes.push("xhs_image_urls_empty");
    }

    return NextResponse.json({
      title: title || null,
      description: description || null,
      content: textContent || null,
      image_urls: imageUrls,
      image_count: imageUrls.length,
      platform,
      notes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch URL";
    const platform = detectUrlPlatform(url);
    return NextResponse.json({
      title: null,
      content: null,
      image_urls: [],
      image_count: 0,
      platform,
      notes: platform === "xiaohongshu" ? ["xhs_image_urls_empty"] : [],
      error: message,
    });
  }
}
