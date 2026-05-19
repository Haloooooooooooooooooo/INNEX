"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { useNotes } from "@/hooks/use-notes";
import { Input } from "@/components/ui/input";

function formatDate(iso: string) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export default function KbPage() {
  const { notes, loading, search, setSearch } = useNotes();

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        <div className="px-5 pt-10 pb-6 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-[3px] h-[18px] bg-[--innex-accent] rounded-sm shrink-0" />
            <span className="text-xl font-[850] text-[--ink] tracking-[-0.2px]">知识库</span>
            <span className="text-[11px] text-[#8A8278] font-semibold tracking-[0.12em] uppercase ml-1">
              KNOWLEDGE BASE
            </span>
          </div>
          <p className="text-xs text-[--text-secondary] mt-1">
            已沉淀的结构化笔记。内化收录内容后自动出现在这里。
          </p>
        </div>

        <div className="px-5 pb-4 shrink-0">
          <div className="relative">
            <Input
              placeholder="搜索笔记标题、内容…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-60 h-8 text-xs border-[--border-light] rounded-md pl-7"
            />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs opacity-40">🔍</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 pb-8">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : notes.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm text-muted-foreground">知识库为空</p>
              <p className="text-xs text-muted-foreground mt-1">
                在收录箱中点击"一键内化"将内容转化为笔记
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="bg-white rounded-xl border border-[--border-light] p-4 hover:shadow-md transition-shadow cursor-pointer"
                >
                  <h3 className="font-semibold text-[--ink] text-sm leading-snug line-clamp-2">
                    {note.title}
                  </h3>
                  {note.summary && (
                    <p className="text-xs text-[--text-secondary] mt-1.5 line-clamp-2">
                      {note.summary}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                    {note.concepts?.slice(0, 4).map((c) => (
                      <span
                        key={c}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[--innex-accent-dim] text-[--innex-accent]"
                      >
                        {c}
                      </span>
                    ))}
                    {note.source && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {note.source} · {formatDate(note.created_at)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
