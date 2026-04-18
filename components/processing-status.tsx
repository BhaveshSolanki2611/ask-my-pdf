import type { DocumentStatus } from "@/lib/types";
import { cn, statusLabel } from "@/lib/utils";

const stages: DocumentStatus[] = [
  "uploaded",
  "parsing",
  "chunking",
  "embedding",
  "ready",
];

export function ProcessingStatus({
  status,
  errorMessage,
  pageCount,
  chunkCount,
  needsReingestion,
}: {
  status: DocumentStatus;
  errorMessage?: string | null;
  pageCount: number | null;
  chunkCount?: number | null;
  needsReingestion?: boolean;
}) {
  const activeIndex =
    status === "failed" ? stages.length - 1 : stages.indexOf(status);

  return (
    <section className="soft-panel rounded-[1.5rem] p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
            Processing Status
          </p>
          <h2 className="mt-2 text-xl font-semibold">{statusLabel(status)}</h2>
        </div>
        <div className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
          {pageCount
            ? `${pageCount} pages${chunkCount ? ` · ${chunkCount} chunks` : ""}`
            : "Awaiting parse"}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-5">
        {stages.map((stage, index) => {
          const isActive = status === stage;
          const isComplete = activeIndex > index || status === "ready";

          return (
            <div
              key={stage}
              className={cn(
                "rounded-[1.1rem] border p-3 text-sm transition",
                isActive
                  ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                  : "border-[color:var(--line)] bg-white/60",
                isComplete && "text-[color:var(--success)]",
              )}
            >
              <div className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                Step {index + 1}
              </div>
              <div className="mt-2 font-medium text-[color:var(--text)]">
                {statusLabel(stage)}
              </div>
            </div>
          );
        })}
      </div>

      {status === "failed" && errorMessage ? (
        <div className="mt-5 rounded-[1.1rem] border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {needsReingestion ? (
        <div className="mt-5 rounded-[1.1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-800">
          This document was ingested with an older local parser. The workspace will refresh it automatically before answering.
        </div>
      ) : null}
    </section>
  );
}
