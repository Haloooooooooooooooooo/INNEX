export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-black/5 text-[--text-secondary]">
      {tag}
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-muted-foreground hover:text-red-500 ml-0.5"
        >
          ×
        </button>
      )}
    </span>
  );
}
