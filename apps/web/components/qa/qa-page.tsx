"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Sparkles, Plus, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AnswerDisplay } from "@/components/qa/answer-display";
import type { AiAnswerCitation, QaMessage, QaSession, QaResponse } from "@/lib/supabase/types";

type RenderMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
  citations?: AiAnswerCitation[];
  saved?: boolean;
  answerId?: string | null;
  intent?: string;
  evidenceLevel?: "high" | "low" | "unknown";
  evidenceScore?: number;
  uncertainties?: string[];
  retrieval?: { topK: number; threshold: number };
  filters?: { tags: string[]; source?: string; dateGte?: string; dateLte?: string };
};

type NotePreview = {
  id: string;
  title: string;
  content: string;
  summary: string;
  tags: string[];
};

function hhmm(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function noteDisplayId(noteId: string) {
  return `note-${noteId.slice(0, 3).toLowerCase()}`;
}

export function QaPage() {
  const [question, setQuestion] = useState("");
  const [sessions, setSessions] = useState<QaSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RenderMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteDetail, setNoteDetail] = useState<NotePreview | null>(null);
  const [searchText, setSearchText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    void loadMessages(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  async function loadSessions() {
    setSessionLoading(true);
    try {
      const res = await fetch("/api/qa/sessions");
      if (!res.ok) throw new Error("加载会话失败");
      const data = (await res.json()) as QaSession[];
      setSessions(data);
      if (data.length && !activeSessionId) {
        setActiveSessionId(data[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载会话失败");
    } finally {
      setSessionLoading(false);
    }
  }

  async function loadMessages(sessionId: string) {
    setSessionLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/qa/sessions/${sessionId}/messages?limit=100`);
      if (!res.ok) throw new Error("加载消息失败");
      const data = (await res.json()) as QaMessage[];
      const mapped: RenderMessage[] = data.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.content,
        at: hhmm(m.created_at),
        citations: Array.isArray(m.citations) ? m.citations : [],
      }));
      setMessages(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载消息失败");
      setMessages([]);
    } finally {
      setSessionLoading(false);
    }
  }

  async function createSession() {
    setError("");
    try {
      const res = await fetch("/api/qa/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新建对话", mode: "notes" }),
      });
      if (!res.ok) throw new Error("创建会话失败");
      const data = (await res.json()) as QaSession;
      setSessions((prev) => [data, ...prev]);
      setActiveSessionId(data.id);
      setMessages([]);
      textareaRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建会话失败");
    }
  }

  async function handleAsk() {
    if (!question.trim() || loading) return;
    const asked = question.trim();
    const askAt = hhmm();
    const tempId = `temp-user-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: "user", text: asked, at: askAt }]);
    setQuestion("");
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: asked, sessionId: activeSessionId }),
      });
      const data = (await res.json()) as QaResponse & { error?: string; sessionId?: string };
      if (!res.ok) {
        throw new Error(data.error || "问答失败");
      }

      const resolvedSessionId = data.sessionId || activeSessionId;
      if (resolvedSessionId && resolvedSessionId !== activeSessionId) {
        setActiveSessionId(resolvedSessionId);
      }

      const aiMsg: RenderMessage = {
        id: `temp-ai-${Date.now()}`,
        role: "assistant",
        text: data.answer || "",
        at: hhmm(),
        citations: data.citations || [],
        answerId: data.answerId,
        saved: false,
        intent: data.intent,
        evidenceLevel: data.evidence_level,
        evidenceScore: data.evidence_score,
        uncertainties: data.uncertainties || [],
        retrieval: data.retrieval,
        filters: data.filters,
      };
      setMessages((prev) => [...prev, aiMsg]);
      await loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function openNoteDetail(noteId: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    setNoteDetail(null);
    try {
      const res = await fetch(`/api/notes/${noteId}`);
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setNoteDetail({
        id: data?.note?.id || noteId,
        title: data?.note?.title || "未命名笔记",
        content: data?.note?.content || "",
        summary: data?.note?.summary || "",
        tags: Array.isArray(data?.note?.tags) ? data.note.tags : [],
      });
    } catch {
      setNoteDetail({
        id: noteId,
        title: "笔记加载失败",
        content: "暂时无法读取该笔记详情。",
        summary: "",
        tags: [],
      });
    } finally {
      setDetailLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleAsk();
    }
  }

  const filteredSessions = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    if (!kw) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(kw));
  }, [sessions, searchText]);

  return (
    <div className="relative z-10 flex h-full min-h-0 bg-[--paper]">
      <aside className="hidden w-[260px] shrink-0 border-r border-[--border-light] bg-[#f2ede5] lg:block">
        <div className="p-3">
          <button onClick={() => void createSession()} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-[--border-light] bg-[#f6f2ec] text-xs font-semibold text-[--innex-accent] hover:bg-[--innex-accent-dim]">
            <Plus className="h-3.5 w-3.5" /> 新建对话
          </button>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="mt-2 h-8 w-full rounded-md border border-[--border-light] bg-white px-2 text-xs outline-none focus:border-[--innex-accent]"
            placeholder="搜索会话..."
          />
        </div>
        <div className="border-t border-[--border-light] px-2 py-2 space-y-1">
          {filteredSessions.map((s) => (
            <button key={s.id} onClick={() => setActiveSessionId(s.id)} className={`w-full rounded-md px-2 py-2 text-left text-xs ${activeSessionId === s.id ? "bg-[--innex-accent-dim] text-[--ink]" : "hover:bg-white/70 text-[--text-secondary]"}`}>
              <div className="truncate font-semibold">{s.title}</div>
              <div className="mt-0.5 text-[10px] text-[--text-muted]">{hhmm(s.updated_at)}</div>
            </button>
          ))}
          {!sessionLoading && !filteredSessions.length && <p className="px-2 py-3 text-xs text-[--text-muted]">暂无会话</p>}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center border-b border-[--border-light] px-5">
          <div className="flex items-center gap-2 text-xl font-[900] text-[--ink]">
            <Zap className="h-4 w-4 text-[--innex-accent]" />
            AI 助手
            <span className="text-[11px] font-semibold tracking-[0.12em] text-[--text-muted]">/ AI ASSISTANT</span>
          </div>
        </header>

        <div ref={listRef} className="flex-1 space-y-5 overflow-auto bg-[#ece7df] px-4 py-4 md:px-6">
          {messages.map((msg) =>
            msg.role === "user" ? (
              <div key={msg.id} className="flex justify-end gap-2">
                <div className="max-w-[760px] rounded-2xl rounded-tr-md bg-[#F15A24] px-4 py-3 text-sm leading-relaxed text-white shadow-sm">
                  <div className="mb-1 text-[10px] text-orange-100">{msg.at}</div>
                  {msg.text}
                </div>
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[--border-light] bg-[#f6f2ec] text-xs font-semibold text-[--text-muted]">你</div>
              </div>
            ) : (
              <div key={msg.id} className="flex gap-2">
                <div className="mt-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#c7551c] text-[10px] font-bold text-white">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <div className="max-w-[860px]">
                  <div className="mb-1 text-[10px] text-[--text-muted]">{msg.at}</div>
                  <AnswerDisplay
                    answer={msg.text}
                    citations={msg.citations || []}
                    onOpenNote={openNoteDetail}
                    evidenceLevel={msg.evidenceLevel}
                  />
                </div>
              </div>
            )
          )}

          {loading && (
            <div className="flex gap-2">
              <div className="mt-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#c7551c] text-[10px] font-bold text-white">AI</div>
              <div className="rounded-2xl rounded-tl-md border border-[--border-light] bg-white px-4 py-3 text-sm text-[--text-secondary]">正在检索你的笔记并生成回答...</div>
            </div>
          )}

          {!messages.length && !loading && (
            <div className="mx-auto mt-16 max-w-xl rounded-xl border border-dashed border-[--border-light] bg-[#f8f4ed] p-5 text-sm text-[--text-secondary]">
              <p className="font-semibold text-[--ink]">你好，我是你的 AI 助手。</p>
              <p className="mt-2">你可以直接开始提问，我会基于你的知识库给出尽量准确、清晰的回答。</p>
            </div>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">{error}</div>}
        </div>

        <div className="border-t border-[--border-light] bg-[#ece7df] px-3 pb-3 pt-2 md:px-6">
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              placeholder="只询问知识库中的内容；可输入 /general 切换模式..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[56px] resize-none rounded-xl border-[--border-light] bg-white pr-2 text-sm"
              disabled={loading}
            />
            <Button
              onClick={() => void handleAsk()}
              disabled={loading || !question.trim()}
              size="icon"
              className="h-12 w-12 shrink-0 rounded-xl bg-[#F15A24] hover:bg-[#d94a16]"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-1 flex items-center justify-between px-1 text-[11px] text-[--text-muted]">
            <span />
            <span>Shift + Enter 换行，Enter 发送</span>
          </div>
          <div className="mt-2 px-1 text-[11px] text-[--text-muted]">
            AI 回答由模型生成，可能存在误差或遗漏，请结合原始资料与专业判断进行核验。
          </div>
        </div>
      </section>

      {detailOpen && (
        <>
          <button className="fixed inset-0 z-40 bg-black/15" onClick={() => setDetailOpen(false)} />
          <aside className="fixed right-0 top-0 z-50 flex h-full w-[min(420px,100vw)] flex-col border-l border-[--border-light] bg-[#f7f3ed] shadow-[-10px_0_28px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between border-b border-[--border-light] px-4 py-4">
              <h3 className="text-[28px] font-[900] tracking-[-0.5px] text-[--ink]">笔记详情</h3>
              <button onClick={() => setDetailOpen(false)} className="h-7 w-7 rounded-md border border-[--border-medium] text-[--text-muted] hover:bg-white">×</button>
            </div>
            <div className="flex-1 overflow-auto px-4 py-3">
              {detailLoading ? (
                <p className="text-sm text-[--text-muted]">加载中...</p>
              ) : (
                <>
                  <div className="space-y-2 border-b border-[--border-light] pb-3">
                    <div className="flex gap-3 text-xs"><span className="w-14 text-[--text-muted]">标题</span><span className="font-semibold text-[--ink]">{noteDetail?.title || "-"}</span></div>
                    <div className="flex gap-3 text-xs"><span className="w-14 text-[--text-muted]">ID</span><span className="font-mono text-[--text-secondary]">{noteDetail ? noteDisplayId(noteDetail.id) : "-"}</span></div>
                    <div className="flex gap-3 text-xs"><span className="w-14 text-[--text-muted]">标签</span><span className="flex flex-wrap gap-1">{noteDetail?.tags?.length ? noteDetail.tags.map((t) => <span key={t} className="rounded-md border border-[--border-light] bg-white px-1.5 py-0.5 text-[10px]">{t}</span>) : "-"}</span></div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[--innex-accent]">摘要</div>
                    <div className="rounded-lg border border-[--border-light] bg-[#f0ebe3] p-3 text-xs leading-relaxed text-[--text-secondary]">
                      {noteDetail?.summary || "暂无摘要"}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[--innex-accent]">AI 笔记正文</div>
                    <div className="rounded-lg border border-[--border-light] bg-white p-3 prose prose-sm max-w-none text-[--text-secondary]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {noteDetail?.content || "暂无正文"}
                      </ReactMarkdown>
                    </div>
                  </div>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
