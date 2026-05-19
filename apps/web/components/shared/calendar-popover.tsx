"use client";

interface CalendarPopoverProps {
  open: boolean;
  onClose: () => void;
  onOpenInfo: () => void;
}

const DAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

// Static mock calendar data for May 2026
const today = 19;
const daysWithRecords = [1, 2, 4, 5, 8, 9, 11, 12, 13, 14, 15, 19];

function generateCalendarDays() {
  // May 2026 starts on Friday (day 5)
  const startDay = 5;
  const daysInMay = 31;
  const days: { day: number; otherMonth: boolean }[] = [];

  // Previous month (April) trailing days
  for (let i = 0; i < startDay; i++) {
    days.push({ day: 30 - startDay + i + 1, otherMonth: true });
  }
  // May days
  for (let i = 1; i <= daysInMay; i++) {
    days.push({ day: i, otherMonth: false });
  }

  return days;
}

export function CalendarPopover({ open, onClose, onOpenInfo }: CalendarPopoverProps) {
  if (!open) return null;

  const days = generateCalendarDays();

  return (
    <>
      <div className="fixed inset-0 z-[199]" onClick={onClose} />
      <div className="fixed top-[60px] right-[22px] z-[200] bg-white border border-[--border-medium] rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.15)] p-4 w-[240px]">
        <div className="flex items-center justify-between mb-3">
          <button className="bg-none border-0 cursor-pointer text-[--text-secondary] text-sm px-1 py-0.5">
            ‹
          </button>
          <span className="text-[13px] font-semibold text-[--text-primary]">
            2026年 5月
          </span>
          <button className="bg-none border-0 cursor-pointer text-[--text-secondary] text-sm px-1 py-0.5">
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {DAY_LABELS.map((label) => (
            <div
              key={label}
              className="text-[10px] text-[--text-muted] text-center py-1 font-medium"
            >
              {label}
            </div>
          ))}
          {days.map((d, i) => {
            const hasRecord = daysWithRecords.includes(d.day) && !d.otherMonth;
            const isToday = d.day === today && !d.otherMonth;
            return (
              <div
                key={i}
                onClick={() => {
                  if (hasRecord) onOpenInfo();
                }}
                className={`text-[11px] text-center py-[5px] rounded-md relative transition-colors ${
                  d.otherMonth
                    ? "text-gray-300 cursor-default"
                    : isToday
                      ? "bg-[--innex-accent] text-white font-semibold cursor-pointer"
                      : "text-[--text-secondary] cursor-pointer hover:bg-[--innex-accent-dim]"
                }`}
              >
                {d.day}
                {hasRecord && (
                  <span
                    className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                      isToday ? "bg-white/80" : "bg-[--innex-accent]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-[--border-light] text-[10px] text-[--text-muted]">
          <span className="w-2 h-2 bg-[--innex-accent] rounded-full inline-block" />
          有记录
        </div>
      </div>
    </>
  );
}
