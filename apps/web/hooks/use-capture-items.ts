"use client";

import { useState, useEffect, useCallback } from "react";
import type { CaptureItem } from "@/lib/supabase/types";

export function useCaptureItems() {
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (search) params.set("search", search);

    const res = await fetch(`/api/capture-items?${params}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data);
    }
    setLoading(false);
  }, [statusFilter, search]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const addItem = async (item: {
    type: string;
    title: string;
    source: string;
    source_url?: string;
    raw_content?: string;
    my_understanding?: string;
    tags?: string[];
    status?: string;
  }) => {
    const res = await fetch("/api/capture-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (res.ok) {
      fetchItems();
      return { success: true };
    }
    return { error: "Failed to create item" };
  };

  const updateItem = async (id: string, updates: Partial<CaptureItem>) => {
    const res = await fetch(`/api/capture-items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      fetchItems();
      return { success: true };
    }
    return { error: "Failed to update item" };
  };

  const deleteItem = async (id: string) => {
    const res = await fetch(`/api/capture-items/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      fetchItems();
      return { success: true };
    }
    return { error: "Failed to delete item" };
  };

  return {
    items,
    loading,
    statusFilter,
    setStatusFilter,
    search,
    setSearch,
    addItem,
    updateItem,
    deleteItem,
    refetch: fetchItems,
  };
}
