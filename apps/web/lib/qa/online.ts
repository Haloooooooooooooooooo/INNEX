export type WebEvidence = {
  title: string;
  url: string;
  snippet: string;
  source: "web";
  fetched_at: string;
};

type DomainPolicy = {
  allowed: string[];
  blocked: string[];
};

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

const DEFAULT_POLICY: DomainPolicy = {
  allowed: [
    "wikipedia.org",
    "wikimedia.org",
    "mozilla.org",
    "developer.mozilla.org",
    "arxiv.org",
  ],
  blocked: [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "internal",
    "169.254.169.254",
  ],
};

function resolvePolicy(): DomainPolicy {
  const allow = envList("QA_ONLINE_ALLOWLIST");
  const block = envList("QA_ONLINE_BLOCKLIST");
  return {
    allowed: allow.length ? allow : DEFAULT_POLICY.allowed,
    blocked: block.length ? block : DEFAULT_POLICY.blocked,
  };
}

function normalizeHost(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, rule: string): boolean {
  return host === rule || host.endsWith(`.${rule}`);
}

function isDomainAllowed(url: string, policy: DomainPolicy = resolvePolicy()): boolean {
  const host = normalizeHost(url);
  if (!host) return false;
  if (policy.blocked.some((r) => hostMatches(host, r))) return false;
  return policy.allowed.some((r) => hostMatches(host, r));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function searchWikipedia(query: string, lang: "en" | "zh", limit = 5): Promise<Array<{ title: string; url: string }>> {
  const api = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&utf8=&format=json&srlimit=${limit}&origin=*`;
  const res = await fetchWithTimeout(api, 9000);
  if (!res.ok) return [];
  const json = (await res.json()) as { query?: { search?: Array<{ title: string }> } };
  const list = json?.query?.search || [];
  return list.map((x) => ({
    title: x.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/\s+/g, "_"))}`,
  }));
}

async function searchArxiv(query: string, limit = 3): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`;
  const res = await fetchWithTimeout(url, 10000);
  if (!res.ok) return [];
  const xml = await res.text();
  const entries = xml.split("<entry>").slice(1);
  return entries
    .map((entry) => {
      const title = (entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
      const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] || "").replace(/\s+/g, " ").trim();
      const link = entry.match(/<id>([\s\S]*?)<\/id>/i)?.[1]?.trim() || "";
      return { title, url: link, snippet: summary.slice(0, 500) };
    })
    .filter((x) => x.title && x.url && x.snippet);
}

async function fetchPageSnippet(url: string): Promise<string> {
  if (!isDomainAllowed(url)) return "";
  const res = await fetchWithTimeout(url, 12000);
  if (!res.ok) return "";
  const html = await res.text();
  const text = stripHtml(html);
  return text.slice(0, 600);
}

export async function retrieveOnlineEvidence(query: string, maxItems = 4): Promise<WebEvidence[]> {
  const [zhSeeds, enSeeds, arxivSeeds] = await Promise.all([
    searchWikipedia(query, "zh", Math.max(maxItems, 3)),
    searchWikipedia(query, "en", Math.max(maxItems, 3)),
    searchArxiv(query, 3),
  ]);
  const seeds = [...zhSeeds, ...enSeeds];
  const evidences: WebEvidence[] = [];

  for (const seed of seeds) {
    if (evidences.length >= maxItems) break;
    try {
      const snippet = await fetchPageSnippet(seed.url);
      if (!snippet || snippet.length < 80) continue;
      evidences.push({
        title: seed.title,
        url: seed.url,
        snippet,
        source: "web",
        fetched_at: new Date().toISOString(),
      });
    } catch {
      // ignore failed page
    }
  }

  for (const a of arxivSeeds) {
    if (evidences.length >= maxItems) break;
    if (!isDomainAllowed(a.url)) continue;
    evidences.push({
      title: a.title,
      url: a.url,
      snippet: a.snippet,
      source: "web",
      fetched_at: new Date().toISOString(),
    });
  }

  return evidences;
}
