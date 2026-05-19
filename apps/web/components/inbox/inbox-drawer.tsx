"use client";

import { useState } from "react";
import type { CaptureItem, CaptureItemStatus } from "@/lib/supabase/types";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}

const statusLabels: Record<CaptureItemStatus, string> = {
  later: "稍后看",
  pending: "待内化",
  crystallized: "已沉淀",
};

export function InboxDrawer({ item, open, onClose, onUpdate, onDelete }: InboxDrawerProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [myUnderstanding, setMyUnderstanding] = useState("");
  const [saving, setSaving] = useState(false);

  if (!item) return null;

  function startEditTitle() {
    setTitle(item!.title);
    setEditingTitle(true);
  }

  async function saveTitle() {
    if (title.trim() && title !== item!.title) {
      await onUpdate(item!.id, { title: title.trim() });
    }
    setEditingTitle(false);
  }

  async function saveUnderstanding() {
    if (myUnderstanding !== (item!.my_understanding || "")) {
      setSaving(true);
      await onUpdate(item!.id, { my_understanding: myUnderstanding });
      setSaving(false);
    }
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
              {new Date(item.created_at).toLocaleDateString("zh-CN")}
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
          {editingTitle ? (
            <div className="flex gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="text-lg font-semibold"
                autoFocus
              />
            </div>
          ) : (
            <h2
              className="text-lg font-semibold text-[--ink] leading-snug cursor-pointer hover:text-[--innex-accent] transition-colors"
              onClick={startEditTitle}
              title="点击编辑标题"
            >
              {item.title}
            </h2>
          )}

          {/* Source + Type */}
          <div className="flex gap-4 text-sm">
            <div className="flex-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">来源</span>
              <p className="mt-0.5 text-[--text-secondary]">{item.source}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">类型</span>
              <p className="mt-0.5 text-[--text-secondary]">{item.type}</p>
            </div>
          </div>

          {/* Source URL */}
          {item.source_url && (
            <button
              onClick={openSource}
              className="flex items-center gap-1.5 text-sm text-[--innex-accent] hover:underline"
            >
              打开原文 → {new URL(item.source_url).hostname}
            </button>
          )}

          {/* Raw Content */}
          {item.raw_content && (
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">原始内容</span>
              <p className="mt-1 text-sm text-[--text-secondary] whitespace-pre-wrap leading-relaxed bg-[--paper-light] rounded-lg p-3">
                {item.raw_content}
              </p>
            </div>
          )}

          {/* My Understanding */}
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">我的理解</span>
            {!myUnderstanding && !item.my_understanding ? (
              <Textarea
                placeholder="写下你的理解…"
                value={myUnderstanding}
                onChange={(e) => setMyUnderstanding(e.target.value)}
                onBlur={saveUnderstanding}
                className="mt-1 text-sm min-h-[80px] border-[--border-light]"
              />
            ) : (
              <div
                className="mt-1 text-sm text-[--text-secondary] whitespace-pre-wrap leading-relaxed bg-[--paper-light] rounded-lg p-3 cursor-pointer hover:ring-1 hover:ring-[--innex-accent] transition-all"
                onClick={() => {
                  setMyUnderstanding(item.my_understanding || "");
                }}
                title="点击编辑"
              >
                {myUnderstanding || item.my_understanding || "（点击添加）"}
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">标签</span>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {item.tags?.length ? (
                item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-0.5 rounded bg-black/5 text-[--text-secondary]"
                  >
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">暂无标签</span>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[--border-light] shrink-0 flex gap-2">
          {/* Status Flow */}
          <div className="flex gap-1">
            {Object.entries(statusLabels).map(([key, label]) => (
              <Button
                key={key}
                variant={item.status === key ? "default" : "outline"}
                size="sm"
                onClick={() => handleStatusChange(key as CaptureItemStatus)}
                className="text-xs"
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex-1" />
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

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{item.title}」后将无法恢复，确定删除吗？
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
