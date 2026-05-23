"use client";

import { Input } from "@/components/ui/input";

const tabs = [
  { key: "all", label: "全部" },
  { key: "later", label: "稍后看" },
  { key: "pending", label: "待内化" },
  { key: "crystallized", label: "已沉淀" },
];

interface InboxToolbarProps {
  statusFilter: string;
  onStatusChange: (status: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  counts: { all: number; later: number; pending: number; crystallized: number };
}

const filterBtnCls =
  "h-[24px] px-2 rounded-[6px] border border-[--border-medium] bg-white/50 text-[10px] text-[--text-secondary] hover:border-[--innex-accent] hover:text-[--innex-accent] transition-colors";

export function InboxToolbar({
  statusFilter,
  onStatusChange,
  search,
  onSearchChange,
  counts,
}: InboxToolbarProps) {
  return (
    <div className="shrink-0 border-b border-[--border-light]">
      <div className="flex items-center gap-2 px-3.5 pt-1.5 pb-0.5">
        <span className="inline-block w-[3px] h-[15px] bg-[--innex-accent] rounded-sm shrink-0" />
        <span className="text-[18px] font-[850] text-[--ink] tracking-[-0.2px]">收录箱</span>
        <span className="text-[10px] text-[#8A8278] font-semibold tracking-[0.12em] uppercase">INBOX</span>

        <div className="ml-auto relative">
          <Input
            placeholder="搜索标题、内容、标签、来源..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-[210px] focus:w-[250px] h-7 text-[11px] border-[--border-medium] rounded-full pl-7 pr-3 bg-white/60 transition-all"
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-[--text-muted]">🔍</span>
        </div>
      </div>

      <div className="flex items-center gap-1 px-3 pb-2 pt-0.5 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onStatusChange(tab.key)}
            className={`px-2 py-0.5 text-[11px] border-b-2 transition-colors ${
              statusFilter === tab.key
                ? "text-[--innex-accent] border-[--innex-accent] font-semibold"
                : "text-[--text-secondary] border-transparent hover:text-[--ink]"
            }`}
          >
            {tab.label} <span className="text-[--text-muted]">({counts[tab.key as keyof typeof counts]})</span>
          </button>
        ))}

        <div className="ml-3 flex items-center gap-1.5">
          <button type="button" className={filterBtnCls}>来源 ▾</button>
          <button type="button" className={filterBtnCls}>时间 ▾</button>
          <button type="button" className={filterBtnCls}>标签 ▾</button>
          <button type="button" className={filterBtnCls}>○ 清空筛选</button>
        </div>
      </div>
    </div>
  );
}
