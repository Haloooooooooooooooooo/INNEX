"use client";

import { useCaptureItems } from "@/hooks/use-capture-items";
import { QuickCapture } from "@/components/inbox/quick-capture";
import { InboxToolbar } from "@/components/inbox/inbox-toolbar";
import { InboxTable } from "@/components/inbox/inbox-table";
import { InboxDrawer } from "@/components/inbox/inbox-drawer";
import { useState, useCallback } from "react";
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
  const [internalizing, setInternalizing] = useState<string | null>(null);

  function openDrawer(item: CaptureItem) {
    setSelectedItem(item);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setSelectedItem(null), 200);
  }

  const handleInternalize = useCallback(async (id: string) => {
    setInternalizing(id);
    try {
      const res = await fetch("/api/internalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureItemId: id }),
      });
      if (res.ok) {
        await updateItem(id, { status: "crystallized" });
      }
    } catch {
      // silently fail, user can retry
    } finally {
      setInternalizing(null);
    }
  }, [updateItem]);

  // Count by status
  const counts = {
    all: items.length,
    later: items.filter((i) => i.status === "later").length,
    pending: items.filter((i) => i.status === "pending").length,
    crystallized: items.filter((i) => i.status === "crystallized").length,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-10 pb-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-[3px] h-[18px] bg-[--innex-accent] rounded-sm shrink-0" />
          <span className="text-xl font-[850] text-[--ink] tracking-[-0.2px]">收录箱</span>
          <span className="text-[11px] text-[#8A8278] font-semibold tracking-[0.12em] uppercase ml-1">INBOX</span>
        </div>
      </div>

      <div className="px-5 pb-3 shrink-0">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-[3px] h-[18px] bg-[--innex-accent] rounded-sm shrink-0" />
          <span className="text-xl font-[850] text-[--ink] tracking-[-0.2px]">快速录入</span>
          <span className="text-[11px] text-[#8A8278] font-semibold tracking-[0.12em] uppercase ml-1">QUICK CAPTURE</span>
        </div>
        <QuickCapture onAdd={addItem} />
      </div>

      <div className="flex-1 overflow-hidden px-3 pb-0 flex flex-col min-h-[590px]">
        <div className="bg-[--paper-light] border border-black/[0.14] rounded-xl flex-1 min-h-0 overflow-hidden flex flex-col shadow-[0_16px_36px_rgba(0,0,0,0.06)]">
          <InboxToolbar
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            search={search}
            onSearchChange={setSearch}
            counts={counts}
          />
          <div className="flex-1 overflow-hidden">
            <InboxTable
              items={items}
              loading={loading}
              onSelect={openDrawer}
              onStatusChange={(id, status) => updateItem(id, { status })}
              onInternalize={handleInternalize}
            />
          </div>
        </div>
      </div>

      <InboxDrawer
        item={selectedItem}
        open={drawerOpen}
        onClose={closeDrawer}
        onUpdate={updateItem}
        onDelete={deleteItem}
        onInternalize={handleInternalize}
        internalizing={internalizing === selectedItem?.id}
      />
    </div>
  );
}
