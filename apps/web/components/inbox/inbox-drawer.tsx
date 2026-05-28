"use client";

import { useState, useEffect } from "react";
import { Send } from "lucide-react";
import type { CaptureItem, CaptureItemStatus } from "@/lib/supabase/types";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface InboxDrawerProps {
  item: CaptureItem | null;
  open: boolean;
  startQaForItemId?: string | null;
  startInternalizeForItemId?: string | null;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<CaptureItem>) => Promise<{ success?: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ success?: boolean; error?: string }>;
  onInternalize: (id: string, options?: { includeVideo?: boolean }) => void;
  onViewOriginal: (item: CaptureItem) => void;
  internalizing: boolean;
  isAnyInternalizing?: boolean;
  onDraftStarted?: () => void;
  onDraftStartFailed?: (message: string) => void;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

const fieldLabelClass = "w-[60px] shrink-0 text-[11px] text-[--text-muted]";
const fieldValueClass = "flex-1 text-[12px] text-[--text-primary] leading-[1.5]";
const sectionTitleClass =
  "text-[11px] font-bold text-[--innex-accent] uppercase tracking-[0.06em] mb-2.5 flex items-center gap-1.5";
const drawerButtonClass =
  "flex-1 min-w-[80px] px-[10px] py-[7px] rounded-[6px] border border-[--border-medium] bg-transparent text-[11px] text-[--text-secondary] font-medium hover:border-[--innex-accent] hover:text-[--innex-accent] hover:bg-[--innex-accent-dim] transition-all text-center cursor-pointer";

