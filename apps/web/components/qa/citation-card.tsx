interface CitationCardProps {
  index: number;
  title: string;
  excerpt: string;
  noteId: string;
}

export function CitationCard({ index, title, excerpt }: CitationCardProps) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-[--paper] rounded-md text-xs">
      <span className="font-mono text-[--innex-accent] font-semibold shrink-0 mt-px">
        [{index}]
      </span>
      <div className="min-w-0">
        <span className="font-medium text-[--ink]">{title}</span>
        <span className="text-muted-foreground ml-1.5 line-clamp-1">{excerpt}</span>
      </div>
    </div>
  );
}
