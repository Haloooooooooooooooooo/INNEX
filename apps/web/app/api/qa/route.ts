import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generateCompletion, generateEmbedding } from "@/lib/llm/client";
import { RAG_QA_SYSTEM, ragQaUserPrompt } from "@/lib/llm/prompts";
import { ERROR_CODES, errorBody } from "@/lib/api/error-codes";
import { withRetry } from "@/lib/llm/resilience";

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
    .slice(-8)
    .map((m) => `${m.role === "assistant" ? "AI" : "User"}: ${m.content}`)
    .join("\n");
  return `\n\n最近对话上下文（供参考）：\n${history}`;
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
  const { mode, question } = parseMode(rawQuestion);
  const topK = typeof body.topK === "number" ? body.topK : 5;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;

  if (!question?.trim()) {
    return NextResponse.json(
      errorBody(ERROR_CODES.bad_request, "question is required", traceId),
      { status: 400 }
    );
  }

  if (mode === "online") {
    return NextResponse.json({
      code: "QA_ONLINE_NOT_ENABLED",
      answer: "在线检索模式尚未启用。请先使用 /notes 或 /general。",
      citations: [],
      answerId: null,
      trace_id: traceId,
      sessionId,
      mode,
    });
  }

  try {
    console.info("[qa] start", { trace_id: traceId, user_id: user.id, top_k: topK, mode, session_id: sessionId });

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
    let citations: Array<{ note_id: string; chunk_index: number; title: string; excerpt: string }> = [];
    let evidenceLevel: "high" | "low" | "unknown" = "unknown";

    if (mode === "general") {
      answer = await withRetry(
        () => generateCompletion(RAG_QA_SYSTEM, `${question}${buildHistoryContext(historyRows || [])}`, { useCase: "qa" }),
        { attempts: 2, timeoutMs: 30000 }
      );
      evidenceLevel = "low";
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
          match_threshold: 0.65,
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

      const formattedChunks = chunks.map((c, i) => ({
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
            ragQaUserPrompt(`${question}${buildHistoryContext(historyRows || [])}`, formattedChunks),
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
      }));
      evidenceLevel = "high";
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
    return NextResponse.json({ answer, citations, answerId, trace_id: traceId, sessionId: effectiveSessionId, mode });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "QA failed";
    console.error("[qa] failed", { trace_id: traceId, user_id: user.id, error: message });
    return NextResponse.json(
      errorBody(ERROR_CODES.qa_failed, message, traceId),
      { status: 500 }
    );
  }
}
