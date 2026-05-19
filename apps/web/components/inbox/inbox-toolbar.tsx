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

export function InboxToolbar({
  statusFilter,
  onStatusChange,
  search,
  onSearchChange,
  counts,
}: InboxToolbarProps) {
  return (
    <div className="px-4 pt-3 pb-2 flex items-center gap-3 border-b border-[--border-light] shrink-0">
      <div className="flex gap-5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            data-tab={tab.key}
            onClick={() => onStatusChange(tab.key)}
            className={`text-[13px] transition-colors pb-2 border-b-[3px] -mb-[9px] ${
              statusFilter === tab.key
                ? "text-[--ink] font-semibold border-[--innex-accent]"
                : "text-[--text-muted] border-transparent hover:text-[--ink]"
            }`}
          >
            {tab.label}{" "}
            <span className="text-[--text-muted] text-xs">({counts[tab.key as keyof typeof counts]})</span>
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <div className="relative">
        <Input
          placeholder="搜索标题、标签、来源…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-52 h-8 text-xs border-[--border-light] rounded-md pl-7"
        />
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs opacity-40">🔍</span>
      </div>
    </div>
  );
}
