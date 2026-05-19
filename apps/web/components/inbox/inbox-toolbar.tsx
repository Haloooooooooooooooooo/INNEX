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
}

export function InboxToolbar({
  statusFilter,
  onStatusChange,
  search,
  onSearchChange,
}: InboxToolbarProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            data-tab={tab.key}
            onClick={() => onStatusChange(tab.key)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              statusFilter === tab.key
                ? "bg-[--ink] text-white font-medium"
                : "text-[--muted] hover:bg-black/5"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <Input
        placeholder="搜索标题、来源…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-56 h-8 text-sm"
      />
    </div>
  );
}
