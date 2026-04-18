import type { OutlineEntry } from "@/lib/types";
import { formatPageLabel } from "@/lib/utils";

export function OutlineSidebar({
  filename,
  outline,
  sourceUrl,
  isReady,
  chunkCount,
}: {
  filename: string;
  outline: OutlineEntry[];
  sourceUrl: string;
  isReady: boolean;
  chunkCount?: number | null;
}) {
  return (
    <aside className="soft-panel flex h-full flex-col rounded-[1.5rem] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
            Document Map
          </p>
          <h2 className="mt-2 text-lg font-semibold">{filename}</h2>
          {chunkCount ? (
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">
              {chunkCount} retrieval chunks
            </p>
          ) : null}
        </div>
        <a
          className="rounded-full border border-[color:var(--line)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          href={sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open PDF
        </a>
      </div>

      <div className="mt-5 space-y-3 overflow-y-auto pr-1">
        {!outline.length ? (
          <div className="rounded-[1.2rem] border border-dashed border-[color:var(--line)] bg-white/60 p-4 text-sm leading-7 text-[color:var(--muted)]">
            {isReady
              ? "The parser did not extract headings, so answers will rely on chunked page content."
              : "The outline will appear here once parsing finishes."}
          </div>
        ) : (
          outline.map((entry) => (
            <div
              key={entry.id}
              className="rounded-[1rem] border border-[color:var(--line)] bg-white/60 px-4 py-3"
              style={{ marginLeft: `${Math.max(entry.level - 1, 0) * 12}px` }}
            >
              <div className="font-medium text-[color:var(--text)]">{entry.title}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.12em] text-[color:var(--muted)]">
                {formatPageLabel(entry.pageStart, entry.pageEnd)}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
