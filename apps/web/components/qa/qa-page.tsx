"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AnswerDisplay } from "@/components/qa/answer-display";
import type { AiAnswerCitation } from "@/lib/supabase/types";

export function QaPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<AiAnswerCitation[]>([]);
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleAsk() {
    if (!question.trim()) return;
    setLoading(true);
    setError("");
    setAnswer("");
    setCitations([]);
    setAnswerId(null);
    setSaved(false);

    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "问答失败");
      } else {
        setAnswer(data.answer);
        setCitations(data.citations || []);
        setAnswerId(data.answerId);
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveToNote() {
    if (!answerId) return;
    await fetch("/api/qa/save", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answerId }),
    });
    setSaved(true);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      <div className="px-5 pt-10 pb-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-[3px] h-[18px] bg-[--innex-accent] rounded-sm shrink-0" />
          <span className="text-xl font-[850] text-[--ink] tracking-[-0.2px]">AI 问答</span>
          <span className="text-[11px] text-[#8A8278] font-semibold tracking-[0.12em] uppercase ml-1">
            RAG QA
          </span>
        </div>
        <p className="text-xs text-[--text-secondary] mt-1">
          基于已沉淀的笔记回答你的问题。证据不足时明确说明不确定。
        </p>
      </div>

      {/* Input */}
      <div className="px-5 pb-4 shrink-0">
        <div className="bg-white rounded-xl border border-[--border-light] p-4 shadow-sm">
          <Textarea
            ref={textareaRef}
            placeholder="基于你的笔记，问任何问题… (Enter 发送，Shift+Enter 换行)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            className="text-sm border-[--border-light] min-h-[80px] resize-none"
            disabled={loading}
          />
          <div className="flex justify-end mt-2">
            <Button
              onClick={handleAsk}
              disabled={loading || !question.trim()}
              size="sm"
              className="bg-[--innex-accent] hover:bg-[--innex-accent-hover] text-white text-xs"
            >
              {loading ? "思考中…" : "提问"}
            </Button>
          </div>
        </div>
      </div>

      {/* Answer area */}
      <div className="flex-1 overflow-auto px-5 pb-8">
        {loading && (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">正在检索你的笔记并生成回答…</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {answer && (
          <AnswerDisplay
            answer={answer}
            citations={citations}
            onSaveToNote={handleSaveToNote}
            saved={saved}
          />
        )}

        {!loading && !error && !answer && (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">还没有提问</p>
            <p className="text-xs text-muted-foreground mt-1">
              上方输入你的问题，AI 将基于你的已沉淀笔记回答
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
