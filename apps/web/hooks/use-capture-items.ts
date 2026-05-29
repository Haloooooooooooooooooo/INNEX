"use client";

import { useState, useEffect, useCallback } from "react";
import type { CaptureItem } from "@/lib/supabase/types";

type AddItemResult = {
  success?: boolean;
  error?: string;
  item?: CaptureItem;
};

function dedupeCaptureItems(items: CaptureItem[]) {
  const seen = new Set<string>();
  const deduped: CaptureItem[] = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

export function useCaptureItems() {
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState({ all: 0, later: 0, pending: 0, crystallized: 0 });

  const fetchItems = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent && !hasLoadedOnce) setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (search) params.set("search", search);

    const [listRes, countsRes] = await Promise.all([
      fetch(`/api/capture-items?${params}`),
      fetch("/api/capture-items?counts=1"),
    ]);

    if (listRes.ok) {
      const data = await listRes.json();
      setItems(dedupeCaptureItems(Array.isArray(data) ? data : []));
    }
    if (countsRes.ok) {
      const data = await countsRes.json();
      setCounts({
        all: Number(data?.all || 0),
        later: Number(data?.later || 0),
        pending: Number(data?.pending || 0),
        crystallized: Number(data?.crystallized || 0),
      });
    }
    if (!hasLoadedOnce) {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [statusFilter, search, hasLoadedOnce]);

  const hydrateItemProgressively = useCallback(async (id: string) => {
    const maxRounds = 8;
    for (let i = 0; i < maxRounds; i += 1) {
      await new Promise((r) => setTimeout(r, i < 3 ? 1200 : 2200));
      try {
        const res = await fetch(`/api/capture-items/${id}`);
        if (!res.ok) continue;
        const latest = (await res.json()) as CaptureItem;
        setItems((prev) => dedupeCaptureItems(prev.map((x) => (x.id === id ? latest : x))));

        const notes = latest.parse_debug?.notes || [];
        const hasBlockingError = notes.some((n) => n.startsWith("summary_error:") || n.startsWith("tags_error:"));
        const hasSummary = Boolean(latest.summary && latest.summary.trim() && latest.summary !== "暂无摘要");
        const hasUsefulTags = Array.isArray(latest.tags) && latest.tags.length > 0 && !(latest.tags.length === 1 && latest.tags[0] === "-");
        if ((!hasBlockingError && hasSummary && hasUsefulTags) || i >= 5) {
          break;
        }
      } catch {
        // best-effort hydration
      }
    }
    void fetchItems({ silent: true });
  }, [fetchItems]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const addItem = async (item: {
    content: string;
    my_understanding?: string;
    status: string;
    url_title?: string;
    url_content?: string;
    attachments?: { name: string; type: string; size: number }[];
    files?: File[];
  }): Promise<AddItemResult> => {
    const nowIso = new Date().toISOString();
    const tempId = `temp-${Date.now()}`;
    const optimisticTitle =
      item.url_title ||
      item.attachments?.[0]?.name ||
      item.content?.slice(0, 10) ||
      "新记录";
    const optimisticItem: CaptureItem = {
      id: tempId,
      user_id: "local-optimistic",
      type: "text",
      title: optimisticTitle,
      source: "录入中",
      source_url: null,
      raw_content: item.content || null,
      my_understanding: item.my_understanding || null,
      notebook: null,
      summary: null,
      parse_debug: {
        input_source: "none",
        detected_type: "text",
        readable: false,
        extracted_chars: 0,
        model_summary_attempted: false,
        model_summary_succeeded: false,
        model_tags_attempted: false,
        model_tags_succeeded: false,
        notes: ["processing"],
      },
      status: item.status === "pending" ? "pending" : "later",
      tags: ["-"],
      created_at: nowIso,
      updated_at: nowIso,
      attachments: (item.attachments || []).map((a, idx) => ({
        id: `${tempId}-att-${idx}`,
        capture_item_id: tempId,
        user_id: "local-optimistic",
        file_name: a.name,
        file_type: a.type,
        file_size: a.size,
        storage_path: null,
        created_at: nowIso,
      })),
    };
    setItems((prev) => dedupeCaptureItems([optimisticItem, ...prev]));

    const hasFiles = (item.files || []).length > 0;
    const res = hasFiles
      ? await (async () => {
          const form = new FormData();
          form.set("content", item.content || "");
          form.set("my_understanding", item.my_understanding || "");
          form.set("status", item.status || "later");
          if (item.url_title) form.set("url_title", item.url_title);
          if (item.url_content) form.set("url_content", item.url_content);
          if (item.attachments) form.set("attachments", JSON.stringify(item.attachments));
          for (const f of item.files || []) form.append("files", f);
          return fetch("/api/capture-items", { method: "POST", body: form });
        })()
      : await fetch("/api/capture-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
    if (res.ok) {
      const created = (await res.json()) as CaptureItem;
      setItems((prev) => dedupeCaptureItems([created, ...prev.filter((x) => x.id !== tempId)]));
      void hydrateItemProgressively(created.id);
      void fetchItems({ silent: true });
      return { success: true, item: created };
    }
    setItems((prev) => prev.filter((x) => x.id !== tempId));
    let errorMessage = "创建记录失败";
    try {
      const data = await res.json();
      if (typeof data?.error === "string" && data.error.trim()) {
        errorMessage = data.error;
      }
    } catch {
      // ignore parse failure and keep fallback message
    }
    return { error: errorMessage };
  };

  const updateItem = async (id: string, updates: Partial<CaptureItem>) => {
    let snapshot: CaptureItem[] | null = null;
    setItems((prev) => {
      snapshot = prev;
      return prev.map((x) => (x.id === id ? { ...x, ...updates, updated_at: new Date().toISOString() } : x));
    });
    const res = await fetch(`/api/capture-items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      void fetchItems({ silent: true });
      return { success: true };
    }
    if (snapshot) {
      setItems(snapshot);
    }
    return { error: "Failed to update item" };
  };

  const deleteItem = async (id: string) => {
    let snapshot: CaptureItem[] | null = null;
    setItems((prev) => {
      snapshot = prev;
      return prev.filter((x) => x.id !== id);
    });

    const res = await fetch(`/api/capture-items/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      void fetchItems({ silent: true });
      return { success: true };
    }

    if (snapshot) {
      setItems(snapshot);
    }

    let errorMessage = "删除失败，请稍后重试";
    try {
      const data = await res.json();
      if (typeof data?.error === "string" && data.error.trim()) {
        errorMessage = data.error;
      }
    } catch {
      // ignore parse failure and keep fallback message
    }
    return { error: errorMessage };
  };

  const deleteItems = async (ids: string[]) => {
    const uniqIds = Array.from(new Set(ids)).filter(Boolean);
    if (uniqIds.length === 0) return { success: true };
    let snapshot: CaptureItem[] | null = null;
    setItems((prev) => {
      snapshot = prev;
      return prev.filter((x) => !uniqIds.includes(x.id));
    });

    const results = await Promise.all(
      uniqIds.map(async (id) => {
        const res = await fetch(`/api/capture-items/${id}`, { method: "DELETE" });
        return { id, ok: res.ok };
      })
    );

    const failedIds = results.filter((r) => !r.ok).map((r) => r.id);
    if (failedIds.length === 0) {
      void fetchItems({ silent: true });
      return { success: true };
    }

    if (snapshot) {
      setItems(snapshot);
    }
    return { error: `删除失败：${failedIds.length} 条记录未删除` };
  };

  return {
    items,
    counts,
    loading,
    statusFilter,
    setStatusFilter,
    search,
    setSearch,
    addItem,
    updateItem,
    deleteItem,
    deleteItems,
    refetch: fetchItems,
  };
}
