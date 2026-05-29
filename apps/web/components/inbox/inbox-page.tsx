"use client";

import { useCaptureItems } from "@/hooks/use-capture-items";
import { QuickCapture } from "@/components/inbox/quick-capture";
import { InboxToolbar } from "@/components/inbox/inbox-toolbar";
import { InboxTable } from "@/components/inbox/inbox-table";
import { InboxDrawer } from "@/components/inbox/inbox-drawer";
import { useState, useCallback, useEffect } from "react";
import type { CaptureItem } from "@/lib/supabase/types";

export function InboxPage() {
  const {
    items,
    counts,
    loading,
    statusFilter,
    setStatusFilter,
    search,
    setSearch,
    addItem,
    updateItem,
    deleteItem,
    deleteItems,
  } = useCaptureItems();

  const [selectedItem, setSelectedItem] = useState<CaptureItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [internalizing, setInternalizing] = useState<string | null>(null);
  const [internalizingIds, setInternalizingIds] = useState<string[]>([]);
  const [startInternalizeForItemId, setStartInternalizeForItemId] = useState<string | null>(null);
  const [internalizeToast, setInternalizeToast] = useState<string | null>(null);
  const [deleteToast, setDeleteToast] = useState<string | null>(null);
  const [viewToast, setViewToast] = useState<string | null>(null);
  const [startQaForItemId, setStartQaForItemId] = useState<string | null>(null);

  const isTextLikeDocument = (fileName?: string, fileType?: string) => {
    const name = (fileName || "").toLowerCase();
    const type = (fileType || "").toLowerCase();
    if (type.includes("markdown") || type.includes("text/plain") || type.includes("application/json")) return true;
    return [".md", ".txt", ".json", ".csv", ".log"].some((ext) => name.endsWith(ext));
  };

  const openTextInBrowser = (title: string, text: string) => {
    const safeTitle = title.replace(/[<>&"]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[m] || m));
    const safeText = text.replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m] || m));
    const html = `<!doctype html><html><head><meta charset="UTF-8"/><title>${safeTitle}</title><style>body{margin:0;padding:20px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#222;background:#fff}pre{white-space:pre-wrap;line-height:1.7;font-size:14px}</style></head><body><pre>${safeText}</pre></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  };

  function openDrawer(item: CaptureItem) {
    setSelectedItem(item);
    setDrawerOpen(true);
    setStartQaForItemId(null);
  }

  function openQaDrawer(item: CaptureItem) {
    setSelectedItem(item);
    setDrawerOpen(true);
    setStartQaForItemId(item.id);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setStartInternalizeForItemId(null);
    setTimeout(() => setSelectedItem(null), 200);
  }

  useEffect(() => {
    if (!selectedItem) return;
    const latest = items.find((x) => x.id === selectedItem.id);
    if (latest) setSelectedItem(latest);
  }, [items, selectedItem]);

  const handleInternalize = useCallback(async (id: string, options?: { includeVideo?: boolean }) => {
    const target = items.find((x) => x.id === id);
    if (!target) return;
    setInternalizing(id);
    setSelectedItem(target);
    setDrawerOpen(true);
    setStartQaForItemId(null);
    setStartInternalizeForItemId(id);
    setInternalizingIds([id]);
  }, [items]);

  const handleBatchInternalize = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) return;
    setInternalizingIds(uniqueIds);
    setInternalizeToast(`已开始批量内化（${uniqueIds.length} 条）`);
    setTimeout(() => setInternalizeToast(null), 1800);

    for (const id of uniqueIds) {
      try {
        const res = await fetch("/api/internalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureItemId: id, dryRun: false }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = typeof data?.error === "string" ? data.error : "内化失败";
          setInternalizeToast(`内化失败：${msg}`);
          setTimeout(() => setInternalizeToast(null), 2600);
          continue;
        }
        const nextSummary =
          typeof data?.note?.summary === "string" && data.note.summary.trim()
            ? data.note.summary.trim()
            : undefined;
        const nextTags = Array.isArray(data?.note?.tags) ? data.note.tags : undefined;
        void updateItem(id, {
          status: "crystallized",
          ...(nextSummary ? { summary: nextSummary } : {}),
          ...(nextTags ? { tags: nextTags } : {}),
        });
      } catch {
        setInternalizeToast("批量内化请求失败，请重试。");
        setTimeout(() => setInternalizeToast(null), 2600);
      }
    }

    setInternalizingIds([]);
  }, [updateItem]);

  const handleDelete = useCallback(async (id: string) => {
    const result = await deleteItem(id);
    if (result?.error) {
      setDeleteToast(result.error);
      setTimeout(() => setDeleteToast(null), 2500);
    }
    return result;
  }, [deleteItem]);

  const handleDeleteMany = useCallback(async (ids: string[]) => {
    const result = await deleteItems(ids);
    if (result?.error) {
      setDeleteToast(result.error);
      setTimeout(() => setDeleteToast(null), 2500);
    }
    return result;
  }, [deleteItems]);

  const handleViewOriginal = useCallback((item: CaptureItem) => {
    if (item.type === "text") {
      openTextInBrowser(item.title || "原笔记内容", item.raw_content || "暂无原文内容");
      return;
    }

    // Link-like capture: open source URL directly.
    if (item.source_url) {
      window.open(item.source_url, "_blank", "noopener,noreferrer");
      return;
    }

    // Image/document/attachment_group: open original file URL if available.
    const firstAttachment = Array.isArray(item.attachments) ? item.attachments[0] : null;
    const storagePath = firstAttachment?.storage_path || "";
    if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
      const isTextDoc = isTextLikeDocument(firstAttachment?.file_name, firstAttachment?.file_type);
      if (isTextDoc) {
        fetch(storagePath)
          .then((res) => res.text())
          .then((text) => openTextInBrowser(firstAttachment?.file_name || item.title || "文档原文", text || "（文档内容为空）"))
          .catch(() => {
            setViewToast("文本文档读取失败，请稍后重试。");
            setTimeout(() => setViewToast(null), 2200);
          });
        return;
      }
      window.open(storagePath, "_blank", "noopener,noreferrer");
      return;
    }

    const attachmentNames = (item.attachments || []).map((a) => a.file_name).slice(0, 2).join("、");
    setViewToast(
      attachmentNames
        ? `未保存原文件访问地址（${attachmentNames}），请重新上传该附件后查看原文。`
        : "未保存原文件访问地址，当前记录无法直接打开原文。"
    );
    setTimeout(() => setViewToast(null), 2500);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="hero-strip shrink-0" />

      <div className="px-4 pt-2 pb-2 shrink-0 relative z-[1]">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-[3px] h-[15px] bg-[--innex-accent] rounded-sm shrink-0" />
          <span className="text-[18px] font-[850] text-[--ink] tracking-[-0.2px]">快速录入</span>
          <span className="text-[11px] text-[#8A8278] font-semibold tracking-[0.12em] uppercase ml-1">QUICK CAPTURE</span>
        </div>
        <QuickCapture onAdd={addItem} />
      </div>

      <div className="flex-1 overflow-hidden px-3 pb-3 flex flex-col relative z-[1]">
        <div className="bg-[--paper-light] border border-black/[0.14] rounded-xl flex-1 min-h-0 overflow-hidden flex flex-col shadow-[0_16px_36px_rgba(0,0,0,0.06)]">
          <InboxToolbar
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            search={search}
            onSearchChange={setSearch}
            counts={counts}
          />
          <div className="flex-1 overflow-hidden">
            <InboxTable
              items={items}
              loading={loading}
              onSelect={openDrawer}
              onAskFromItem={openQaDrawer}
              onStatusChange={(id, status) => updateItem(id, { status })}
              onInternalize={handleInternalize}
              onBatchInternalize={handleBatchInternalize}
              internalizingIds={internalizingIds.length ? internalizingIds : (internalizing ? [internalizing] : [])}
              onDelete={(id) => {
                void handleDelete(id);
              }}
              onDeleteMany={(ids) => {
                void handleDeleteMany(ids);
              }}
              onViewOriginal={handleViewOriginal}
            />
          </div>
        </div>
      </div>

      <InboxDrawer
        item={selectedItem}
        open={drawerOpen}
        onClose={closeDrawer}
        onUpdate={updateItem}
        onDelete={handleDelete}
        onInternalize={handleInternalize}
        onViewOriginal={handleViewOriginal}
        internalizing={internalizing === selectedItem?.id}
        isAnyInternalizing={Boolean(internalizing)}
        startInternalizeForItemId={startInternalizeForItemId}
        onDraftStarted={() => {
          setStartInternalizeForItemId(null);
        }}
        onDraftFlowExit={() => {
          setInternalizing(null);
          setInternalizingIds([]);
          setStartInternalizeForItemId(null);
        }}
        onInternalizeSaved={() => {
          setInternalizing(null);
          setInternalizingIds([]);
          setStartInternalizeForItemId(null);
        }}
        onDraftStartFailed={(message) => {
          setStartInternalizeForItemId(null);
          setInternalizing(null);
          setInternalizingIds([]);
          setInternalizeToast(message);
          setTimeout(() => setInternalizeToast(null), 2500);
        }}
        startQaForItemId={startQaForItemId}
      />

      {internalizeToast && (
        <div className="fixed right-6 bottom-6 z-[800] bg-[#111] text-white text-xs px-3 py-2 rounded-lg shadow-lg">
          {internalizeToast}
        </div>
      )}
      {deleteToast && (
        <div className="fixed right-6 bottom-6 z-[800] bg-[#111] text-white text-xs px-3 py-2 rounded-lg shadow-lg">
          {deleteToast}
        </div>
      )}
      {viewToast && (
        <div className="fixed right-6 bottom-6 z-[800] bg-[#111] text-white text-xs px-3 py-2 rounded-lg shadow-lg">
          {viewToast}
        </div>
      )}

    </div>
  );
}
