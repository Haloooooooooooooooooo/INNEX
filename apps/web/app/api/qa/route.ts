import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generateCompletion, generateEmbedding } from "@/lib/llm/client";
import { RAG_QA_SYSTEM, ragQaUserPrompt } from "@/lib/llm/prompts";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { question, topK = 5 } = await request.json();
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  try {
    // 1. Embed question
    const questionEmbedding = await generateEmbedding(question);

    // 2. Retrieve relevant chunks via pgvector
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
    } catch {
      // RPC not available — return helpful message
      return NextResponse.json({
        answer: "向量检索尚未配置。请先在 Supabase 中启用 pgvector 扩展并执行迁移。",
        citations: [],
        answerId: null,
      });
    }

    // 3. Format chunks
    const formattedChunks = chunks.map((c, i) => ({
      index: i + 1,
      content: c.content,
      title: c.note_title || "未命名笔记",
      note_id: c.note_id,
      chunk_index: c.chunk_index,
    }));

    // 4. Generate grounded answer
    const answer = await generateCompletion(
      RAG_QA_SYSTEM,
      ragQaUserPrompt(question, formattedChunks)
    );

    // 5. Build citations
    const citations = formattedChunks.map((c) => ({
      note_id: c.note_id,
      chunk_index: c.chunk_index,
      title: c.title,
      excerpt: c.content.substring(0, 200) + "…",
    }));

    // 6. Save answer record
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

    return NextResponse.json({ answer, citations, answerId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "QA failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
