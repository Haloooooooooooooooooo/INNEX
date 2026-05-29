"use client";

type WaveLoaderProps = {
  label?: string;
  size?: "sm" | "md" | "xl";
  fullHeight?: boolean;
  className?: string;
};

export function WaveLoader({ label = "加载中...", size = "md", fullHeight = false, className = "" }: WaveLoaderProps) {
  const block = size === "sm"
    ? "h-2 w-2 sm:h-2.5 sm:w-2.5"
    : size === "xl"
      ? "h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8"
      : "h-2.5 w-2.5 sm:h-3 sm:w-3";
  const gap = size === "sm" ? "gap-1.5 sm:gap-2" : size === "xl" ? "gap-3 sm:gap-4 lg:gap-5" : "gap-2 sm:gap-2.5";
  const textCls = size === "xl" ? "text-base sm:text-lg" : "text-xs";
  const containerHeight = fullHeight ? "h-full min-h-[220px]" : "";
  return (
    <div className={`flex flex-col items-center justify-center ${containerHeight} gap-2 ${className}`}>
      <div className={`flex items-end justify-center ${gap} w-full`}>
        {Array.from({ length: 8 }).map((_, i) => (
          <span
            key={i}
            className={`relative box-border rounded-[3px] bg-[#F15A24] ${block}`}
            style={{
              animationName: "innex-wave-23",
              animationDuration: "2s",
              animationTimingFunction: "ease",
              animationIterationCount: "infinite",
              animationDelay: `${i * 0.08}s`,
            }}
          />
        ))}
      </div>
      <p className={`${textCls} text-[--text-secondary]`}>{label}</p>
    </div>
  );
}
