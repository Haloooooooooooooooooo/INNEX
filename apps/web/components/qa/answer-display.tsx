"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CitationCard } from "@/components/qa/citation-card";
import type { AiAnswerCitation } from "@/lib/supabase/types";

interface AnswerDisplayProps {
  answer: string;
  citations: AiAnswerCitation[];
  onOpenNote?: (noteId: string) => void;
  evidenceLevel?: "high" | "low" | "unknown";
}

export function AnswerDisplay({ answer, citations, onOpenNote, evidenceLevel = "unknown" }: AnswerDisplayProps) {
  const displayCitations = useMemo(() => {
    const seen = new Set<string>();
    const list: AiAnswerCitation[] = [];
    for (const c of citations || []) {
      const key = (c.source || "knowledge") === "web" ? `web:${c.url || c.title}` : `knowledge:${c.note_id || c.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(c);
    }
    return list;
  }, [citations]);

  return (
    <div className="rounded-2xl border border-[--border-light] bg-white p-5 shadow-[0_6px_24px_rgba(0,0,0,0.06)]">
      <div className="prose prose-sm max-w-none text-[--ink] prose-headings:text-[--ink] prose-p:leading-relaxed prose-li:leading-relaxed prose-a:text-[--innex-accent] prose-strong:text-[--ink] prose-code:rounded prose-code:bg-[--paper] prose-code:px-1 prose-code:text-[--innex-accent] prose-pre:bg-[--paper]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {answer}
        </ReactMarkdown>
      </div>

      {displayCitations.length > 0 && (
        <div className="mt-5 border-t border-[--border-light] pt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[--text-muted]">引用依据</h4>
          <div className="flex flex-wrap gap-1.5">
            {displayCitations.map((c, i) => (
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

    </div>
  );
}
