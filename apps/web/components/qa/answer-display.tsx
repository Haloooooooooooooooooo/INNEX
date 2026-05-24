"use client";

import { Button } from "@/components/ui/button";
import { CitationCard } from "@/components/qa/citation-card";
import type { AiAnswerCitation } from "@/lib/supabase/types";

interface AnswerDisplayProps {
  answer: string;
  citations: AiAnswerCitation[];
  onSaveToNote: () => void;
  saved: boolean;
  onOpenNote?: (noteId: string) => void;
  evidenceLevel?: "high" | "low" | "unknown";
}

export function AnswerDisplay({ answer, citations, onSaveToNote, saved, onOpenNote, evidenceLevel = "unknown" }: AnswerDisplayProps) {
  return (
    <div className="rounded-2xl border border-[--border-light] bg-white p-5 shadow-[0_6px_24px_rgba(0,0,0,0.06)]">
      <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[--ink] leading-relaxed">{answer}</div>

      {citations.length > 0 && (
        <div className="mt-5 border-t border-[--border-light] pt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[--text-muted]">引用依据</h4>
          <div className="flex flex-wrap gap-1.5">
            {citations.map((c, i) => (
              <CitationCard
                key={i}
                index={i + 1}
                title={c.title}
                excerpt={c.excerpt}
                noteId={c.note_id}
                onOpenNote={onOpenNote}
                tone={evidenceLevel}
                sourceType={c.source || "knowledge"}
                url={c.url}
                fetchedAt={c.fetched_at}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-start border-t border-[--border-light] pt-3">
        <Button
          variant={saved ? "ghost" : "outline"}
          size="sm"
          onClick={onSaveToNote}
          disabled={saved}
          className="h-7 rounded-md border-dashed text-xs text-[--innex-accent] hover:bg-[--innex-accent] hover:text-white"
        >
          {saved ? "已保存" : "+ 加入笔记"}
        </Button>
      </div>
    </div>
  );
}
