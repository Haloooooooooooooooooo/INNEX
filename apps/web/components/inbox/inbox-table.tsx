"use client";

import type { CaptureItem, CaptureItemStatus } from "@/lib/supabase/types";
import { StatusBadge } from "@/components/shared/status-badge";

interface InboxTableProps {
  items: CaptureItem[];
  loading: boolean;
  onSelect: (item: CaptureItem) => void;
  onStatusChange: (id: string, status: CaptureItemStatus) => void;
}

const statusLabels: Record<CaptureItemStatus, string> = {
  later: "稍后看",
  pending: "待内化",
  crystallized: "已沉淀",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}`;
}

export function InboxTable({ items, loading, onSelect, onStatusChange }: InboxTableProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-[--border-light] p-12 text-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[--border-light] p-12 text-center">
        <p className="text-sm text-muted-foreground">还没有收录记录</p>
        <p className="text-xs text-muted-foreground mt-1">
          在上方快速录入框中粘贴链接或输入文字，开始你的第一条收录
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[--border-light] overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-380px)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[--border-light] bg-[--paper-light]">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[40%]">
                标题
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[15%]">
                来源
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[10%]">
                状态
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[15%]">
                标签
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[12%]">
                时间
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[8%]">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b border-[--border-light] hover:bg-[--innex-accent-dim] cursor-pointer transition-colors"
                onClick={() => onSelect(item)}
              >
                <td className="px-4 py-3">
                  <span className="font-medium text-[--ink] line-clamp-1">
                    {item.title}
                  </span>
                </td>
                <td className="px-4 py-3 text-[--text-secondary] truncate max-w-[140px]">
                  {item.source}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {item.tags?.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 text-[--text-secondary]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                  {formatDate(item.created_at)}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next: CaptureItemStatus =
                        item.status === "later"
                          ? "pending"
                          : item.status === "pending"
                            ? "crystallized"
                            : "later";
                      onStatusChange(item.id, next);
                    }}
                    className="text-[10px] px-2 py-1 rounded border border-[--border-light] hover:bg-[--innex-accent-dim] hover:text-[--innex-accent] transition-colors whitespace-nowrap"
                  >
                    → {statusLabels[item.status === "later" ? "pending" : item.status === "pending" ? "crystallized" : "later"]}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
