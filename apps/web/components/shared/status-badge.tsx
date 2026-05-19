import type { CaptureItemStatus } from "@/lib/supabase/types";

const config: Record<CaptureItemStatus, { label: string; className: string }> = {
  later: { label: "稍后看", className: "bg-gray-100 text-gray-600" },
  pending: {
    label: "待内化",
    className: "bg-orange-50 text-[--status-pending]",
  },
  crystallized: {
    label: "已沉淀",
    className: "bg-green-50 text-[--status-crystallized]",
  },
};

export function StatusBadge({ status }: { status: CaptureItemStatus }) {
  const { label, className } = config[status] || config.later;
  return (
    <span
      className={`inline-block text-[11px] px-2 py-0.5 rounded font-medium ${className}`}
    >
      {label}
    </span>
  );
}
