"use client";

"use client";

import { useMemo, useState } from "react";
import type { CaptureItem, CaptureItemStatus } from "@/lib/supabase/types";

interface InboxTableProps {
  items: CaptureItem[];
  loading: boolean;
  onSelect: (item: CaptureItem) => void;
  onAskFromItem: (item: CaptureItem) => void;
  onStatusChange: (id: string, status: CaptureItemStatus) => void;
  onInternalize: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => void;
  onViewOriginal: (item: CaptureItem) => void;
  internalizingId?: string | null;
}

const statusConfig: Record<CaptureItemStatus, { label: string; cls: string }> = {
  later: { label: "稍后看", cls: "bg-[#d9d5cf] text-[#4d4944]" },
  pending: { label: "待内化", cls: "bg-[#f8e8da] text-[--innex-accent]" },
  crystallized: { label: "已沉淀", cls: "bg-[#dcead9] text-[#0f8e67]" },
};

function formatTitle(title: string) {
  if (title.length <= 10) return title;
  return `${title.slice(0, 10)}...`;
}

const actionButtons: Record<CaptureItemStatus, { label: string; action: string; cls: string }[]> = {
  later: [
    { label: "查看原笔记", action: "view", cls: "text-[--ink] hover:text-[--innex-accent]" },
    { label: "转待内化", action: "toPending", cls: "text-[--ink] hover:text-[--innex-accent]" },
    { label: "一键内化", action: "internalize", cls: "text-[--innex-accent] font-semibold" },
    { label: "删除", action: "delete", cls: "text-red-600 hover:text-red-700" },
  ],
  pending: [
    { label: "查看原笔记", action: "view", cls: "text-[--ink] hover:text-[--innex-accent]" },
    { label: "一键内化", action: "internalize", cls: "text-[--innex-accent] font-semibold" },
    { label: "删除", action: "delete", cls: "text-red-600 hover:text-red-700" },
  ],
  crystallized: [
    { label: "查看原笔记", action: "view", cls: "text-[--ink] hover:text-[--innex-accent]" },
    { label: "提问", action: "qa", cls: "text-[--ink] hover:text-[--innex-accent]" },
    { label: "定位", action: "locate", cls: "text-[--ink] hover:text-[--innex-accent]" },
    { label: "删除", action: "delete", cls: "text-red-600 hover:text-red-700" },
  ],
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function InboxTable({ items, loading, onSelect, onAskFromItem, onStatusChange, onInternalize, onDelete, onDeleteMany, onViewOriginal, internalizingId = null }: InboxTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function closeContextMenu() {
    setContextMenu(null);
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)));
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? items.map((x) => x.id) : []);
  }

  async function runAction(action: string, item: CaptureItem) {
    if (action === "delete") {
      if (!window.confirm(`确认删除「${item.title}」吗？此操作不可恢复。`)) return;
      onDelete(item.id);
      return;
    }
    if (action === "toPending" || action === "internalize") {
      if (action === "internalize" && internalizingId) return;
      setActionLoadingId(`${item.id}:${action}`);
      if (action === "toPending") {
        onStatusChange(item.id, "pending");
      }
      if (action === "internalize") {
        await onInternalize(item.id);
      }
      setActionLoadingId(null);
      return;
    }
    if (action === "view") onViewOriginal(item);
    if (action === "qa") onAskFromItem(item);
    if (action === "locate") window.location.href = `/kb?captureItemId=${item.id}`;
  }

  if (loading) {
    return (
      <div className="bg-[--paper-light] border border-black/[0.14] rounded-xl p-12 text-center text-sm text-muted-foreground shadow-[0_16px_36px_rgba(0,0,0,0.06)]">
        加载中...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-[--paper-light] border border-black/[0.14] rounded-xl p-12 text-center shadow-[0_16px_36px_rgba(0,0,0,0.06)]">
        <p className="text-sm text-muted-foreground">还没有收录记录</p>
        <p className="text-xs text-muted-foreground mt-1">在上方输入框粘贴链接或文字，开始你的第一条收录</p>
      </div>
    );
  }

  return (
    <div className="bg-[--paper-light] h-full flex-1 min-h-0 overflow-hidden flex flex-col relative" onClick={closeContextMenu}>
      <div className="list-scrollbar h-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <table className="w-full text-[12px] table-fixed">
          <colgroup>
            <col className="w-[46px]" />
            <col className="w-[260px]" />
            <col className="w-[150px]" />
            <col className="w-[210px]" />
            <col className="w-[160px]" />
            <col />
            <col className="w-[280px]" />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[--border-light] bg-[#eee8de]">
              <th className="w-[34px] pl-3.5 py-[6px] text-left">
                <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} className="w-3.5 h-3.5 rounded border-[--border-light] cursor-pointer" />
              </th>
              <th className="text-left px-3.5 py-[6px] text-[10px] font-semibold text-[--text-muted]">标题</th>
              <th className="text-left px-3.5 py-[6px] text-[10px] font-semibold text-[--text-muted]">来源</th>
              <th className="text-left px-3.5 py-[6px] text-[10px] font-semibold text-[--text-muted]">收录时间</th>
              <th className="text-left px-3.5 py-[6px] text-[10px] font-semibold text-[--text-muted]">状态</th>
              <th className="text-left px-3.5 py-[6px] text-[10px] font-semibold text-[--text-muted]">标签</th>
              <th className="text-left px-3.5 py-[6px] text-[10px] font-semibold text-[--text-muted]">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const st = statusConfig[item.status] || statusConfig.later;
              const isProcessing = item.parse_debug?.notes?.includes("processing");
              const actions = actionButtons[item.status] || [];
              return (
                <tr
                  key={item.id}
                  className="border-b border-[--border-light] last:border-b-0 hover:bg-[rgba(241,90,36,0.06)] cursor-pointer transition-colors"
                  onClick={() => onSelect(item)}
                  onContextMenu={(e) => {
                    if (selectedIds.length > 1 && selectedSet.has(item.id)) {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, ids: selectedIds });
                    }
                  }}
                >
                  <td className="w-[34px] pl-3.5 py-[7px]" onClick={(e) => e.stopPropagation()}>
                    <input checked={selectedSet.has(item.id)} onChange={(e) => toggleOne(item.id, e.target.checked)} type="checkbox" className="w-3.5 h-3.5 rounded border-[--border-light] cursor-pointer" />
                  </td>
                  <td className="px-3.5 py-[7px]">
                    <span className="font-semibold text-[11px] text-[--ink] line-clamp-1 cursor-pointer hover:text-[--innex-accent]">{formatTitle(item.title)}</span>
                  </td>
                  <td className="px-3.5 py-[7px]">
                    <span className="inline-block px-1.5 py-0.5 bg-black/[0.04] rounded-[5px] text-[10px] text-[--text-secondary]">{item.source}</span>
                  </td>
                  <td className="px-3.5 py-[7px] text-[10px] text-[--text-secondary] font-mono whitespace-nowrap">{formatDate(item.created_at)}</td>
                  <td className="px-3.5 py-[7px]">
                    <span className={`inline-block text-[10px] px-2.5 py-[2px] rounded-[9px] font-semibold ${isProcessing ? "bg-blue-50 text-blue-600" : st.cls}`}>
                      {isProcessing ? "录入中" : st.label}
                    </span>
                  </td>
                  <td className="px-3.5 py-[7px]">
                    <div className="flex gap-1 flex-wrap">
                      {item.tags?.length ? (
                        item.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-[5px] bg-black/[0.05] text-[--text-secondary] border border-black/[0.08]">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-[--text-muted]">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3.5 py-[7px]" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {actions.map((a) => (
                        <button
                          key={a.action}
                          onClick={() => void runAction(a.action, item)}
                          disabled={
                            a.action === "internalize"
                              ? Boolean(internalizingId)
                              : a.action === "delete"
                                ? Boolean(internalizingId)
                                : false
                          }
                          className={`text-[10px] px-2.5 py-[3px] rounded-full border border-black/[0.14] bg-white/65 transition-colors whitespace-nowrap cursor-pointer ${a.cls}`}
                        >
                          {a.action === "internalize" && internalizingId === item.id
                            ? "内化中..."
                            : actionLoadingId === `${item.id}:${a.action}`
                              ? "处理中..."
                              : a.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {contextMenu && (
        <div className="fixed z-[900] min-w-[120px] rounded-md border border-black/15 bg-white shadow-lg py-1" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            type="button"
            disabled={Boolean(internalizingId)}
            className="w-full text-left px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 cursor-pointer"
            onClick={() => {
              closeContextMenu();
              if (!window.confirm(`确认删除已选中的 ${contextMenu.ids.length} 条记录吗？此操作不可恢复。`)) return;
              onDeleteMany(contextMenu.ids);
              setSelectedIds([]);
            }}
          >
            全部删除
          </button>
        </div>
      )}
    </div>
  );
}
