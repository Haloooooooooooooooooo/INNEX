import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generateCompletion, generateEmbedding } from "@/lib/llm/client";
import {
  QA_ANSWER_SYSTEM,
  QA_DECISION_SYSTEM,
  QA_SYNTHESIS_SYSTEM,
  RAG_QA_SYSTEM,
  qaAnswerUserPrompt,
  qaDecisionUserPrompt,
  qaSynthesisUserPrompt,
  ragQaUserPrompt,
} from "@/lib/llm/prompts";
import { ERROR_CODES, errorBody } from "@/lib/api/error-codes";
import { withRetry } from "@/lib/llm/resilience";
import { detectIntent, intentLabel, isRelationCheckQuestion, detectExpansionIntent } from "@/lib/qa/intent";
import type { QaExpansionIntent } from "@/lib/qa/intent";
import { retrieveOnlineEvidence } from "@/lib/qa/online";
import { onlineMaxEvidence, qaContextRounds, retrievalPreset } from "@/lib/qa/config";
import { hasFilters, parseQuestionFilters } from "@/lib/qa/filters";

type QaMode = "notes" | "general" | "online";
type RelationType = "related" | "supports" | "example_of" | "weak_related" | "fallback";

function graphExpandBudget() {
  return Math.max(4, Math.min(40, Number(process.env.QA_GRAPH_EXPAND_BUDGET || 14)));
}

function graphExpandHops() {
  return Math.max(1, Math.min(3, Number(process.env.QA_GRAPH_EXPAND_HOPS || 1)));
}

function graphExpandMinGain() {
  return Math.max(1, Math.min(6, Number(process.env.QA_GRAPH_EXPAND_MIN_GAIN || 1)));
}

function relationPriorityByIntent(intent: string): RelationType[] {
  if (intent === "action_advice") return ["supports", "related", "example_of", "weak_related", "fallback"];
  if (intent === "comparison") return ["supports", "related", "example_of", "weak_related", "fallback"];
  if (intent === "summary") return ["related", "supports", "example_of", "weak_related", "fallback"];
  if (intent === "retrospective") return ["supports", "related", "example_of", "weak_related", "fallback"];
  return ["related", "supports", "example_of", "weak_related", "fallback"];
}

// Phase 5.5: expansion intent maps directly to a preferred relation type for graph
// expansion. When an expansion intent is present it takes precedence over the
// primary-intent priority (the preferred type is moved to the front; the rest keep
// their relative order). "none" falls back to relationPriorityByIntent.
function relationPriorityByExpansion(
  expansionIntent: QaExpansionIntent,
  primaryIntent: string
): RelationType[] {
  const base = relationPriorityByIntent(primaryIntent);
  const preferred: RelationType | null =
    expansionIntent === "evidence_strengthening"
      ? "supports"
      : expansionIntent === "example_request"
      ? "example_of"
      : expansionIntent === "related_topic_expansion"
      ? "related"
      : null;
  if (!preferred) return base;
  return [preferred, ...base.filter((t) => t !== preferred)];
}

function looksLikeUuid(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}

function isSemanticallyContinuous(question: string, previousUserQuestion?: string | null): boolean {
  if (!previousUserQuestion?.trim()) return false;
  const a = new Set(extractQueryTerms(question).map((x) => x.toLowerCase()));
  const b = new Set(extractQueryTerms(previousUserQuestion).map((x) => x.toLowerCase()));
  if (!a.size || !b.size) return false;
  let overlap = 0;
  for (const t of a) {
    if (b.has(t)) overlap += 1;
  }
  return overlap >= 1;
}

// R7-C02: explicit follow-up / anaphora reference. Continuation questions like
// "继续上一个话题" or "再展开说说" may share no terms with the previous question,
// so term-overlap continuity misses them. When these markers appear, we force-reuse
// the previous round's cited notes as graph seeds.
const FOLLOWUP_REFERENCE_MARKERS = [
  "继续", "接着", "上一个", "上个", "上面", "上述", "刚才", "刚刚", "之前", "前面",
  "那个", "这个", "再讲", "再说", "展开", "详细说", "具体说", "顺着", "延续",
];
function isFollowupReference(question: string): boolean {
  const q = (question || "").trim().toLowerCase();
  if (!q) return false;
  return FOLLOWUP_REFERENCE_MARKERS.some((m) => q.includes(m.toLowerCase()));
}

// R7-C01: collect topic terms from the current question plus the most recent
// user questions in the session, so retrieval can re-rank toward the on-going topic.
function buildSessionTopicTerms(
  question: string,
  history: Array<{ role: string; content: string }>,
  maxPrevUserTurns = 2
): Set<string> {
  const terms = new Set<string>(extractQueryTerms(question).map((x) => x.toLowerCase()));
  const prevUserQuestions = [...(history || [])]
    .filter((m) => m.role === "user" && m.content && m.content !== question)
    .slice(-maxPrevUserTurns);
  for (const m of prevUserQuestions) {
    for (const t of extractQueryTerms(m.content)) terms.add(t.toLowerCase());
  }
  return terms;
}

// R7-C01: gently lift on-topic chunks above marginally-higher off-topic ones.
// Adds a bounded topic bonus to similarity for ranking only (does not mutate stored similarity).
function reorderChunksBySessionTopic<
  T extends { content: string; note_title: string; similarity: number }