export function InboxDrawer({
  item,
  open,
  startQaForItemId,
  startInternalizeForItemId,
  onClose,
  onUpdate,
  onDelete,
  onInternalize,
  onViewOriginal,
  internalizing,
  isAnyInternalizing = false,
  onDraftStarted,
  onDraftStartFailed,
}: InboxDrawerProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [understanding, setUnderstanding] = useState("");
  const [notebook, setNotebook] = useState("");
  const [showUnderstandingSave, setShowUnderstandingSave] = useState(false);
  const [showNotebookSave, setShowNotebookSave] = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [draftCache, setDraftCache] = useState<Record<string, string>>({});
  const [draftLoading, setDraftLoading] = useState(false);
  const [finalizingInternalize, setFinalizingInternalize] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftIncludeVideo, setDraftIncludeVideo] = useState(false);
  const [aiNoteContent, setAiNoteContent] = useState<string | null>(null);
  const [aiNoteTitle, setAiNoteTitle] = useState<string | null>(null);
  const [aiNoteId, setAiNoteId] = useState<string | null>(null);
  const [savedAnswers, setSavedAnswers] = useState<Array<{ id: string; question: string; answer: string; created_at: string }>>([]);
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaAnswer, setQaAnswer] = useState("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaMessages, setQaMessages] = useState<Array<{ role: "user" | "assistant"; text: string; at: string }>>([]);
  const [qaSessionId, setQaSessionId] = useState<string | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);

  useEffect(() => {
    if (item) {
      setUnderstanding(item.my_understanding || "");
      setNotebook("");
      setShowUnderstandingSave(false);
      setShowNotebookSave(false);
      setDraftMode(false);
      setDraftIncludeVideo(false);
      setQaMode(false);
      setFinalizingInternalize(false);
      setAiNoteContent(null);
      setAiNoteTitle(null);
      setAiNoteId(null);
      setSavedAnswers([]);
      setQaMessages([]);
      setQaSessionId(null);
    }
  }, [item?.id]);

  useEffect(() => {
    if (!item || !startQaForItemId) return;
    if (startQaForItemId !== item.id) return;
    setQaQuestion("");
    setQaAnswer("");
    setQaError(null);
    setQaMessages([]);
    setQaSessionId(null);
    setQaMode(true);
  }, [item, startQaForItemId]);

  useEffect(() => {
    if (!item || !startInternalizeForItemId) return;
    if (startInternalizeForItemId !== item.id) return;
    enterDraftMode({
      onStarted: () => onDraftStarted?.(),
      onFailed: (msg) => onDraftStartFailed?.(msg),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, startInternalizeForItemId]);

  useEffect(() => {
    if (!item || item.status !== "crystallized") return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/notes?captureItemId=${item.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const note = Array.isArray(data) ? data[0] : null;
        if (!cancelled && note) {
          setAiNoteId(note.id || null);
          setAiNoteContent(note.content || "");
          setAiNoteTitle(note.title || item.title);
        }
      } catch {
        // non-fatal
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.status, item?.title]);

  useEffect(() => {
    if (!item || item.status !== "crystallized" || !aiNoteId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ai-answers?noteId=${aiNoteId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setSavedAnswers(
            data.map((x) => ({
              id: x.id,
              question: x.question || "",
              answer: x.answer || "",
              created_at: x.created_at || "",
            }))
          );
        }
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.status, aiNoteId]);

  if (!item) return null;

  async function saveUnderstanding() {
    if (understanding === (item!.my_understanding || "")) return;
    await onUpdate(item!.id, { my_understanding: understanding || null });
    setShowUnderstandingSave(false);
  }

  async function handleStatusChange(status: CaptureItemStatus) {
    setStatusChanging(true);
    await onUpdate(item!.id, { status });
    setStatusChanging(false);
  }

  async function handleDelete() {
    void onDelete(item!.id);
    setShowDeleteConfirm(false);
    onClose();
  }

  function handleViewOriginal() {
    onViewOriginal(item!);
  }

  function enterDraftMode(options?: { onStarted?: () => void; onFailed?: (message: string) => void }) {
    // Reuse existing draft when user returns to detail then re-enters internalize.
    const cached = item?.id ? (draftCache[item.id] || "") : "";
    if (cached.trim()) {
      setDraftContent(cached);
      setDraftMode(true);
      options?.onStarted?.();
      return;
    }

    const includeVideo =
      item?.type === "video"
        ? window.confirm("检测到视频链接。将先按文字内容内化，是否同时解析视频补充内容？")
        : false;

    setDraftIncludeVideo(includeVideo);
    setDraftContent("");
    setDraftError(null);
    setDraftMode(true);
    setDraftLoading(true);

    fetch("/api/internalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureItemId: item!.id, dryRun: true, includeVideo }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "草稿生成失败");
        }
        const content = typeof data?.draft?.content === "string" ? data.draft.content : "";
        setDraftContent(content);
        setDraftCache((prev) => ({ ...prev, [item!.id]: content }));
        options?.onStarted?.();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "草稿生成失败";
        setDraftError(`草稿生成失败：${msg}`);
        setDraftContent("");
        options?.onFailed?.(msg);
      })
      .finally(() => setDraftLoading(false));
  }

  function handleAskFromNote() {
    if (!item) return;
    setQaQuestion("");
    setQaAnswer("");
    setQaError(null);
    setQaMessages([]);
    setQaSessionId(null);
    setQaMode(true);
  }

  function handleLocateInKb() {
    if (!item) return;
    window.location.href = `/kb?captureItemId=${item.id}`;
  }

  function exitDraftMode() {
    setDraftMode(false);
  }

  async function saveDraft() {
    if (!draftContent.trim()) {
      setDraftError("草稿为空，无法保存。");
      return;
    }
    setDraftLoading(true);
    setDraftError(null);
    setFinalizingInternalize(true);

    const itemId = item!.id;
    const content = draftContent;
    const includeVideo = draftIncludeVideo;

    // Fast UI response: close draft immediately and finish the heavy work in background.
    setDraftMode(false);

    void (async () => {
      try {
        const res = await fetch("/api/internalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            captureItemId: itemId,
            dryRun: false,
            overrideMarkdown: content,
            includeVideo,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "保存内化失败");
        }
        const nextSummary =
          typeof data?.note?.summary === "string" && data.note.summary.trim()
            ? data.note.summary.trim()
            : undefined;
        const nextTags = Array.isArray(data?.note?.tags) ? data.note.tags : undefined;
        void onUpdate(itemId, {
          status: "crystallized",
          ...(nextSummary ? { summary: nextSummary } : {}),
          ...(nextTags ? { tags: nextTags } : {}),
        });
        if (typeof data?.note?.content === "string") {
          setAiNoteId(typeof data?.note?.id === "string" ? data.note.id : null);
          setAiNoteTitle(typeof data?.note?.title === "string" ? data.note.title : item?.title || null);
          setAiNoteContent(data.note.content);
        }
        setDraftCache((prev) => {
          if (!prev[itemId]) return prev;
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
        setFinalizingInternalize(false);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "保存内化失败";
        onDraftStartFailed?.(msg);
      } finally {
        setDraftLoading(false);
        setFinalizingInternalize(false);
      }
    })();
  }

  async function askInDrawer() {
    if (!qaQuestion.trim()) return;
    const asked = qaQuestion.trim();
    const at = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    setQaMessages((prev) => [...prev, { role: "user", text: asked, at }]);
    setQaQuestion("");
    setQaLoading(true);
    setQaError(null);
    setQaAnswer("");
    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: asked, sessionId: qaSessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "提问失败");
      const answerText = typeof data?.answer === "string" ? data.answer : "";
      const returnedSessionId = typeof data?.sessionId === "string" ? data.sessionId : null;
      if (returnedSessionId && returnedSessionId !== qaSessionId) {
        setQaSessionId(returnedSessionId);
      }
      setQaAnswer(answerText);
      setQaMessages((prev) => [
        ...prev,
        { role: "assistant", text: answerText, at: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) },
      ]);
    } catch (err: unknown) {
      setQaError(err instanceof Error ? err.message : "提问失败");
    } finally {
      setQaLoading(false);
    }
  }

  const s = item.status;

  // === DRAFT MODE ===
  if (draftMode) {
    return (
      <>
        <div
          className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-200 ${
            open ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onClick={onClose}
        />
        <div
          className={`fixed right-0 top-0 h-full w-[min(460px,100%)] bg-white border-l border-[--border-light] shadow-[-10px_0_28px_rgba(0,0,0,0.12)] z-50 transition-transform duration-250 flex flex-col ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
            <span className="text-[15px] font-bold text-[--text-primary]">内化草稿</span>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md border border-[--border-medium] bg-transparent text-[--text-muted] text-sm hover:bg-[--paper] hover:text-[--text-primary] transition-all"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-auto px-5 flex flex-col gap-4">
            <p className="text-[12.5px] text-[--text-secondary] leading-[1.8] bg-[--paper-light] border border-[--border-light] rounded-[7px] p-3">
              {draftLoading ? "内化中..." : "已生成 AI 笔记草稿。你可以直接修改正文，确认后保存即可。"}
            </p>
            {draftError && (
              <p className="text-[11px] text-red-500">{draftError}</p>
            )}

            <div className="flex-1 min-h-0 flex flex-col">
              <div className={sectionTitleClass}>
                <span className="inline-block w-[3px] h-3 rounded-[2px] bg-[--innex-accent]" />
                AI 笔记正文
              </div>
              <textarea
                className="draft-scrollbar w-full border border-[--border-medium] rounded-[7px] px-2.5 py-2.5 font-sans text-[12px] text-[--text-primary] resize-none min-h-[68vh] leading-[1.6] bg-white focus:outline-none focus:border-[--innex-accent] transition-all"
                value={draftContent}
                onChange={(e) => {
                  const next = e.target.value;
                  setDraftContent(next);
                  if (item?.id) {
                    setDraftCache((prev) => ({ ...prev, [item.id]: next }));
                  }
                }}
                disabled={draftLoading}
              />
            </div>
          </div>

          {!draftLoading && (
            <div className="px-5 py-3 border-t border-[--border-light] shrink-0 flex gap-1.5 bg-white">
              <button
                onClick={exitDraftMode}
                className={drawerButtonClass}
              >
                返回详情
              </button>
              <button
                onClick={saveDraft}
                disabled={internalizing}
                className="flex-1 min-w-[120px] px-[10px] py-[7px] rounded-[6px] border border-[#F15A24] bg-[#F15A24] text-white text-[11px] font-medium hover:bg-[#d94a16] disabled:opacity-50 transition-colors ml-auto"
              >
                {internalizing ? "保存中…" : "确认内化"}
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  if (qaMode) {
    return (
      <>
        <div className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`} onClick={onClose} />
        <div className={`fixed right-0 top-0 h-full w-[min(460px,100%)] border-l border-[--border-light] bg-[#f7f3ed] shadow-[-10px_0_28px_rgba(0,0,0,0.12)] z-50 transition-transform duration-250 flex flex-col ${open ? "translate-x-0" : "translate-x-full"}`}>
          <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
            <span className="text-[20px] font-[850] tracking-[-0.2px] text-[--text-primary]">基于此笔记提问</span>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg border border-[--border-medium] bg-transparent text-[--text-muted] text-sm hover:bg-white hover:text-[--text-primary] transition-all">×</button>
          </div>
          <div className="flex-1 overflow-auto px-5 pb-2">
            <div className="mb-4">
              <div className="text-[12px] font-bold text-[--innex-accent] uppercase tracking-[0.08em] mb-2 flex items-center gap-1.5">
                <span className="inline-block w-[3px] h-3 rounded-[2px] bg-[--innex-accent]" />
                已挂载上下文
              </div>
              <div className="rounded-lg border border-[--border-light] bg-[#efebe6] px-3 py-2 text-[12px] text-[--text-secondary]">
                {aiNoteTitle || item.title}
              </div>
            </div>

            <div className="mb-4 flex gap-2">
              <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-[#c7551c] text-white text-[10px] font-bold flex items-center justify-center">AI</div>
              <div className="max-w-[320px] rounded-2xl rounded-tl-md border border-[--border-light] bg-white px-3 py-2.5 text-[12px] text-[--text-secondary] leading-[1.7] shadow-sm">
                <div className="text-[10px] text-[--text-muted] mb-1">{new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div>
                已挂载这条笔记上下文。你可以直接追问，我会基于知识库给出有依据的回答。
              </div>
            </div>

            {qaMessages.map((msg, idx) =>
              msg.role === "user" ? (
                <div key={`${msg.role}-${idx}`} className="mb-4 flex justify-end gap-2">
                  <div className="max-w-[320px] rounded-2xl rounded-tr-md bg-[#F15A24] px-3 py-2.5 text-[12px] text-white leading-[1.7] whitespace-pre-wrap shadow-sm">
                    <div className="text-[10px] text-orange-100 mb-1">{msg.at}</div>
                    {msg.text}
                  </div>
                  <div className="mt-1 h-7 w-7 shrink-0 rounded-full border border-[--border-light] bg-white text-[10px] font-bold text-[--text-muted] flex items-center justify-center">你</div>
                </div>
              ) : (
                <div key={`${msg.role}-${idx}`} className="mb-4 flex gap-2">
                  <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-[#c7551c] text-white text-[10px] font-bold flex items-center justify-center">AI</div>
                  <div className="max-w-[320px] rounded-2xl rounded-tl-md border border-[--border-light] bg-white px-3 py-2.5 text-[12px] text-[--text-secondary] leading-[1.7] whitespace-pre-wrap shadow-sm">
                    <div className="text-[10px] text-[--text-muted] mb-1">{msg.at}</div>
                    {msg.text}
                  </div>
                </div>
              )
            )}

            {qaLoading && (
              <div className="mb-4 flex gap-2">
                <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-[#c7551c] text-white text-[10px] font-bold flex items-center justify-center">AI</div>
                <div className="max-w-[320px] rounded-2xl rounded-tl-md border border-[--border-light] bg-white px-3 py-2.5 text-[12px] text-[--text-secondary] leading-[1.7] shadow-sm">
                  思考中…
                </div>
              </div>
            )}

            {qaError && <p className="text-[11px] text-red-500 mb-2">{qaError}</p>}
          </div>

          <div className="shrink-0 border-t border-[--border-light] bg-[#f7f3ed] px-4 py-3">
            <div className="flex items-end gap-2">
              <textarea
                className="w-full border border-[--border-medium] rounded-xl px-3 py-2.5 font-sans text-[12px] text-[--text-primary] resize-none min-h-[56px] leading-[1.6] bg-white focus:outline-none focus:border-[--innex-accent] transition-all"
                value={qaQuestion}
                onChange={(e) => setQaQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    askInDrawer();
                  }
                }}
                placeholder="只询问知识库中的内容；证据不足时会明确说明不确定..."
              />
              <button
                onClick={askInDrawer}
                disabled={qaLoading || !qaQuestion.trim()}
                className="h-[56px] w-[56px] shrink-0 rounded-xl border border-[#F15A24] bg-[#F15A24] text-white disabled:opacity-50 hover:bg-[#d94a16] transition-colors flex items-center justify-center"
                aria-label="发送"
              >
                <Send className="h-5 w-5 text-white" />
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-[--text-muted]">
              <button className="w-5 h-5 rounded-md border border-[--border-light] bg-white leading-none">+</button>
              <span>Shift + Enter 换行，Enter 发送</span>
            </div>
          </div>
        </div>
      </>
    );
  }

  // === DETAIL MODE ===
  return (
    <>
      <div
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed right-0 top-0 h-full w-[min(460px,100%)] bg-white border-l border-[--border-light] shadow-[-10px_0_28px_rgba(0,0,0,0.12)] z-50 transition-transform duration-250 flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <span className="text-[15px] font-bold text-[--text-primary]">记录详情</span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-[--border-medium] bg-transparent text-[--text-muted] text-sm hover:bg-[--paper] hover:text-[--text-primary] transition-all"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 flex flex-col gap-0">
          {/* Meta fields */}
          <div className="flex flex-col mb-4">
            <div className="flex items-start gap-2 py-1.5 border-b border-[--border-light]">
              <span className={fieldLabelClass}>标题</span>
              <span className={`${fieldValueClass} font-semibold`}>{item.title}</span>
            </div>
            <div className="flex items-start gap-2 py-1.5 border-b border-[--border-light]">
              <span className={fieldLabelClass}>来源</span>
              <span className={fieldValueClass}>{item.source}</span>
            </div>
            <div className="flex items-start gap-2 py-1.5 border-b border-[--border-light]">
              <span className={fieldLabelClass}>收录时间</span>
              <span
                className={fieldValueClass}
                style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                {formatTime(item.created_at)}
              </span>
            </div>
            <div className="flex items-start gap-2 py-1.5 border-b border-[--border-light]">
              <span className={fieldLabelClass}>状态</span>
              <span className={fieldValueClass}>
                <StatusBadge status={item.status} />
              </span>
            </div>
            <div className="flex items-start gap-2 py-1.5 border-b border-[--border-light] last:border-b-0">
              <span className={fieldLabelClass}>标签</span>
              <span className={fieldValueClass}>
                {item.tags?.length ? (
                  item.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-block text-[11px] px-2 py-0.5 rounded-[5px] bg-[--paper-light] border border-[--border-light] text-[--text-secondary] mr-1"
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-[--text-muted]">-</span>
                )}
              </span>
            </div>
          </div>

          {/* 摘要 */}
          <div className="mb-4">
            <div className={sectionTitleClass}>
              <span className="inline-block w-[3px] h-3 rounded-[2px] bg-[--innex-accent]" />
              摘要
            </div>
            {finalizingInternalize && (
              <p className="text-[11px] text-[--innex-accent] mb-2">内化处理中，内容将自动更新...</p>
            )}
            <p className="text-[12.5px] text-[--text-secondary] leading-[1.8] bg-[--paper-light] border border-[--border-light] rounded-[7px] p-3">
              {item.summary || item.raw_content?.slice(0, 300) || "暂无摘要"}
            </p>
          </div>

          {/* 我的理解 */}
          <div className="mb-4">
            <div className={sectionTitleClass}>
              <span className="inline-block w-[3px] h-3 rounded-[2px] bg-[--innex-accent]" />
              我的理解
            </div>
            <textarea
              className="w-full border border-[--border-medium] rounded-[7px] px-2.5 py-2.5 font-sans text-[12px] text-[--text-primary] resize-none min-h-[60px] leading-[1.6] bg-white focus:outline-none focus:border-[--innex-accent] transition-all"
              placeholder="你的理解（录入时填写）"
              value={understanding}
              onChange={(e) => {
                setUnderstanding(e.target.value);
                setShowUnderstandingSave(true);
              }}
            />
            {showUnderstandingSave && (
              <div className="flex justify-end mt-1.5">
                <button
                  onClick={saveUnderstanding}
                  className="px-3 py-1 text-[11px] bg-[--innex-accent] text-white rounded-md font-medium hover:bg-[--innex-accent-hover] transition-colors"
                >
                  保存
                </button>
              </div>
            )}
          </div>

          {/* 笔记本（恢复原有区块） */}
          <div className="mb-4">
            <div className={sectionTitleClass}>
              <span className="inline-block w-[3px] h-3 rounded-[2px] bg-[--innex-accent]" />
              笔记本
            </div>
            <textarea
              className="w-full border border-[--border-medium] rounded-[7px] px-2.5 py-2.5 font-sans text-[12px] text-[--text-primary] resize-none min-h-[68px] leading-[1.6] bg-white focus:outline-none focus:border-[--innex-accent] transition-all"
              placeholder="随时记录你的想法…"
              value={notebook}
              onChange={(e) => {
                setNotebook(e.target.value);
                setShowNotebookSave(true);
              }}
            />
            {showNotebookSave && (
              <div className="flex justify-end mt-1.5">
                <button
                  onClick={() => setShowNotebookSave(false)}
                  className="px-3 py-1 text-[11px] bg-[--innex-accent] text-white rounded-md font-medium hover:bg-[--innex-accent-hover] transition-colors"
                >
                  保存
                </button>
              </div>
            )}
          </div>

          {/* 附件 */}
          <div className="mb-4">
            <div className={sectionTitleClass}>
              <span className="inline-block w-[3px] h-3 rounded-[2px] bg-[--innex-accent]" />
              附件
            </div>
            {item.attachments?.length ? (
              <div className="space-y-1.5">
                {item.attachments.map((att) => (
                  <div
                    key={att.id}
                    className="inline-flex items-center text-[11px] text-[--text-secondary] bg-[--paper-light] border border-[--border-light] rounded-md px-2.5 py-1.5 mr-1.5"
                  >
                    <span className="mr-1">📄</span>
                    {att.file_name}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[--text-muted]">暂无附件</p>
            )}
            <p className="text-[11px] text-[--text-muted] mt-2">解析状态：正常</p>
          </div>

          {/* AI笔记（恢复原有区块） */}
          {s === "crystallized" && (
            <div className="mb-4 p-3 bg-[--paper-light] rounded-lg border border-[--border-light]">
              <div className={sectionTitleClass}>
                <span className="inline-block w-[3px] h-3 rounded-[2px] bg-[--innex-accent]" />
                AI笔记
              </div>
              {aiNoteContent ? (
                <div className="space-y-2">
                  <p className="text-[12px] font-semibold text-[--text-primary]">{aiNoteTitle}</p>
                  <p className="text-[12px] text-[--text-secondary] leading-relaxed whitespace-pre-wrap max-h-40 overflow-auto">
                    {aiNoteContent}
                  </p>
                </div>
              ) : (
                <p className="text-[12px] text-[--text-muted]">正在加载 AI 笔记...</p>
              )}
            </div>
          )}

          {s === "crystallized" && savedAnswers.length > 0 && (
            <div className="mb-4 p-3 bg-white rounded-lg border border-[--border-light]">
              <div className={sectionTitleClass}>
                <span className="inline-block w-[3px] h-3 rounded-[2px] bg-[--innex-accent]" />
                AI助手回答
              </div>
              <div className="space-y-2">
                {savedAnswers.slice(0, 3).map((ans) => (
                  <div key={ans.id} className="bg-[--paper-light] border border-[--border-light] rounded-md p-2">
                    <p className="text-[11px] font-semibold text-[--text-primary] line-clamp-1">
                      Q: {ans.question}
                    </p>
                    <p className="text-[11px] text-[--text-secondary] leading-relaxed line-clamp-2">
                      A: {ans.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1" />
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-[--border-light] shrink-0 flex gap-1.5 flex-wrap bg-white">
          {/* 查看原笔记 — all */}
          <button
            onClick={handleViewOriginal}
            disabled={finalizingInternalize}
            className={drawerButtonClass}
          >
            查看原笔记
          </button>

          {/* 转待内化 — later only */}
          {s === "later" && (
            <button
              onClick={() => handleStatusChange("pending")}
              disabled={statusChanging || finalizingInternalize}
              className="flex-1 min-w-[80px] px-[10px] py-[7px] rounded-[6px] border border-[#f29a35] bg-[#f29a35] text-white text-[11px] font-sans font-medium hover:bg-[#e18314] disabled:opacity-50 transition-colors text-center cursor-pointer"
            >
              {statusChanging ? "处理中…" : "转待内化"}
            </button>
          )}

          {/* 一键内化 — later + pending */}
          {s !== "crystallized" && (
            <button
              onClick={() => enterDraftMode()}
              disabled={internalizing || finalizingInternalize}
              className="flex-1 min-w-[80px] px-[10px] py-[7px] rounded-[6px] border border-[#f29a35] bg-[#f29a35] text-white text-[11px] font-sans font-medium hover:bg-[#e18314] disabled:opacity-50 transition-colors cursor-pointer"
            >
              {internalizing || finalizingInternalize ? "内化中…" : "一键内化"}
            </button>
          )}

          {s === "crystallized" && (
            <button className={drawerButtonClass} onClick={handleAskFromNote}>
              基于此笔记提问
            </button>
          )}
          {s === "crystallized" && (
            <button className={drawerButtonClass} onClick={handleLocateInKb}>
              知识库定位
            </button>
          )}

          {/* 删除 — all */}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isAnyInternalizing || finalizingInternalize}
            className="flex-1 min-w-[80px] px-[10px] py-[7px] rounded-[6px] border border-[--border-medium] bg-transparent text-[11px] text-[--text-secondary] font-medium hover:border-red-500 hover:text-red-500 hover:bg-red-50 transition-all text-center cursor-pointer"
          >
            删除
          </button>
        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{item.title}」后将无法恢复。
              {s === "crystallized" ? "已沉淀的关联笔记也将被移除。" : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isAnyInternalizing}
              className="bg-red-500 hover:bg-red-600"
            >
              确定删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
