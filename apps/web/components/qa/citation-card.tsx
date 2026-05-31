interface CitationCardProps {
  index: number;
  title: string;
  excerpt: string;
  noteId: string;
  source?: string;
  sourceType?: "knowledge" | "web";
  url?: string;
  fetchedAt?: string;
  onOpenNote?: (noteId: string) => void;
  tone?: "high" | "low" | "unknown";
}

export function CitationCard({
  index,
  title,
  excerpt,
  noteId,
  source,
  sourceType = "knowledge",
  url,
  fetchedAt,
  onOpenNote,
  tone = "unknown",
}: CitationCardProps) {
  const toneClass =
    tone === "high"
      ? "border-emerald-200 bg-emerald-50/70"
      : tone === "low"
        ? "border-amber-200 bg-amber-50/70"
        : "border-[--border-light] bg-[#F7F4EE]";
  const handleClick = () => {
    if (sourceType === "web" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    onOpenNote?.(noteId);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] text-[--text-secondary] transition hover:border-[--innex-accent] hover:bg-[--innex-accent-dim] hover:text-[--ink] ${toneClass}`}
    >
      <span className="font-mono text-[10px] text-[--innex-accent]">{index}.</span>
      <span className="max-w-[220px] truncate font-medium text-[--ink]">{title}</span>
      {source ? <span className="shrink-0 text-[10px] text-[--text-muted]">{source}</span> : null}
      {sourceType === "web" && fetchedAt ? (
        <span className="shrink-0 text-[10px] text-[--text-muted]">
          {new Date(fetchedAt).toLocaleDateString("zh-CN")}
        </span>
      ) : null}
      <span className="shrink-0 text-[10px] text-[--text-muted]">{sourceType === "web" ? "打开网页" : "打开笔记"}</span>
    </button>
  );
}
