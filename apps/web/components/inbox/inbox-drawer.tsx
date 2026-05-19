"use client";

import { useState, useEffect } from "react";
import type { CaptureItem, CaptureItemStatus } from "@/lib/supabase/types";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

export function InboxDrawer({ item, open, onClose, onUpdate, onDelete, onInternalize, internalizing }: InboxDrawerProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [notebook, setNotebook] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setNotebook(item.my_understanding || "");
    }
  }, [item?.id]);

  if (!item) return null;

  async function saveNotebook() {
    if (notebook === (item!.my_understanding || "")) return;
    setSaving(true);
    await onUpdate(item!.id, { my_understanding: notebook || null });
    setSaving(false);
  }

  async function handleStatusChange(status: CaptureItemStatus) {
    await onUpdate(item!.id, { status });
  }

  async function handleDelete() {
    await onDelete(item!.id);
    setShowDeleteConfirm(false);
    onClose();
  }

  function openSource() {
    if (item!.source_url) {
      window.open(item!.source_url, "_blank");
    }
  }

  function handleViewOriginal() {
    if (item!.source_url) {
      window.open(item!.source_url, "_blank");
    } else if (item!.raw_content) {
      // Show text in a alert-style view
      alert(item!.raw_content);
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed right-0 top-0 h-full w-[480px] bg-white shadow-2xl z-50 transition-transform duration-250 flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[--border-light] shrink-0">
          <div className="flex items-center gap-3">
            <StatusBadge status={item.status} />
            <span className="text-xs text-muted-foreground font-mono">
              {new Date(item.created_at).toLocaleDateString("zh-CN")} {new Date(item.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-black/5 text-muted-foreground"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-5">
          {/* Title */}
          <h2 className="text-lg font-semibold text-[--ink] leading-snug">
            {item.title}
          </h2>

          {/* Meta */}
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">来源</span>
              <p className="mt-0.5 text-[--text-secondary]">{item.source}</p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">类型</span>
              <p className="mt-0.5 text-[--text-secondary]">{item.type}</p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">状态</span>
              <p className="mt-0.5"><StatusBadge status={item.status} /></p>
            </div>
          </div>

          {/* Tags */}
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">标签</span>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {item.tags?.length ? (
                item.tags.map((tag) => (
                  <span key={tag} className="text-[11px] px-2 py-0.5 rounded bg-black/[0.05] text-[--text-secondary]">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-muted-foreground">-</span>
              )}
            </div>
          </div>

          {/* Summary / Raw content */}
          {item.raw_content && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">摘要</span>
              <p className="mt-1 text-[13px] text-[--text-secondary] whitespace-pre-wrap leading-relaxed bg-[--paper] rounded-lg p-3 max-h-[200px] overflow-auto">
                {item.raw_content.length > 300 ? item.raw_content.slice(0, 300) + "…" : item.raw_content}
              </p>
            </div>
          )}

          {/* Notebook — always available */}
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">笔记本</span>
            <Textarea
              placeholder="随时记录你的想法…"
              value={notebook}
              onChange={(e) => setNotebook(e.target.value)}
              onBlur={saveNotebook}
              className="mt-1 text-[13px] min-h-[80px] border-[--border-light] resize-none"
            />
            {notebook !== (item.my_understanding || "") && (
              <p className="text-[10px] text-muted-foreground mt-1">点击区域外自动保存</p>
            )}
          </div>

          {/* AI Note — only for crystallized */}
          {item.status === "crystallized" && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">AI 笔记</span>
              <div className="mt-1 bg-[--paper] rounded-lg p-3 text-[13px] text-muted-foreground">
                内化后的 AI 笔记将在此展示（Phase 2 实现）
              </div>
            </div>
          )}

          {/* Attachments placeholder */}
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">附件</span>
            <p className="mt-1 text-[11px] text-muted-foreground">暂无附件</p>
          </div>
        </div>

        {/* Footer Actions — vary by status */}
        <div className="px-6 py-4 border-t border-[--border-light] shrink-0 flex gap-2 flex-wrap">
          {/* 查看原笔记 — all statuses */}
          {(item.source_url || item.raw_content) && (
            <Button variant="outline" size="sm" onClick={handleViewOriginal} className="text-xs">
              查看原笔记
            </Button>
          )}

          {/* 转待内化 — only for "later" */}
          {item.status === "later" && (
            <Button variant="outline" size="sm" onClick={() => handleStatusChange("pending")} className="text-xs">
              转待内化
            </Button>
          )}

          {/* 一键内化 — for "later" and "pending" */}
          {item.status !== "crystallized" && (
            <Button
              size="sm"
              onClick={() => onInternalize(item.id)}
              disabled={internalizing || !item.raw_content}
              className="text-xs bg-[--innex-accent] hover:bg-[--innex-accent-hover] text-white"
            >
              {internalizing ? "内化中…" : "一键内化"}
            </Button>
          )}

          {/* 基于此笔记提问 — only crystallized */}
          {item.status === "crystallized" && (
            <Button variant="outline" size="sm" className="text-xs">
              基于此笔记提问
            </Button>
          )}

          {/* 知识库定位 — only crystallized */}
          {item.status === "crystallized" && (
            <Button variant="outline" size="sm" className="text-xs">
              知识库定位
            </Button>
          )}

          <div className="flex-1" />

          {/* 删除 — all statuses */}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            className="text-xs"
          >
            删除
          </Button>
        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{item.title}」后将无法恢复。{item.status === "crystallized" ? "已沉淀的关联笔记也将被移除。" : ""}
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
