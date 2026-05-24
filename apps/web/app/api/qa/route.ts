import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generateCompletion, generateEmbedding } from "@/lib/llm/client";
import { RAG_QA_SYSTEM, ragQaUserPrompt } from "@/lib/llm/prompts";
import { ERROR_CODES, errorBody } from "@/lib/api/error-codes";
import { withRetry } from "@/lib/llm/resilience";
import { detectIntent, intentLabel } from "@/lib/qa/intent";
import { retrieveOnlineEvidence } from "@/lib/qa/online";
import { onlineMaxEvidence, qaContextRounds, retrievalPreset } from "@/lib/qa/config";
import { hasFilters, parseQuestionFilters } from "@/lib/qa/filters";

type QaMode = "notes" | "general" | "online";

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

function buildStructuredInstruction(intentText: string): string {
  return `请严格按以下结构输出，并保持简洁可执行。
1) 结论
2) 依据（仅使用给定证据，不要臆测）
3) 可执行下一步（1-3条）
4) 不确定项（若证据不足必须明确说明）

当前意图类型：${intentText}`;
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

async function detectContradictions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  noteIds: string[]
) {
  if (noteIds.length < 2) return 0;
  const { data } = await supabase
    .from("note_relations")
    .select("id, source_note_id, target_note_id, relation_type")
    .eq("user_id", userId)
    .eq("relation_type", "contradicts")
    .or(`source_note_id.in.(${noteIds.join(",")}),target_note_id.in.(${noteIds.join(",")})`);

  if (!data?.length) return 0;
  const idSet = new Set(noteIds);
  return data.filter((r) => idSet.has(r.source_note_id) && idSet.has(r.target_note_id)).length;
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
  const defaultRetrieval = retrievalPreset(intent);
  const topK = typeof body.topK === "number" ? body.topK : defaultRetrieval.topK;
  const threshold = typeof body.threshold === "number" ? body.threshold : defaultRetrieval.threshold;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;

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
        .select("id")
        .eq("id", effectiveSessionId)
        .eq("user_id", user.id)
        .single();
      if (!existingSession) {
        return NextResponse.json(
          errorBody(ERROR_CODES.bad_request, "invalid sessionId", traceId),
          { status: 400 }
        );
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
      .select("role, content")
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
    }> = [];
    let evidenceLevel: "high" | "low" | "unknown" = "unknown";
    let evidenceScore = 0;
    let contradictionCount = 0;

    if (mode === "general") {
      answer = await withRetry(
        () =>
          generateCompletion(
            RAG_QA_SYSTEM,
            `${buildStructuredInstruction(intentText)}\n\n问题：${question}${buildHistoryContext(historyRows || [])}`,
            { useCase: "qa" }
          ),
        { attempts: 2, timeoutMs: 30000 }
      );
      evidenceLevel = "low";
      evidenceScore = 0.5;
    } else if (mode === "online") {
      const webItems = await retrieveOnlineEvidence(question, onlineMaxEvidence());
      if (!webItems.length) {
        answer = "未检索到可用的网页证据，请换个关键词或稍后再试。";
        evidenceLevel = "unknown";
        evidenceScore = 0;
      } else {
        const webContext = webItems
          .map((w, i) => `[Web ${i + 1}] ${w.title}\nURL: ${w.url}\n内容: ${w.snippet}`)
          .join("\n\n");
        answer = await withRetry(
          () =>
            generateCompletion(
              RAG_QA_SYSTEM,
              `${buildStructuredInstruction(intentText)}\n\n问题：${question}${buildHistoryContext(
                historyRows || []
              )}\n\n网页证据：\n${webContext}`,
              { useCase: "qa" }
            ),
          { attempts: 2, timeoutMs: 35000 }
        );
        citations = webItems.map((w, i) => ({
          note_id: `web-${i + 1}`,
          chunk_index: i + 1,
          title: w.title,
          excerpt: w.snippet.slice(0, 200),
          source: "web",
          url: w.url,
          fetched_at: w.fetched_at,
        }));
        evidenceLevel = "low";
        evidenceScore = 0.58;
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

      try {
        const { data } = await supabase.rpc("match_note_chunks", {
          query_embedding: questionEmbedding,
          match_threshold: threshold,
          match_count: topK,
          p_user_id: user.id,
        });
        if (data) chunks = data;
      } catch (rpcErr) {
        console.error("[qa] match_note_chunks unavailable", { trace_id: traceId, error: String(rpcErr) });
        return NextResponse.json({
          code: ERROR_CODES.qa_vector_unavailable,
          answer: "向量检索尚未配置。请先启用 pgvector 扩展并执行相关迁移。",
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
          uncertainties: ["知识库缺少相关证据。建议补充与你问题相关的沉淀笔记后再提问。"],
        });
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
        const uncertainAnswer = "当前知识库中没有足够证据支持回答该问题。请先内化更多相关笔记后再试。";
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
      const formattedChunks = fusedChunks.map((c, i) => ({
        index: i + 1,
        content: c.content,
        title: c.note_title || "未命名笔记",
        note_id: c.note_id,
        chunk_index: c.chunk_index,
      }));

      answer = await withRetry(
        () =>
          generateCompletion(
            RAG_QA_SYSTEM,
            `${buildStructuredInstruction(intentText)}\n\n${ragQaUserPrompt(
              `${question}${buildHistoryContext(historyRows || [])}`,
              formattedChunks
            )}`,
            {
              useCase: "qa",
            }
          ),
        { attempts: 2, timeoutMs: 30000 }
      );

      citations = formattedChunks.map((c) => ({
        note_id: c.note_id,
        chunk_index: c.chunk_index,
        title: c.title,
        excerpt: `${c.content.substring(0, 200)}...`,
        source: "knowledge",
      }));
      const ev = calcEvidence(fusedChunks);
      evidenceLevel = ev.level;
      evidenceScore = ev.score;

      contradictionCount = await detectContradictions(
        supabase,
        user.id,
        Array.from(new Set(fusedChunks.map((c) => c.note_id)))
      );
      if (contradictionCount > 0) {
        evidenceLevel = evidenceLevel === "high" ? "low" : evidenceLevel;
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

    console.info("[qa] success", { trace_id: traceId, user_id: user.id, session_id: effectiveSessionId, mode, citation_count: citations.length });
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
      evidence_items: citations.map((c) => ({ note_id: c.note_id, title: c.title, chunk_index: c.chunk_index })),
      uncertainties: [
        ...(evidenceLevel === "high" ? [] : ["证据强度较低，请谨慎采纳结论。建议补充同主题笔记或提高问题具体度。"]),
        ...(contradictionCount > 0 ? [`检测到 ${contradictionCount} 条“互相矛盾”关系证据，请结合原文判断。`] : []),
      ],
      retrieval: { topK, threshold },
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
