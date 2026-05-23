"use client";

import { useState } from "react";
import { Nav } from "@/components/layout/nav";
import { TopBar } from "@/components/layout/topbar";
import { CalendarPopover } from "@/components/shared/calendar-popover";
import { InfoModal } from "@/components/shared/info-modal";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [calOpen, setCalOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <div className="innex-shell flex flex-col">
      <TopBar calOpen={calOpen} onToggleCal={() => setCalOpen((v) => !v)} />
      <div className="flex flex-1 overflow-hidden">
        <Nav />
        <main className="innex-main-area flex-1 overflow-hidden">{children}</main>
      </div>
      <CalendarPopover
        open={calOpen}
        onClose={() => setCalOpen(false)}
        onOpenInfo={() => {
          setCalOpen(false);
          setInfoOpen(true);
        }}
      />
      <InfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
