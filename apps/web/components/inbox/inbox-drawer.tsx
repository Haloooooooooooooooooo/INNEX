"use client";

import { useState, useEffect, useRef } from "react";
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
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<CaptureItem>) => Promise<{ success?: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ success?: boolean; error?: string }>;
  onInternalize: (id: string) => void;
  internalizing: boolean;
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

const fieldLabelClass =
  "text-[10px] font-semibold text-[--text-muted] uppercase tracking-[0.05em]";
const fieldValueClass = "text-[13px] text-[--ink]";

export function InboxDrawer({
  item,
  open,
  onClose,
  onUpdate,
  onDelete,
  onInternalize,
  internalizing,
}: InboxDrawerProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [understanding, setUnderstanding] = useState("");
  const [notebook, setNotebook] = useState("");
  const [showUnderstandingSave, setShowUnderstandingSave] = useState(false);
  const [showNotebookSave, setShowNotebookSave] = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  const [draftContent, setDraftContent] = useState("");

  const nbRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (item) {
      setUnderstanding(item.my_understanding || "");
      setNotebook("");
      setShowUnderstandingSave(false);
      setShowNotebookSave(false);
      setDraftMode(false);
    }
  }, [item?.id]);

  if (!item) return null;

  async function saveUnderstanding() {
    if (understanding === (item!.my_understanding || "")) return;
    await onUpdate(item!.id, { my_understanding: understanding || null });
    setShowUnderstandingSave(false);
  }

  async function handleStatusChange(status: CaptureItemStatus) {
    await onUpdate(item!.id, { status });
  }

  async function handleDelete() {
    await onDelete(item!.id);
    setShowDeleteConfirm(false);
    onClose();
  }

  function handleViewOriginal() {
    if (item!.source_url) {
      window.open(item!.source_url, "_blank", "noopener,noreferrer");
    } else if (item!.raw_content) {
      // Show text content in a dialog-style view
      const w = window.open("", "_blank", "width=600,height=400");
      if (w) {
        w.document.write(
          `<pre style="white-space:pre-wrap;font-family:system-ui;padding:20px;font-size:14px;line-height:1.6">${escapeHtml(item!.raw_content || "")}</pre>`
        );
      }
    }
  }

  function enterDraftMode() {
    // Phase 2: LLM generates draft. For now, use raw_content as placeholder.
    setDraftContent(item!.raw_content || "（内化 Agent 将在 Phase 2 生成结构化笔记）");
    setDraftMode(true);
  }

  function exitDraftMode() {
    setDraftMode(false);
  }

  function saveDraft() {
    // Phase 2: Save generated note to notes table
    onInternalize(item!.id);
    setDraftMode(false);
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
          className={`fixed right-0 top-0 h-full w-[460px] bg-white shadow-2xl z-50 transition-transform duration-250 flex flex-col ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-6 py-4 shrink-0">
            <span className="text-base font-semibold text-[--ink]">内化草稿</span>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-black/5 text-muted-foreground text-lg"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-auto px-6 flex flex-col gap-3">
            <p className="text-[12px] text-[--text-secondary]">
              已生成 AI 笔记草稿。你可以直接修改正文，确认后保存即可。
            </p>

            <div>
              <div className="text-[11px] font-semibold text-[--text-muted] uppercase tracking-[0.05em] mb-1.5">
                AI 笔记正文
              </div>
              <textarea
                className="w-full border border-[--border-light] rounded-md px-3 py-2 font-sans text-[12px] text-[--ink] resize-none min-h-[280px] leading-relaxed bg-[--paper-light] focus:bg-white focus:border-[--innex-accent] transition-all"
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
              />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-[--border-light] shrink-0 flex gap-2">
            <button
              onClick={exitDraftMode}
              className="px-3 py-1.5 text-[11px] rounded-md border border-[--border-light] hover:bg-black/[0.04] transition-colors"
            >
              返回详情
            </button>
            <button
              onClick={saveDraft}
              disabled={internalizing}
              className="px-3 py-1.5 text-[11px] rounded-md bg-[--innex-accent] text-white font-bold hover:bg-[--innex-accent-hover] disabled:opacity-50 transition-colors ml-auto"
            >
              {internalizing ? "保存中…" : "保存"}
            </button>
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
        className={`fixed right-0 top-0 h-full w-[460px] bg-white shadow-2xl z-50 transition-transform duration-250 flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0">
          <span className="text-base font-semibold text-[--ink]">记录详情</span>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-black/5 text-muted-foreground text-lg"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 flex flex-col gap-0">
          {/* Meta fields */}
          <div className="flex flex-col">
            <div className="flex flex-col gap-0.5 py-2 border-b border-[--border-light]">
              <span className={fieldLabelClass}>标题</span>
              <span className={`${fieldValueClass} font-semibold`}>{item.title}</span>
            </div>
            <div className="flex flex-col gap-0.5 py-2 border-b border-[--border-light]">
              <span className={fieldLabelClass}>来源</span>
              <span className={fieldValueClass}>{item.source}</span>
            </div>
            <div className="flex flex-col gap-0.5 py-2 border-b border-[--border-light]">
              <span className={fieldLabelClass}>收录时间</span>
              <span
                className={fieldValueClass}
                style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                {formatTime(item.created_at)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 py-2 border-b border-[--border-light]">
              <span className={fieldLabelClass}>状态</span>
              <span className={fieldValueClass}>
                <StatusBadge status={item.status} />
              </span>
            </div>
            <div className="flex flex-col gap-0.5 py-2 border-b border-[--border-light] last:border-b-0">
              <span className={fieldLabelClass}>标签</span>
              <span className={fieldValueClass}>
                {item.tags?.length ? (
                  item.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-block text-[11px] px-2 py-0.5 rounded bg-black/[0.05] text-[--text-secondary] mr-1"
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
          <div className="mt-3">
            <div className="text-[11px] font-semibold text-[--text-muted] uppercase tracking-[0.05em] mb-1.5">
              摘要
            </div>
            <p className="text-[12px] text-[--text-secondary] leading-relaxed">
              {item.summary || item.raw_content?.slice(0, 300) || "暂无摘要"}
            </p>
          </div>

          {/* 我的理解 */}
          <div className="mt-3">
            <div className="text-[11px] font-semibold text-[--text-muted] uppercase tracking-[0.05em] mb-1.5">
              我的理解
            </div>
            <textarea
              className="w-full border border-[--border-light] rounded-md px-3 py-2 font-sans text-[12px] text-[--ink] resize-none min-h-[50px] leading-relaxed bg-[--paper-light] focus:bg-white focus:border-[--innex-accent] focus:shadow-[0_0_0_3px_rgba(241,90,36,0.08)] transition-all"
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
                  className="px-3 py-1 text-[11px] bg-[--innex-accent] text-white rounded-md font-bold hover:bg-[--innex-accent-hover] transition-colors"
                >
                  保存
                </button>
              </div>
            )}
          </div>

          {/* 笔记本（独立的自由笔记区） */}
          <div className="mt-3">
            <div className="text-[11px] font-semibold text-[--text-muted] uppercase tracking-[0.05em] mb-1.5">
              笔记本
            </div>
            <textarea
              className="w-full border border-[--border-light] rounded-md px-3 py-2 font-sans text-[12px] text-[--ink] resize-none min-h-[68px] leading-relaxed bg-[--paper-light] focus:bg-white focus:border-[--innex-accent] focus:shadow-[0_0_0_3px_rgba(241,90,36,0.08)] transition-all"
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
                  className="px-3 py-1 text-[11px] bg-[--innex-accent] text-white rounded-md font-bold hover:bg-[--innex-accent-hover] transition-colors"
                >
                  保存
                </button>
              </div>
            )}
          </div>

          {/* 附件 */}
          <div className="mt-3">
            <div className="text-[11px] font-semibold text-[--text-muted] uppercase tracking-[0.05em] mb-1.5">
              附件
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="flex items-center gap-1 border border-[rgba(0,0,0,0.16)] rounded-md px-2 py-1 cursor-pointer text-[11px] text-[--text-muted] bg-white/45 hover:border-[--innex-accent] hover:text-[--innex-accent] transition-all">
                + 添加附件
              </button>
            </div>
            <p className="text-[11px] text-[--text-muted] mt-1.5">解析状态：正常</p>
          </div>

          {/* AI笔记 — only for crystallized */}
          {s === "crystallized" && (
            <div className="mt-3 p-3 bg-[--paper-light] rounded-lg border border-[--border-light]">
              <div className="text-[11px] font-bold text-[--text-muted] uppercase tracking-[0.05em] mb-1.5">
                AI笔记
              </div>
              <p className="text-[12px] text-[--innex-accent] font-medium cursor-pointer">
                查看内化生成的 AI 笔记 →
              </p>
            </div>
          )}

          <div className="flex-1" />
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[--border-light] shrink-0 flex gap-2 flex-wrap">
          {/* 查看原笔记 — all */}
          <button
            onClick={handleViewOriginal}
            className="px-3 py-1.5 text-[11px] rounded-md border border-[--border-light] hover:bg-black/[0.04] transition-colors"
          >
            查看原笔记
          </button>

          {/* 转待内化 — later only */}
          {s === "later" && (
            <button
              onClick={() => handleStatusChange("pending")}
              className="px-3 py-1.5 text-[11px] rounded-md border border-[--border-light] hover:bg-black/[0.04] transition-colors"
            >
              转待内化
            </button>
          )}

          {/* 一键内化 — later + pending */}
          {s !== "crystallized" && (
            <button
              onClick={enterDraftMode}
              disabled={internalizing || !item.raw_content}
              className="px-3 py-1.5 text-[11px] rounded-md bg-[--innex-accent] text-white font-bold hover:bg-[--innex-accent-hover] disabled:opacity-50 transition-colors"
            >
              {internalizing ? "内化中…" : "一键内化"}
            </button>
          )}

          {/* 基于此笔记提问 — crystallized only */}
          {s === "crystallized" && (
            <button className="px-3 py-1.5 text-[11px] rounded-md border border-[--border-light] hover:bg-black/[0.04] transition-colors">
              基于此笔记提问
            </button>
          )}

          {/* 知识库定位 — crystallized only */}
          {s === "crystallized" && (
            <button className="px-3 py-1.5 text-[11px] rounded-md border border-[--border-light] hover:bg-black/[0.04] transition-colors">
              知识库定位
            </button>
          )}

          <div className="flex-1" />

          {/* 删除 — all */}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-3 py-1.5 text-[11px] rounded-md text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
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
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">
              确定删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
