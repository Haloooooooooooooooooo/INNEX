#!/usr/bin/env node

/**
 * QA smoke check for production/staging/local.
 *
 * Required env:
 * - QA_SMOKE_BASE_URL, e.g. http://localhost:3000
 * - QA_SMOKE_AUTH_HEADER, e.g. cookie / authorization
 * - QA_SMOKE_AUTH_VALUE, e.g. sb-access-token=... or Bearer ...
 *
 * Optional env:
 * - QA_SMOKE_TIMEOUT_MS (default 30000)
 */

const baseUrl = process.env.QA_SMOKE_BASE_URL || "http://localhost:3000";
const authHeader = process.env.QA_SMOKE_AUTH_HEADER;
const authValue = process.env.QA_SMOKE_AUTH_VALUE;
const timeoutMs = Number(process.env.QA_SMOKE_TIMEOUT_MS || 30000);

if (!authHeader || !authValue) {
  console.error("[qa:smoke] missing auth env: QA_SMOKE_AUTH_HEADER / QA_SMOKE_AUTH_VALUE");
  process.exit(1);
}

const headers = {
  [authHeader]: authValue,
  "content-type": "application/json",
};

async function req(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log(`[qa:smoke] base=${baseUrl}`);

  // 1) create session
  const createSession = await req("/api/qa/sessions", {
    method: "POST",
    body: JSON.stringify({ title: "smoke-session", mode: "notes" }),
  });
  assert(createSession.res.ok, `create session failed: ${createSession.res.status}`);
  assert(createSession.data?.id, "create session: missing id");
  const sessionId = createSession.data.id;
  console.log(`[ok] create session: ${sessionId}`);

  // 2) ask notes mode with filters
  const askNotes = await req("/api/qa", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      question: "tag:ai source:notion date>=2025-01-01 总结我的AI助手相关结论",
    }),
  });
  assert(askNotes.res.ok, `ask notes failed: ${askNotes.res.status}`);
  assert(typeof askNotes.data?.answer === "string", "ask notes: missing answer");
  assert(Array.isArray(askNotes.data?.citations), "ask notes: citations not array");
  assert(askNotes.data?.intent, "ask notes: missing intent");
  assert(askNotes.data?.evidence_level, "ask notes: missing evidence_level");
  assert(askNotes.data?.retrieval?.topK, "ask notes: missing retrieval");
  assert(askNotes.data?.filters, "ask notes: missing filters");
  console.log("[ok] notes qa response shape");

  // 3) ask online mode
  const askOnline = await req("/api/qa", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      question: "/online latest transformer retrieval trends",
    }),
  });
  assert(askOnline.res.ok, `ask online failed: ${askOnline.res.status}`);
  assert(typeof askOnline.data?.answer === "string", "ask online: missing answer");
  assert(Array.isArray(askOnline.data?.citations), "ask online: citations not array");
  if (askOnline.data.citations.length > 0) {
    const c = askOnline.data.citations[0];
    assert(c.source === "web", "ask online: citation source should be web");
    assert(typeof c.url === "string" && c.url.length > 0, "ask online: missing citation url");
  }
  console.log("[ok] online qa response shape");

  // 4) load messages
  const messages = await req(`/api/qa/sessions/${sessionId}/messages?limit=20`);
  assert(messages.res.ok, `messages failed: ${messages.res.status}`);
  assert(Array.isArray(messages.data), "messages: not array");
  assert(messages.data.length >= 2, "messages: expected at least 2");
  console.log(`[ok] session messages: ${messages.data.length}`);

  // 5) metrics
  const metrics = await req("/api/qa/metrics");
  assert(metrics.res.ok, `metrics failed: ${metrics.res.status}`);
  assert(typeof metrics.data?.sessions_active_7d === "number", "metrics: sessions_active_7d missing");
  assert(typeof metrics.data?.assistant_messages_7d === "number", "metrics: assistant_messages_7d missing");
  console.log("[ok] qa metrics shape");

  console.log("[qa:smoke] PASS");
}

main().catch((err) => {
  console.error("[qa:smoke] FAIL");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

