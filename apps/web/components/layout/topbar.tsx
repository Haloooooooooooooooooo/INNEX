"use client";

import { UserMenu } from "@/components/auth/user-menu";

export function TopBar() {
  return (
    <header className="h-0 bg-transparent border-0 flex items-center justify-end px-0 shrink-0 relative z-50">
      <div className="fixed top-[22px] right-[22px] z-[500] flex gap-2 items-center">
        <UserMenu />
      </div>
    </header>
  );
}
