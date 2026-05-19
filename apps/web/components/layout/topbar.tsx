"use client";

import { UserMenu } from "@/components/auth/user-menu";

interface TopBarProps {
  calOpen: boolean;
  onToggleCal: () => void;
}

export function TopBar({ calOpen, onToggleCal }: TopBarProps) {
  return (
    <header className="h-0 bg-transparent border-0 flex items-center justify-end px-0 shrink-0 relative z-50">
      <div className="fixed top-[22px] right-[22px] z-[500] flex gap-2 items-center">
        <button
          onClick={onToggleCal}
          className={`w-[42px] h-[42px] rounded-lg border border-white/18 bg-black/76 text-[#d8d3ca] backdrop-blur-[10px] flex items-center justify-center cursor-pointer text-sm transition-all duration-150 hover:bg-[--innex-accent-dim] hover:text-white hover:border-[--innex-accent]/45 ${
            calOpen ? "text-[--innex-accent] border-[--innex-accent]/40" : ""
          }`}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
