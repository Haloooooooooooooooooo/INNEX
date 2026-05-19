"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoteListItem } from "@/lib/supabase/types";

export function useNotes() {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (tagFilter) params.set("tag", tagFilter);

    const res = await fetch(`/api/notes?${params}`);
    if (res.ok) {
      const data = await res.json();
      setNotes(data);
    }
    setLoading(false);
  }, [search, tagFilter]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  return { notes, loading, search, setSearch, tagFilter, setTagFilter, refetch: fetchNotes };
}
