interface CitationCardProps {
  index: number;
  title: string;
  excerpt: string;
  noteId: string;
  source?: string;
  onOpenNote?: (noteId: string) => void;
}

export function CitationCard({ index, title, excerpt, noteId, source, onOpenNote }: CitationCardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpenNote?.(noteId)}
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-[--border-light] bg-[#F7F4EE] px-2.5 py-1 text-[11px] text-[--text-secondary] transition hover:border-[--innex-accent] hover:bg-[--innex-accent-dim] hover:text-[--ink]"
      title={excerpt}
    >
      <span className="font-mono text-[10px] text-[--text-muted]">{index}.</span>
      <span className="truncate font-medium text-[--ink]">{title}</span>
      {source ? <span className="shrink-0 text-[10px] text-[--text-muted]">{source}</span> : null}
    </button>
  );
}
