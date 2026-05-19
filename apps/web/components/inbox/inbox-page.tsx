"use client";

import { useCaptureItems } from "@/hooks/use-capture-items";
import { QuickCapture } from "@/components/inbox/quick-capture";
import { InboxToolbar } from "@/components/inbox/inbox-toolbar";
import { InboxTable } from "@/components/inbox/inbox-table";
import { InboxDrawer } from "@/components/inbox/inbox-drawer";
import { useState } from "react";
import type { CaptureItem } from "@/lib/supabase/types";

export function InboxPage() {
  const {
    items,
    loading,
    statusFilter,
    setStatusFilter,
    search,
    setSearch,
    addItem,
    updateItem,
    deleteItem,
  } = useCaptureItems();

  const [selectedItem, setSelectedItem] = useState<CaptureItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDrawer(item: CaptureItem) {
    setSelectedItem(item);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setSelectedItem(null), 200);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-10 pb-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-[3px] h-[22px] bg-[--innex-accent] rounded-sm shrink-0" />
          <div>
            <h1 className="text-[26px] font-bold text-[--ink] tracking-tight leading-tight">
              收录箱
            </h1>
            <p className="text-[11px] text-[--muted] tracking-[0.04em] uppercase">INBOX</p>
          </div>
        </div>
      </div>

      <div className="px-8 pb-4 shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-[3px] h-[12px] bg-[--innex-accent] rounded-sm shrink-0" />
          <span className="text-sm font-semibold text-[--ink]">快速录入</span>
          <span className="text-[10px] text-[--muted] tracking-[0.04em] uppercase">QUICK CAPTURE</span>
        </div>
        <QuickCapture onAdd={addItem} />
      </div>

      <div className="px-8 pb-3 shrink-0">
        <InboxToolbar
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          search={search}
          onSearchChange={setSearch}
        />
      </div>

      <div className="flex-1 overflow-auto px-8 pb-8">
        <InboxTable
          items={items}
          loading={loading}
          onSelect={openDrawer}
          onStatusChange={(id, status) => updateItem(id, { status })}
        />
      </div>

      <InboxDrawer
        item={selectedItem}
        open={drawerOpen}
        onClose={closeDrawer}
        onUpdate={updateItem}
        onDelete={deleteItem}
      />
    </div>
  );
}
