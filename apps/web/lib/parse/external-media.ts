type ExternalMediaResult = {
  imageUrls: string[];
  notes: string[];
};

const IMAGE_HOST_HINT = /(xhsimg\.com|xhscdn\.com|sns-webpic|xiaohongshu|xiao?hongshu)/i;
const IMAGE_EXT_HINT = /\.(png|jpe?g|webp|gif)(\?|$)/i;
const NON_IMAGE_EXT_HINT = /\.(js|css)(\?|$)/i;
const IMAGE_PARAM_HINT = /(imageview2|x-oss-process=image\/|!nd_)/i;

function looksLikeImageUrl(value: string): boolean {
  const s = value.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (NON_IMAGE_EXT_HINT.test(s)) return false;
  if (IMAGE_EXT_HINT.test(s)) return true;
  if (IMAGE_HOST_HINT.test(s) && IMAGE_PARAM_HINT.test(s)) return true;
  return false;
}

function collectStringUrlsDeep(input: unknown, out: string[]) {
  if (!input) return;
  if (typeof input === "string") {
    const v = input.trim();
    if (looksLikeImageUrl(v)) out.push(v);
    return;
  }
  if (Array.isArray(input)) {
    for (const x of input) collectStringUrlsDeep(x, out);
    return;
  }
  if (typeof input === "object") {
    for (const v of Object.values(input as Record<string, unknown>)) {
      collectStringUrlsDeep(v, out);
    }
  }
}

export async function fetchExternalXhsImages(url: string): Promise<ExternalMediaResult> {
  const endpoint = process.env.EXTERNAL_XHS_CRAWLER_ENDPOINT?.trim();
  const token = process.env.EXTERNAL_XHS_CRAWLER_TOKEN?.trim();
  if (!endpoint) return { imageUrls: [], notes: ["xhs_external_crawler_not_configured"] };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      return { imageUrls: [], notes: [`xhs_external_crawler_http_${res.status}`] };
    }

    const data = await res.json().catch(() => ({}));
    const urls: string[] = [];
    collectStringUrlsDeep(data, urls);
    const dedup = [...new Set(urls)].filter(looksLikeImageUrl).slice(0, 36);
    if (dedup.length > 0) {
      return { imageUrls: dedup, notes: [`xhs_external_crawler_used:${dedup.length}`] };
    }
    return { imageUrls: [], notes: ["xhs_external_crawler_empty"] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return { imageUrls: [], notes: [`xhs_external_crawler_failed:${msg.slice(0, 80)}`] };
  }
}
