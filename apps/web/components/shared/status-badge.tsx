import type { CaptureItemStatus } from "@/lib/supabase/types";

const config: Record<CaptureItemStatus, { label: string; className: string }> = {
  later: { label: "稍后看", className: "bg-[#d9d5cf] text-[#4d4944]" },
  pending: {
    label: "待内化",
    className: "bg-[#f8e8da] text-[--innex-accent]",
  },
  crystallized: {
    label: "已沉淀",
    className: "bg-[#dcead9] text-[#0f8e67]",
  },
};

export function StatusBadge({ status }: { status: CaptureItemStatus }) {
  const { label, className } = config[status] || config.later;
  return (
    <span className={`inline-block text-[11px] px-3 py-[3px] rounded-[10px] font-semibold ${className}`}>
      {label}
    </span>
  );
}
