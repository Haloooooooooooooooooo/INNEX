"use client";

import { Button } from "@/components/ui/button";
import { CitationCard } from "@/components/qa/citation-card";
import type { AiAnswerCitation } from "@/lib/supabase/types";

interface AnswerDisplayProps {
  answer: string;
  citations: AiAnswerCitation[];
  onSaveToNote: () => void;
  saved: boolean;
}

export function AnswerDisplay({ answer, citations, onSaveToNote, saved }: AnswerDisplayProps) {
  return (
    <div className="bg-white rounded-xl border border-[--border-light] p-5 shadow-sm">
      {/* Answer content */}
      <div className="prose prose-sm max-w-none text-[--ink] leading-relaxed whitespace-pre-wrap">
        {answer}
      </div>

      {/* Citations */}
      {citations.length > 0 && (
        <div className="mt-5 pt-4 border-t border-[--border-light]">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            引用来源
          </h4>
          <div className="flex flex-col gap-1.5">
            {citations.map((c, i) => (
              <CitationCard
                key={i}
                index={i + 1}
                title={c.title}
                excerpt={c.excerpt}
                noteId={c.note_id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Save to note */}
      <div className="mt-4 pt-3 border-t border-[--border-light] flex justify-end">
        <Button
          variant={saved ? "ghost" : "outline"}
          size="sm"
          onClick={onSaveToNote}
          disabled={saved}
          className="text-xs"
        >
          {saved ? "已保存" : "加入笔记"}
        </Button>
      </div>
    </div>
  );
}