>(chunks: T[], topicTerms: Set<string>): T[] {
  if (!chunks.length || !topicTerms.size) return chunks;
  const scoreOf = (c: T) => {
    const blob = `${c.note_title || ""}\n${c.content || ""}`.toLowerCase();
    let hits = 0;
    for (const t of topicTerms) {
      if (t.length >= 2 && blob.includes(t)) hits += 1;
    }
    const titleBlob = (c.note_title || "").toLowerCase();
    let titleHits = 0;
    for (const t of topicTerms) {
      if (t.length >= 2 && titleBlob.includes(t)) titleHits += 1;
    }
    const bonus = Math.min(0.15, hits * 0.04 + titleHits * 0.03);
    return Number(c.similarity || 0) + bonus;
  };
  return [...chunks]
    .map((c, i) => ({ c, i, s: scoreOf(c) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.c);
}


async function expandNoteIdsByGraph(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  seedNoteIds: string[],
  relationPriority: RelationType[],
  budget: number,
  hops: number
): Promise<{ noteIds: string[]; gain: number; stopReason: string; traversedEdges: number }> {
  if (!seedNoteIds.length) return { noteIds: [], gain: 0, stopReason: "no_seed", traversedEdges: 0 };
  const visited = new Set<string>(seedNoteIds);
  let frontier = [...seedNoteIds];
  let traversedEdges = 0;
  const allowed = new Set(relationPriority);
  const typeRank = new Map(relationPriority.map((t, i) => [t, i]));

  for (let hop = 0; hop < hops; hop += 1) {
    if (!frontier.length) return { noteIds: [...visited], gain: visited.size - seedNoteIds.length, stopReason: "frontier_exhausted", traversedEdges };
    if (visited.size - seedNoteIds.length >= budget) return { noteIds: [...visited], gain: visited.size - seedNoteIds.length, stopReason: "budget_reached", traversedEdges };

    const { data: relRows, error } = await supabase
      .from("note_relations")
      .select("source_note_id, target_note_id, relation_type")
      .eq("user_id", userId)
      .or(`source_note_id.in.(${frontier.join(",")}),target_note_id.in.(${frontier.join(",")})`)
      .limit(500);
    if (error || !relRows?.length) {
      return { noteIds: [...visited], gain: visited.size - seedNoteIds.length, stopReason: "no_relations", traversedEdges };
    }

    const typed = relRows
      .filter((r) => allowed.has(r.relation_type as RelationType))
      .sort((a, b) => (typeRank.get(a.relation_type as RelationType) ?? 99) - (typeRank.get(b.relation_type as RelationType) ?? 99));
    traversedEdges += typed.length;
    const next: string[] = [];

    for (const r of typed) {
      const peers = [r.source_note_id, r.target_note_id].filter(Boolean);
      for (const id of peers) {
        if (visited.has(id)) continue;
        visited.add(id);
        next.push(id);
        if (visited.size - seedNoteIds.length >= budget) {
          return { noteIds: [...visited], gain: visited.size - seedNoteIds.length, stopReason: "budget_reached", traversedEdges };
        }
      }
    }
    frontier = next;
  }
  return { noteIds: [...visited], gain: visited.size - seedNoteIds.length, stopReason: "hop_limit", traversedEdges };
}

async function retrieveFromSourceChunks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  questionEmbedding: number[],
  threshold: number,
  topK: number
) {
  const { data, error } = await supabase.rpc("match_source_chunks", {
    query_embedding: questionEmbedding,
    p_user_id: userId,
    match_threshold: threshold,
    match_count: topK,
  });
  if (error || !data?.length) return [] as Array<{
    id: string;
    note_id: string;
    chunk_index: number;
    content: string;
    note_title: string;
    similarity: number;
  }>;

  const itemIds = Array.from(new Set((data as Array<{ capture_item_id: string }>).map((r) => r.capture_item_id).filter(Boolean)));
  const { data: notes } = await supabase
    .from("notes")
    .select("id, title, capture_item_id")
    .eq("user_id", userId)
    .in("capture_item_id", itemIds);

  const byCaptureItem = new Map<string, { id: string; title: string }>();
  for (const n of notes || []) {
    if (n.capture_item_id && !byCaptureItem.has(n.capture_item_id)) {
      byCaptureItem.set(n.capture_item_id, { id: n.id, title: n.title || "未命名笔记" });
    }
  }

  return (data as Array<{
    id: string;
    capture_item_id: string;
    chunk_index: number;
    content: string;
    similarity: number;
    source_type?: string;
  }>)
    .map((r) => {
      const mapped = byCaptureItem.get(r.capture_item_id);
      return {
        id: r.id,
        note_id: mapped?.id || `source-${r.capture_item_id}`,
        chunk_index: r.chunk_index ?? 0,
        content: r.content || "",
        note_title: mapped?.title || `原文片段（${r.source_type || "source"}）`,
        similarity: Number(r.similarity || 0.55),
      };
    })
    .filter((r) => r.content.trim().length > 0);
}

function parseMode(rawQuestion: string): { mode: QaMode; question: string } {
  const q = rawQuestion.trim();
  const low = q.toLowerCase();
  if (low.startsWith("/notes ")) return { mode: "notes", question: q.slice(7).trim() };
  if (low === "/notes") return { mode: "notes", question: "" };
  if (low.startsWith("/general ")) return { mode: "general", question: q.slice(9).trim() };
  if (low === "/general") return { mode: "general", question: "" };
  if (low.startsWith("/online ")) return { mode: "online", question: q.slice(8).trim() };
  if (low === "/online") return { mode: "online", question: "" };
  return { mode: "notes", question: q };
}

function buildHistoryContext(messages: Array<{ role: string; content: string }>): string {
  if (!messages.length) return "";
  const history = messages
    .slice(-qaContextRounds())
    .map((m) => `${m.role === "assistant" ? "AI" : "User"}: ${m.content}`)
    .join("\n");
  return `\n\n最近对话上下文（供参考）：\n${history}`;
}

function buildStructuredInstruction(
  intentText: string,
  isRelationCheck = false,
  answerStrategy: "answerable" | "partial" | "insufficient" = "answerable"
): string {
  const relationClause = isRelationCheck
    ? `\n\n注意：本问题是“是否关联/是否相关”类判断。若证据显示两者没有明显关联，请明确回答“暂无直接关联”，并简述判断依据，不要笼统地说“证据不足”。`
    : "";
  // Phase 5.6: answer strategy steers how strongly the model commits.
  const strategyClause =
    answerStrategy === "partial"
      ? `\n\n作答策略：证据中等。请先给出当前最稳妥的判断，再用“不确定项”明确指出证据边界与缺口，不要假装证据充分。`
      : answerStrategy === "insufficient"
      ? `\n\n作答策略：证据较弱。请只给出能被证据支撑的有限结论，并明确说明哪些部分证据不足、无法可靠回答。`
      : "";
  return `请严格按以下结构输出，并保持简洁可执行。
1) 结论
2) 依据（仅使用给定证据，不要臆测）
3) 可执行下一步（1-3条）
4) 不确定项（若证据不足必须明确说明）

当前意图类型：${intentText}${relationClause}${strategyClause}`;
}

function calcEvidence(chunks: Array<{ similarity: number }>): { score: number; level: "high" | "low" | "unknown" } {
  if (!chunks.length) return { score: 0, level: "unknown" };
  const sims = chunks.map((c) => Number(c.similarity || 0)).filter((n) => Number.isFinite(n));
  if (!sims.length) return { score: 0, level: "unknown" };
  const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
  if (avg >= 0.78) return { score: avg, level: "high" };
  if (avg >= 0.65) return { score: avg, level: "low" };
  return { score: avg, level: "unknown" };
}

// Phase 5.6: explicit three-tier answer strategy from evidence + recall breadth.
// answerable: enough evidence to answer directly.
// partial: some on-topic evidence but weak/sparse -> answer with stated boundaries.
// insufficient: too little to answer reliably.
function deriveAnswerStrategy(
  level: "high" | "low" | "unknown",
  chunkCount: number
): "answerable" | "partial" | "insufficient" {
  if (level === "high") return "answerable";
  if (level === "low") return chunkCount >= 2 ? "partial" : "insufficient";
  // unknown
  return chunkCount >= 3 ? "partial" : "insufficient";
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const candidates: string[] = [text];
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  return null;
}

function qaModelOverride(stage: "decision" | "answer"): string | undefined {
  const model = stage === "decision" ? process.env.QA_DECISION_MODEL : process.env.QA_ANSWER_MODEL;
  return model && model.trim() ? model.trim() : undefined;
}

function dedupeCitations<T extends { source?: "knowledge" | "web"; note_id?: string; title?: string; url?: string }>(
  citations: T[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of citations || []) {
    const sourceType = c.source || "knowledge";
    const key = sourceType === "web" ? `web:${c.url || c.title || ""}` : `knowledge:${c.note_id || c.title || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function trimNoisyCitations<
  T extends { source?: "knowledge" | "web"; similarity?: number }
>(
  citations: T[],
  options: { relationCheck: boolean; evidenceLevel: "high" | "low" | "unknown" }
): T[] {
  const knowledge = citations.filter((c) => (c.source || "knowledge") === "knowledge");
  const web = citations.filter((c) => c.source === "web");
  const sortedKnowledge = [...knowledge].sort((a, b) => Number(b.similarity || 0) - Number(a.similarity || 0));
  if (options.relationCheck || options.evidenceLevel !== "high") {
    const thresholded = sortedKnowledge.filter((c) => Number(c.similarity || 0) >= 0.62);
    return [...thresholded.slice(0, 2), ...web.slice(0, 2)];
  }
  return [...sortedKnowledge.slice(0, 5), ...web.slice(0, 3)];
}

function extractQueryTerms(question: string): string[] {
  const q = question.toLowerCase().trim();
  const stop = new Set([
    "请", "帮", "我", "一下", "一个", "这个", "那个", "关于", "什么", "怎么", "如何", "是否", "简单", "介绍", "讲讲",
    "请问", "可以", "帮忙",
  ]);
  const latinTokens = q
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((w) => !stop.has(w) && w.length >= 2);
  const zhTerms = (q.match(/[\u4e00-\u9fa5]{2,12}/g) || [])
    .flatMap((seg) => {
      const s = seg.trim();
      if (!s || stop.has(s)) return [];
      const parts = [s];
      if (s.length >= 3) parts.push(s.slice(0, 3));
      if (s.length >= 4) parts.push(s.slice(-3));
      return parts;
    })
    .filter((w) => !stop.has(w) && w.length >= 2);
  return Array.from(new Set([...zhTerms, ...latinTokens])).slice(0, 8);
}

async function queryNotesByPatterns(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  patterns: string[],
  columns: string
) {
  const merged = new Map<string, { id: string; title?: string; content?: string }>();
  for (const pattern of patterns.slice(0, 5)) {
    const safe = pattern.replace(/[%_]/g, "");
    if (!safe) continue;
    const { data } = await supabase
      .from("notes")
      .select(columns)
      .eq("user_id", userId)
      .or(`title.ilike.%${safe}%,summary.ilike.%${safe}%,content.ilike.%${safe}%`)
      .order("created_at", { ascending: false })
      .limit(8);
    const rows = ((data || []) as unknown) as Array<{ id: string; title?: string; content?: string }>;
    for (const row of rows) {
      if (row?.id && !merged.has(row.id)) merged.set(row.id, row);
    }
  }
  return Array.from(merged.values());
}

async function coarseRecallNotes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  question: string
): Promise<string[]> {
  const terms = extractQueryTerms(question);
  if (!terms.length) return [];
  const rows = await queryNotesByPatterns(supabase, userId, terms, "id");
  return rows.map((x) => x.id).filter(Boolean).slice(0, 20);
}

async function keywordFallbackRecall(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  question: string
) {
  const terms = extractQueryTerms(question);
  if (!terms.length) return [] as Array<{
    id: string;
    note_id: string;
    chunk_index: number;
    content: string;
    note_title: string;
    similarity: number;
  }>;

  const notes = await queryNotesByPatterns(supabase, userId, terms, "id, title, content");
  if (!notes.length) return [];

  const rows = notes
    .map((n) => {
      const content = String(n.content || "");
      const idx = terms
        .map((t) => content.toLowerCase().indexOf(t))
        .filter((x) => x >= 0)
        .sort((a, b) => a - b)[0] ?? -1;
      const start = idx >= 0 ? Math.max(0, idx - 120) : 0;
      const excerpt = content.slice(start, start + 420).trim() || content.slice(0, 420).trim();
      return {
        id: `kw-${n.id}`,
        note_id: n.id,
        chunk_index: 0,
        content: excerpt,
        note_title: n.title || "未命名笔记",
        similarity: 0.58,
      };
    })
    .filter((x) => x.content.length > 20);

  return rows;
}

function fuseChunks(
  chunks: Array<{
    id: string;
    note_id: string;
    chunk_index: number;
    content: string;
    note_title: string;
    similarity: number;
  }>
) {
  const byKey = new Map<string, typeof chunks[number]>();
  for (const c of chunks) {
    const key = `${c.note_id}:${c.chunk_index}`;
    const prev = byKey.get(key);
    if (!prev || c.similarity > prev.similarity) byKey.set(key, c);
  }

  const deduped = Array.from(byKey.values()).sort((a, b) => b.similarity - a.similarity);

  const byNote = new Map<string, typeof deduped>();
  for (const c of deduped) {
    if (!byNote.has(c.note_id)) byNote.set(c.note_id, []);
    byNote.get(c.note_id)!.push(c);
  }

  const fused: typeof deduped = [];
  for (const [, arr] of byNote.entries()) {
    fused.push(...arr.slice(0, 2));
  }

  return fused.sort((a, b) => b.similarity - a.similarity);
}

export async function POST(request: Request) {
  const traceId = randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      errorBody(ERROR_CODES.unauthorized, "Unauthorized", traceId),
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const rawQuestion = typeof body.question === "string" ? body.question : "";
  const { mode, question: modeQuestion } = parseMode(rawQuestion);
  const { question, filters } = parseQuestionFilters(modeQuestion);
  const intentResult = detectIntent(question);
  const intent = intentResult.intent;
  const intentText = intentLabel(intent);
  const relationCheck = isRelationCheckQuestion(question);
  const expansionIntent = detectExpansionIntent(question);
  const defaultRetrieval = retrievalPreset(intent);
  const topK = typeof body.topK === "number" ? body.topK : defaultRetrieval.topK;
  const threshold = typeof body.threshold === "number" ? body.threshold : defaultRetrieval.threshold;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  const preferredNoteIds = Array.isArray(body.preferredNoteIds)
    ? body.preferredNoteIds.filter((x: unknown): x is string => typeof x === "string" && looksLikeUuid(x)).slice(0, 8)
    : [];

  if (!question?.trim()) {
    return NextResponse.json(
      errorBody(ERROR_CODES.bad_request, "question is required", traceId),
      { status: 400 }
    );
  }

  try {
    console.info("[qa] start", {
      trace_id: traceId,
      user_id: user.id,
      top_k: topK,
      threshold,
      intent,
      mode,
      session_id: sessionId,
      preferred_note_count: preferredNoteIds.length,
      filters,
    });

    let effectiveSessionId = sessionId;
    if (!effectiveSessionId) {
      const { data: createdSession, error: sessionCreateError } = await supabase
        .from("qa_sessions")
        .insert({ user_id: user.id, title: question.slice(0, 40), mode })
        .select("id")
        .single();
      if (sessionCreateError || !createdSession) {
        throw new Error(sessionCreateError?.message || "failed to create session");
      }
      effectiveSessionId = createdSession.id;
    } else {
      const { data: existingSession } = await supabase
        .from("qa_sessions")
        .select("id, title")
        .eq("id", effectiveSessionId)
        .eq("user_id", user.id)
        .single();
      if (!existingSession) {
        return NextResponse.json(
          errorBody(ERROR_CODES.bad_request, "invalid sessionId", traceId),
          { status: 400 }
        );
      }
      // Keep sidebar history meaningful: replace default placeholder title
      // with the first real user question when a new session starts being used.
      if (!existingSession.title || existingSession.title === "新建对话") {
        await supabase
          .from("qa_sessions")
          .update({ title: question.slice(0, 40) })
          .eq("id", effectiveSessionId)
          .eq("user_id", user.id);
      }
    }

    await supabase.from("qa_messages").insert({
      session_id: effectiveSessionId,
      user_id: user.id,
      role: "user",
      content: question,
      trace_id: traceId,
      evidence_level: "unknown",
    });

    const { data: historyRows } = await supabase
      .from("qa_messages")
      .select("role, content, citations")
      .eq("user_id", user.id)
      .eq("session_id", effectiveSessionId)
      .order("created_at", { ascending: true })
      .limit(12);

    let answer = "";
    let citations: Array<{
      note_id: string;
      chunk_index: number;
      title: string;
      excerpt: string;
      source?: "knowledge" | "web";
      url?: string;
      fetched_at?: string;
      similarity?: number;
    }> = [];
    let evidenceLevel: "high" | "low" | "unknown" = "unknown";
    let evidenceScore = 0;
    let answerStrategy: "answerable" | "partial" | "insufficient" = "insufficient";
    let retrievalStage = "none";
    let graphExpandMeta: Record<string, unknown> | null = null;
    let graphExpandedNoteIds: Set<string> = new Set();
    let decisionMeta: Record<string, unknown> | null = null;
    let synthesisMeta: Record<string, unknown> | null = null;

    if (mode === "general") {
      answer = await withRetry(
        () =>
          generateCompletion(
            RAG_QA_SYSTEM,
            `${buildStructuredInstruction(intentText, relationCheck)}\n\n问题：${question}${buildHistoryContext(historyRows || [])}`,
            { useCase: "qa" }
          ),
        { attempts: 2, timeoutMs: 30000 }
      );
      evidenceLevel = "low";
      evidenceScore = 0.5;
      answerStrategy = "partial";
    } else if (mode === "online") {
      const webItems = await retrieveOnlineEvidence(question, onlineMaxEvidence());
      if (!webItems.length) {
        answer = "未检索到可用的网页证据，请换个关键词或稍后再试。";
        evidenceLevel = "unknown";
        evidenceScore = 0;
        answerStrategy = "insufficient";
      } else {
        const webContext = webItems
          .map((w, i) => `[Web ${i + 1}] ${w.title}\nURL: ${w.url}\n内容: ${w.snippet}`)
          .join("\n\n");
        answer = await withRetry(
          () =>
            generateCompletion(
              RAG_QA_SYSTEM,
              `${buildStructuredInstruction(intentText, relationCheck)}\n\n问题：${question}${buildHistoryContext(
                historyRows || []
              )}\n\n网页证据：\n${webContext}`,
              { useCase: "qa" }
            ),
          { attempts: 2, timeoutMs: 35000 }
        );
        citations = dedupeCitations(webItems.map((w, i) => ({
          note_id: `web-${i + 1}`,
          chunk_index: i + 1,
          title: w.title,
          excerpt: w.snippet.slice(0, 200),
          source: "web",
          url: w.url,
          fetched_at: w.fetched_at,
        })));
        evidenceLevel = "low";
        evidenceScore = 0.58;
        answerStrategy = "partial";
      }
    } else {
      const questionEmbedding = await withRetry(() => generateEmbedding(question), {
        attempts: 2,
        timeoutMs: 20000,
      });

      let chunks: Array<{
        id: string;
        note_id: string;
        chunk_index: number;
        content: string;
        note_title: string;
        similarity: number;
      }> = [];

      let vectorAvailable = true;

      // Stage 0: preferred-note recall (for "ask from this note").
      // Strategy: prioritize current note first; if evidence is insufficient, continue global pipeline.
      if (preferredNoteIds.length > 0) {
        try {
          const preferredTopK = Math.max(topK, 10);
          const preferredThreshold = Math.max(0.5, threshold - 0.1);
          const { data: preferredData, error: preferredErr } = await supabase.rpc("match_note_chunks_in_notes", {
            query_embedding: questionEmbedding,
            p_user_id: user.id,
            p_note_ids: preferredNoteIds,
            match_threshold: preferredThreshold,
            match_count: preferredTopK,
          });
          if (!preferredErr && preferredData?.length) {
            chunks = preferredData;
            retrievalStage = "preferred_note_vector";
            console.info("[qa] preferred_note_hit", {
              trace_id: traceId,
              user_id: user.id,
              preferred_note_count: preferredNoteIds.length,
              chunk_count: chunks.length,
            });
          }
        } catch (preferredRecallErr) {
          console.warn("[qa] preferred_note_failed", { trace_id: traceId, error: String(preferredRecallErr) });
        }
      }

      // Stage 1: coarse recall on title/summary.
      const candidateNoteIds = await coarseRecallNotes(supabase, user.id, question);
      console.info("[qa] coarse_recall", {
        trace_id: traceId,
        user_id: user.id,
        candidate_count: candidateNoteIds.length,
      });

      // Stage 2: scoped vector recall in candidate notes.
      if (
        candidateNoteIds.length > 0 &&
        chunks.length < Math.max(4, Math.floor(topK * 0.8))
      ) {
        try {
          const scopedTopK = Math.max(topK, 10);
          const scopedThreshold = Math.max(0.55, threshold - 0.08);
          const { data: scopedData, error: scopedError } = await supabase.rpc("match_note_chunks_in_notes", {
            query_embedding: questionEmbedding,
            p_user_id: user.id,
            p_note_ids: candidateNoteIds,
            match_threshold: scopedThreshold,
            match_count: scopedTopK,
          });
          if (!scopedError && scopedData?.length) {
            chunks = chunks.length ? fuseChunks([...(chunks || []), ...scopedData]) : scopedData;
            retrievalStage = retrievalStage === "none" ? "scoped_vector" : `${retrievalStage}+scoped_vector`;
            console.info("[qa] scoped_vector_hit", {
              trace_id: traceId,
              user_id: user.id,
              chunk_count: chunks.length,
            });
          }
        } catch (err) {
          console.warn("[qa] scoped_vector_failed", { trace_id: traceId, error: String(err) });
        }
      }

      // Stage 3: global vector fallback.
      if (!chunks.length || chunks.length < Math.max(3, Math.floor(topK * 0.7))) {
        try {
          const { data, error } = await supabase.rpc("match_note_chunks", {
            query_embedding: questionEmbedding,
            match_threshold: threshold,
            match_count: topK,
            p_user_id: user.id,
          });
          if (error) throw new Error(error.message || "match_note_chunks failed");
          if (data?.length) {
            chunks = chunks.length ? fuseChunks([...(chunks || []), ...data]) : data;
            retrievalStage = retrievalStage === "none" ? "global_vector" : `${retrievalStage}+global_vector`;
          }
        } catch (rpcErr) {
          vectorAvailable = false;
          console.error("[qa] match_note_chunks unavailable", { trace_id: traceId, error: String(rpcErr) });
        }
      }

      if (!vectorAvailable && !chunks.length) {
        return NextResponse.json({
          code: ERROR_CODES.qa_vector_unavailable,
          answer: "知识检索暂时不可用（网络或数据库连接异常）。请稍后重试。",
          citations: [],
          answerId: null,
          trace_id: traceId,
          sessionId: effectiveSessionId,
          mode,
          intent,
          intentConfidence: intentResult.confidence,
          evidence_level: "low",
          evidence_score: 0,
          evidence_items: [],
          uncertainties: ["知识库检索链路异常，请稍后重试。"],
        });
      }

      // Stage 3.5: source chunk fallback (original content retrieval), before graph expansion.
      if (!chunks.length && !hasFilters(filters)) {
        try {
          const sourceThreshold = Math.max(0.52, threshold - 0.1);
          const sourceTopK = Math.max(topK, 10);
          const sourceRows = await retrieveFromSourceChunks(
            supabase,
            user.id,
            questionEmbedding,
            sourceThreshold,
            sourceTopK
          );
          if (sourceRows.length) {
            chunks = sourceRows;
            retrievalStage = "source_vector";
            console.info("[qa] source_vector_hit", {
              trace_id: traceId,
              user_id: user.id,
              chunk_count: chunks.length,
              source_threshold: sourceThreshold,
            });
          }
        } catch (sourceErr) {
          console.warn("[qa] source_vector_failed", { trace_id: traceId, error: String(sourceErr) });
        }
      }

      // Adaptive fallback: if no result on strict retrieval, retry with relaxed threshold.
      if (!chunks.length && !hasFilters(filters)) {
        try {
          const relaxedThreshold = Math.max(0.5, threshold - 0.12);
          const relaxedTopK = Math.max(topK, 12);
          const { data: retryData, error: retryError } = await supabase.rpc("match_note_chunks", {
            query_embedding: questionEmbedding,
            match_threshold: relaxedThreshold,
            match_count: relaxedTopK,
            p_user_id: user.id,
          });
          if (!retryError && retryData?.length) {
            chunks = retryData;
            retrievalStage = "adaptive_vector";
            console.info("[qa] adaptive_recall_hit", {
              trace_id: traceId,
              user_id: user.id,
              original_threshold: threshold,
              retry_threshold: relaxedThreshold,
              original_topk: topK,
              retry_topk: relaxedTopK,
              chunk_count: chunks.length,
            });
          }
        } catch (retryErr) {
          console.warn("[qa] adaptive_recall_failed", { trace_id: traceId, error: String(retryErr) });
        }
      }

      if (!chunks.length) {
        const keywordRows = await keywordFallbackRecall(supabase, user.id, question);
        if (keywordRows.length) {
          chunks = keywordRows;
          retrievalStage = "keyword_fallback";
          console.info("[qa] keyword_fallback_hit", {
            trace_id: traceId,
            user_id: user.id,
            chunk_count: chunks.length,
          });
        }
      }

      // Stage 3.7: follow-up reuse (R7-C02). When the question is an explicit follow-up
      // reference ("继续/上一个/刚才/展开"...), reuse the previous round's cited notes directly,
      // independent of sparsity. This rescues cases where the current question confidently
      // mis-recalled to off-topic notes instead of staying on the previous topic.
      let followupReuse = false;
      let followupReferenceActive = false;
      let followupPrevNoteIds: string[] = [];
      if (!hasFilters(filters) && isFollowupReference(question)) {
        try {
          followupReferenceActive = true;
          const prevCitations = [...(historyRows || [])]
            .reverse()
            .find((m) => m.role === "assistant" && Array.isArray(m.citations))?.citations as
            | Array<{ note_id?: string; source?: string }>
            | undefined;
          const prevNoteIds = Array.from(
            new Set(
              (prevCitations || [])
                .filter((c) => c?.source === "knowledge" && c?.note_id && looksLikeUuid(c.note_id))
                .map((c) => c.note_id as string)
            )
          ).slice(0, 6);
          followupPrevNoteIds = prevNoteIds;
          if (prevNoteIds.length) {
            const reuseTopK = Math.max(topK, 10);
            const reuseThreshold = Math.max(0.48, threshold - 0.12);
            const { data: reuseData, error: reuseErr } = await supabase.rpc("match_note_chunks_in_notes", {
              query_embedding: questionEmbedding,
              p_user_id: user.id,
              p_note_ids: prevNoteIds,
              match_threshold: reuseThreshold,
              match_count: reuseTopK,
            });
            if (!reuseErr && reuseData?.length) {
              // Strong anchor for explicit follow-up: prefer previous cited-note scope first.
              if (reuseData.length >= 2) {
                chunks = reuseData;
                followupReuse = true;
                retrievalStage = "followup_locked";
                console.info("[qa] followup_locked", {
                  trace_id: traceId,
                  user_id: user.id,
                  reused_note_count: prevNoteIds.length,
                  reuse_chunk_count: reuseData.length,
                });
              } else {
                const merged = fuseChunks([...(chunks || []), ...reuseData]);
                if (merged.length >= (chunks?.length || 0)) {
                  chunks = merged;
                  followupReuse = true;
                  retrievalStage = retrievalStage === "none" ? "followup_reuse" : `${retrievalStage}+followup_reuse`;
                }
              }
              if (followupReuse) {
                followupReuse = true;
                console.info("[qa] followup_reuse_hit", {
                  trace_id: traceId,
                  user_id: user.id,
                  reused_note_count: prevNoteIds.length,
                  reuse_chunk_count: reuseData.length,
                });
              }
            }
          }
        } catch (reuseErr) {
          console.warn("[qa] followup_reuse_failed", { trace_id: traceId, error: String(reuseErr) });
        }
      }

      // Stage 4: graph-guided expansion retrieval (Phase 5B)
      // Trigger only in notes mode without manual filters and when current evidence is sparse.
      if (!hasFilters(filters) && (chunks.length < Math.max(4, Math.floor(topK * 0.8)))) {
        try {
          const seedNoteIds = Array.from(new Set(chunks.map((c) => c.note_id).filter(looksLikeUuid))).slice(0, 10);
          const previousUserQuestion = [...(historyRows || [])]
            .reverse()
            .find((m) => m.role === "user" && m.content !== question)?.content;
          const semanticallyContinuous = isSemanticallyContinuous(question, previousUserQuestion);
          // R7-C02: explicit follow-up reference ("继续/上一个/刚才/展开"...) forces seed reuse
          // even when the new question shares no terms with the previous one.
          const followupReference = isFollowupReference(question);
          const reusePreviousContext = semanticallyContinuous || followupReference;
          const previousAssistantCitations = [...(historyRows || [])]
            .reverse()
            .find((m) => m.role === "assistant" && Array.isArray(m.citations))?.citations as
            | Array<{ note_id?: string; source?: string }>
            | undefined;
          const previousNoteIds = reusePreviousContext
            ? Array.from(
                new Set(
                  (previousAssistantCitations || [])
                    .filter((c) => c?.source === "knowledge" && c?.note_id && looksLikeUuid(c.note_id))
                    .map((c) => c.note_id as string)
                )
              ).slice(0, 6)
            : [];
          const mergedSeedIds = Array.from(
            new Set(
              followupReferenceActive && followupPrevNoteIds.length
                ? [...followupPrevNoteIds, ...seedNoteIds]
                : [...seedNoteIds, ...previousNoteIds]
            )
          ).slice(0, 12);
          const relationPriority = relationPriorityByExpansion(expansionIntent, intent);
          const expand = await expandNoteIdsByGraph(
            supabase,
            user.id,
            mergedSeedIds,
            relationPriority,
            graphExpandBudget(),
            graphExpandHops()
          );
          const gain = Number(expand.gain || 0);
          graphExpandMeta = {
            seed_count: seedNoteIds.length,
            reused_seed_count: previousNoteIds.length,
            semantically_continuous: semanticallyContinuous,
            followup_reference: followupReference,
            followup_reuse_applied: followupReuse,
            expansion_intent: expansionIntent,
            expanded_count: expand.noteIds.length,
            gain,
            traversed_edges: expand.traversedEdges,
            stop_reason: expand.stopReason,
            relation_priority: relationPriority,
          };

          if (gain >= graphExpandMinGain() && expand.noteIds.length > 0) {
            // Track which notes came purely from graph expansion (for 5C reuse rate metric).
            const seedSet = new Set(mergedSeedIds);
            for (const nid of expand.noteIds) { if (!seedSet.has(nid)) graphExpandedNoteIds.add(nid); }
            const scopedTopK = Math.max(topK, 12);
            const scopedThreshold = Math.max(0.5, threshold - 0.08);
            const { data: expandedData, error: expandedErr } = await supabase.rpc("match_note_chunks_in_notes", {
              query_embedding: questionEmbedding,
              p_user_id: user.id,
              p_note_ids: expand.noteIds,
              match_threshold: scopedThreshold,
              match_count: scopedTopK,
            });
            if (!expandedErr && expandedData?.length) {
              const merged = fuseChunks([...(chunks || []), ...expandedData]);
              if (merged.length > (chunks?.length || 0)) {
                chunks = merged;
                retrievalStage = "graph_expanded_vector";
              }
            }
          } else {
            retrievalStage = `${retrievalStage}+graph_skip`;
          }
          console.info("[qa] graph_expand", {
            trace_id: traceId,
            user_id: user.id,
            ...graphExpandMeta,
          });
        } catch (expandErr) {
          console.warn("[qa] graph_expand_failed", { trace_id: traceId, error: String(expandErr) });
        }
      }

      if (hasFilters(filters) && chunks.length > 0) {
        const uniqueNoteIds = Array.from(new Set(chunks.map((c) => c.note_id)));
        const { data: noteRows } = await supabase
          .from("notes")
          .select("id, tags, source, created_at")
          .in("id", uniqueNoteIds)
          .eq("user_id", user.id);

        const noteMap = new Map(
          (noteRows || []).map((n) => [n.id, { tags: n.tags || [], source: n.source || "", created_at: n.created_at }])
        );

        chunks = chunks.filter((c) => {
          const meta = noteMap.get(c.note_id);
          if (!meta) return false;
          if (filters.tags.length > 0) {
            const s = new Set((meta.tags || []).map((x: string) => x.toLowerCase()));
            if (!filters.tags.every((t) => s.has(t.toLowerCase()))) return false;
          }
          if (filters.source && !String(meta.source || "").toLowerCase().includes(filters.source.toLowerCase())) {
            return false;
          }
          if (filters.dateGte && new Date(meta.created_at) < new Date(filters.dateGte)) return false;
          if (filters.dateLte && new Date(meta.created_at) > new Date(filters.dateLte)) return false;
          return true;
        });
      }

      if (!chunks.length) {
        const uncertainAnswer = relationCheck
          ? "根据当前知识库中的笔记，暂未发现两者之间的直接关联。若你认为它们应当相关，可补充内化更多相关笔记后再问。"
          : "当前知识库中没有足够证据支持回答该问题。请先内化更多相关笔记后再试。";
        let answerId: string | null = null;
        try {
          const { data: record } = await supabase
            .from("ai_answers")
            .insert({
              user_id: user.id,
              question,
              answer: uncertainAnswer,
              citations: [],
            })
            .select()
            .single();
          if (record) answerId = record.id;
        } catch {
          // non-fatal
        }

        await supabase.from("qa_messages").insert({
          session_id: effectiveSessionId,
          user_id: user.id,
          role: "assistant",
          content: uncertainAnswer,
          citations: [],
          trace_id: traceId,
          evidence_level: "low",
        });

        await supabase.from("qa_sessions").update({ updated_at: new Date().toISOString() }).eq("id", effectiveSessionId).eq("user_id", user.id);

        console.info("[qa] insufficient_evidence", { trace_id: traceId, user_id: user.id, session_id: effectiveSessionId });
        return NextResponse.json({
          code: ERROR_CODES.qa_insufficient_evidence,
          answer: uncertainAnswer,
          citations: [],
          answerId,
          trace_id: traceId,
          sessionId: effectiveSessionId,
          mode,
        });
      }

      const fusedChunks = fuseChunks(chunks);
      // R7-C01: re-rank fused chunks toward the on-going session topic, so a marginally
      // higher-similarity off-topic note does not outrank on-topic evidence.
      const sessionTopicTerms = buildSessionTopicTerms(question, historyRows || []);
      const rankedChunks = reorderChunksBySessionTopic(fusedChunks, sessionTopicTerms);
      const formattedChunks = rankedChunks.map((c, i) => ({
        index: i + 1,
        content: c.content,
        title: c.note_title || "未命名笔记",
        note_id: c.note_id,
        chunk_index: c.chunk_index,
        similarity: Number(c.similarity || 0),
      }));

      // Phase 5.6 baseline evidence score, used by Phase 6 decision/synthesis/answer chain.
      const ev = calcEvidence(fusedChunks);
      evidenceLevel = ev.level;
      evidenceScore = ev.score;
      answerStrategy = deriveAnswerStrategy(ev.level, formattedChunks.length);
      const historyText = (historyRows || [])
        .slice(-qaContextRounds())
        .map((m) => `${m.role === "assistant" ? "AI" : "User"}: ${m.content}`)
        .join("\n");

      const decisionRaw = await withRetry(
        () =>
          generateCompletion(
            QA_DECISION_SYSTEM,
            qaDecisionUserPrompt({
              question,
              historyText,
              detectedIntent: intent,
              expansionIntent,
              relationCheck,
              evidenceLevelHint: evidenceLevel,
              chunkCountHint: formattedChunks.length,
            }),
            { useCase: "qa", model: qaModelOverride("decision"), maxOutputTokens: 800 }
          ),
        { attempts: 2, timeoutMs: 25000 }
      );
      const decisionJson = parseJsonObject(decisionRaw) || {};
      decisionMeta = decisionJson;

      const synthesisRaw = await withRetry(
        () =>
          generateCompletion(
            QA_SYNTHESIS_SYSTEM,
            qaSynthesisUserPrompt({
              question,
              chunks: formattedChunks.map((c) => ({ index: c.index, content: c.content, title: c.title })),
            }),
            { useCase: "qa", model: qaModelOverride("answer"), maxOutputTokens: 1200 }
          ),
        { attempts: 2, timeoutMs: 30000 }
      );
      const synthesisJson = parseJsonObject(synthesisRaw) || {};
      synthesisMeta = synthesisJson;
      const reasoningBrief = typeof synthesisJson.reasoning_brief === "string" ? synthesisJson.reasoning_brief : "";
      const conflicts = Array.isArray(synthesisJson.conflicts)
        ? synthesisJson.conflicts.filter((x): x is string => typeof x === "string").slice(0, 4)
        : [];

      answer = await withRetry(
        () =>
          generateCompletion(
            QA_ANSWER_SYSTEM,
            qaAnswerUserPrompt({
              question: `${question}${buildHistoryContext(historyRows || [])}`,
              reasoningBrief: reasoningBrief || "暂无结构化解题草稿，按证据直接作答。",
              conflicts,
              evidenceLevel,
              chunks: formattedChunks.map((c) => ({ index: c.index, content: c.content, title: c.title })),
            }),
            { useCase: "qa", model: qaModelOverride("answer"), maxOutputTokens: 3000 }
          ),
        { attempts: 2, timeoutMs: 35000 }
      );

      citations = dedupeCitations(formattedChunks.map((c) => ({
        note_id: c.note_id,
        chunk_index: c.chunk_index,
        title: c.title,
        excerpt: `${c.content.substring(0, 200)}...`,
        source: "knowledge",
        similarity: c.similarity,
      })));
      citations = trimNoisyCitations(citations, { relationCheck, evidenceLevel });
      // 5C: graph relation QA reuse rate
      const grExpandedTotal = graphExpandedNoteIds.size;
      const grExpandedCited = citations.filter((c) => graphExpandedNoteIds.has(c.note_id)).length;
      if (graphExpandMeta) {
        graphExpandMeta.expand_total = grExpandedTotal;
        graphExpandMeta.expand_cited = grExpandedCited;
        graphExpandMeta.expand_error_rate = grExpandedTotal > 0 ? 1 - grExpandedCited / grExpandedTotal : 0;
      }

    }

    let answerId: string | null = null;
    try {
      const { data: record } = await supabase
        .from("ai_answers")
        .insert({
          user_id: user.id,
          question,
          answer,
          citations,
        })
        .select()
        .single();
      if (record) answerId = record.id;
    } catch {
      // non-fatal
    }

    await supabase.from("qa_messages").insert({
      session_id: effectiveSessionId,
      user_id: user.id,
      role: "assistant",
      content: answer,
      citations,
      trace_id: traceId,
      evidence_level: evidenceLevel,
    });

    await supabase.from("qa_sessions").update({ updated_at: new Date().toISOString() }).eq("id", effectiveSessionId).eq("user_id", user.id);

    console.info("[qa] success", { trace_id: traceId, user_id: user.id, session_id: effectiveSessionId, mode, citation_count: citations.length, answer_strategy: answerStrategy, intent_expansion: expansionIntent, has_decision_meta: Boolean(decisionMeta), has_synthesis_meta: Boolean(synthesisMeta) });
    return NextResponse.json({
      answer,
      citations,
      answerId,
      trace_id: traceId,
      sessionId: effectiveSessionId,
      mode,
      intent,
      intentConfidence: intentResult.confidence,
      evidence_level: evidenceLevel,
      evidence_score: evidenceScore,
      answer_strategy: answerStrategy,
      intent_expansion: expansionIntent,
      evidence_items: citations.map((c) => ({ note_id: c.note_id, title: c.title, chunk_index: c.chunk_index })),
      uncertainties: [
        ...(evidenceLevel === "high" ? [] : ["证据强度较低，请谨慎采纳结论。建议补充同主题笔记或提高问题具体度。"]),
      ],
      retrieval: { topK, threshold },
      retrieval_stage: retrievalStage,
      graph_expand: graphExpandMeta,
      decision_meta: decisionMeta,
      synthesis_meta: synthesisMeta,
      filters,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "QA failed";
    console.error("[qa] failed", { trace_id: traceId, user_id: user.id, error: message });
    return NextResponse.json(
      errorBody(ERROR_CODES.qa_failed, message, traceId),
      { status: 500 }
    );
  }
}
