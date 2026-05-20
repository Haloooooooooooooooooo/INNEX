"use client";

import type { CaptureItem, CaptureItemStatus } from "@/lib/supabase/types";

interface InboxTableProps {
  items: CaptureItem[];
  loading: boolean;
  onSelect: (item: CaptureItem) => void;
  onStatusChange: (id: string, status: CaptureItemStatus) => void;
  onInternalize: (id: string) => void;
}

const statusConfig: Record<CaptureItemStatus, { label: string; cls: string }> = {
  later: { label: "稍后看", cls: "bg-gray-100 text-gray-600" },
  pending: { label: "待内化", cls: "bg-orange-50 text-[--status-pending]" },
  crystallized: { label: "已沉淀", cls: "bg-green-50 text-[--status-crystallized]" },
};

const actionButtons: Record<CaptureItemStatus, { label: string; action: string; cls: string }[]> = {
  later: [
    { label: "转待内化", action: "toPending", cls: "text-[--ink] hover:text-[--innex-accent]" },
    { label: "一键内化", action: "internalize", cls: "text-[--innex-accent] font-semibold" },
  ],
  pending: [
    { label: "一键内化", action: "internalize", cls: "text-[--innex-accent] font-semibold" },
  ],
  crystallized: [
    { label: "提问", action: "qa", cls: "text-[--ink] hover:text-[--innex-accent]" },
    { label: "定位", action: "locate", cls: "text-[--ink] hover:text-[--innex-accent]" },
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

export function InboxTable({ items, loading, onSelect, onStatusChange, onInternalize }: InboxTableProps) {
  if (loading) {
    return (
      <div className="bg-[--paper-light] border border-black/[0.14] rounded-xl p-12 text-center text-sm text-muted-foreground shadow-[0_16px_36px_rgba(0,0,0,0.06)]">
        加载中…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-[--paper-light] border border-black/[0.14] rounded-xl p-12 text-center shadow-[0_16px_36px_rgba(0,0,0,0.06)]">
        <p className="text-sm text-muted-foreground">还没有收录记录</p>
        <p className="text-xs text-muted-foreground mt-1">
          在上方输入框粘贴链接或文字，开始你的第一条收录
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[--paper-light] border border-black/[0.14] rounded-xl flex-1 min-h-0 overflow-hidden flex flex-col shadow-[0_16px_36px_rgba(0,0,0,0.06)]">
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[--border-light]">
              <th className="w-[32px] pl-4 py-3 text-left">
                <input type="checkbox" className="w-3.5 h-3.5 rounded border-[--border-light] cursor-pointer" />
              </th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[--text-secondary] uppercase tracking-wider">
                标题
              </th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[--text-secondary] uppercase tracking-wider">
                来源
              </th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[--text-secondary] uppercase tracking-wider">
                收录时间
              </th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[--text-secondary] uppercase tracking-wider">
                状态
              </th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[--text-secondary] uppercase tracking-wider">
                标签
              </th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-[--text-secondary] uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const st = statusConfig[item.status] || statusConfig.later;
              const actions = actionButtons[item.status] || [];
              return (
                <tr
                  key={item.id}
                  className="border-b border-[--border-light] last:border-b-0 hover:bg-[rgba(241,90,36,0.06)] cursor-pointer transition-colors"
                  onClick={() => onSelect(item)}
                >
                  <td className="pl-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="w-3.5 h-3.5 rounded border-[--border-light] cursor-pointer" />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-[--ink] line-clamp-1 cursor-pointer hover:text-[--innex-accent]">
                      {item.title}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 bg-black/[0.04] rounded text-[11px] text-[--text-secondary]">
                      {item.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-[--text-secondary] font-mono whitespace-nowrap">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block text-[11px] px-2 py-0.5 rounded font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {item.tags?.length ? (
                        item.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-black/[0.05] text-[--text-secondary]">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-[--text-muted]">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {actions.map((a) => (
                        <button
                          key={a.action}
                          onClick={() => {
                            if (a.action === "internalize") onInternalize(item.id);
                            else if (a.action === "toPending") onStatusChange(item.id, "pending");
                          }}
                          className={`text-[11px] transition-colors whitespace-nowrap ${a.cls}`}
                        >
                          {a.label}
                        </button>
                      ))}
                      {/* View original — all statuses */}
                      {item.source_url && (
                        <button
                          onClick={() => window.open(item.source_url!, "_blank")}
                          className="text-[11px] text-[--ink] hover:text-[--innex-accent] transition-colors"
                        >
                          查看原文
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
