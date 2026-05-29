import { NextResponse } from "next/server";

function isLikelyContentImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (!/^https?:\/\//i.test(lower)) return false;
  if (lower.includes("/avatar")) return false;
  if (lower.includes("favicon")) return false;
  if (lower.includes("sprite")) return false;
  if (lower.includes("icon")) return false;
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(lower) || /imageView2|xhsimg|xhscdn|sns-webpic/i.test(lower);
}

function normalizeUrl(raw: string, baseUrl: string): string | null {
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function authOk(request: Request): boolean {
  const expected = process.env.EXTERNAL_XHS_CRAWLER_TOKEN?.trim();
  if (!expected) return true;
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const token = auth.slice(7).trim();
  return token === expected;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "external-xhs-crawler",
    method: "POST",
    usage: {
      endpoint: "/api/external-xhs-crawler",
      body: { url: "http://xhslink.com/o/xxxx" },
    },
  });
}

export async function POST(request: Request) {
  if (!authOk(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

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
        const u = req.url();
        if (isLikelyContentImage(u)) networkUrls.add(u);
      });
      page.on("response", (res) => {
        const u = res.url();
        if (isLikelyContentImage(u)) networkUrls.add(u);
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(2500);

      const domUrls = await page.evaluate(() => {
        const out: string[] = [];
        const push = (u: string | null | undefined) => {
          if (u) out.push(u);
        };

        const imgs = Array.from(document.querySelectorAll("img"));
        for (const img of imgs) {
          push((img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src);
          push(img.getAttribute("data-src"));
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

        const perf = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        for (const p of perf) push(p.name);
        return out;
      });

      const merged = [...domUrls, ...networkUrls];
      const image_urls = [...new Set(
        merged
          .map((u) => normalizeUrl(u, url))
          .filter((u): u is string => Boolean(u))
          .filter((u) => isLikelyContentImage(u))
      )].slice(0, 48);

      return NextResponse.json({
        ok: true,
        platform: "xiaohongshu",
        image_urls,
        image_count: image_urls.length,
      });
    } finally {
      await browser.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({
      ok: false,
      platform: "xiaohongshu",
      image_urls: [],
      image_count: 0,
      error: msg,
    });
  }
}
