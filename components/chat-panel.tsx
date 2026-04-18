import type { ChatMode, ChatResult, DocumentStatus } from "@/lib/types";
import { chunkTypeLabel } from "@/lib/utils";

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: ChatMode;
  result?: ChatResult;
};

export function ChatPanel({
  documentStatus,
  error,
  isSending,
  messages,
  mode,
  onModeChange,
  onQuestionChange,
  onSubmit,
  question,
}: {
  documentStatus: DocumentStatus;
  error: string | null;
  isSending: boolean;
  messages: ChatTurn[];
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  question: string;
}) {
  const disabled = documentStatus !== "ready" || isSending;

  return (
    <section className="glass-panel flex min-h-[720px] flex-col rounded-[1.7rem] p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--line)] pb-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
            Support Drafting
          </p>
          <h2 className="mt-2 text-xl font-semibold">Ask grounded questions</h2>
        </div>

        <div className="inline-flex rounded-full border border-[color:var(--line)] bg-white/70 p-1">
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              mode === "answer"
                ? "bg-[color:var(--text)] text-white"
                : "text-[color:var(--muted)]"
            }`}
            onClick={() => onModeChange("answer")}
            type="button"
          >
            Answer from PDF
          </button>
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              mode === "draft"
                ? "bg-[color:var(--text)] text-white"
                : "text-[color:var(--muted)]"
            }`}
            onClick={() => onModeChange("draft")}
            type="button"
          >
            Draft support reply
          </button>
        </div>
      </div>

      <div className="mt-5 flex-1 space-y-4 overflow-y-auto pr-1">
        {!messages.length ? (
          <div className="soft-panel rounded-[1.4rem] p-5 text-sm leading-7 text-[color:var(--muted)]">
            Ask about policy details, procedures, warnings, measurements, or request a polished reply draft. The model will answer only from retrieved PDF sections and will say when the document is missing something.
          </div>
        ) : null}

        {messages.map((message) => {
          const isAssistant = message.role === "assistant";

          return (
            <article
              key={message.id}
              className={`rounded-[1.5rem] p-5 ${
                isAssistant
                  ? "soft-panel"
                  : "bg-[color:var(--text)] text-white shadow-[0_18px_40px_rgba(36,25,13,0.18)]"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-xs uppercase tracking-[0.18em] opacity-70">
                  {isAssistant
                    ? message.result?.type === "clarification"
                      ? "Clarifying Question"
                      : "Grounded Answer"
                    : "User Query"}
                </div>
                {message.mode ? (
                  <div className="text-xs uppercase tracking-[0.16em] opacity-70">
                    {message.mode === "draft" ? "Draft Mode" : "Answer Mode"}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 whitespace-pre-wrap text-sm leading-7">
                {isAssistant && message.result?.type === "clarification"
                  ? message.result.clarifyingQuestion
                  : message.content}
              </div>

              {isAssistant && message.result?.sources.length ? (
                <div className="mt-5 rounded-[1.2rem] border border-[color:var(--line)] bg-white/70 p-4 text-sm text-[color:var(--muted)]">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text)]">
                    Sources
                  </div>
                  <div className="mt-3 grid gap-3">
                    {message.result.sources.map((source) => (
                      <div
                        key={source.id}
                        className="rounded-[1rem] border border-[color:var(--line)] bg-white px-4 py-3"
                      >
                        <div className="font-mono text-xs font-semibold text-[color:var(--accent)]">
                          {source.id}
                        </div>
                        <div className="mt-1 font-medium text-[color:var(--text)]">
                          {source.sectionLabel}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.12em]">
                          {source.pageLabel} · {chunkTypeLabel(source.chunkType)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {isAssistant && message.result?.missing.length ? (
                <div className="mt-4 rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em]">
                    Missing from PDF
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {message.result.missing.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <form className="mt-5 space-y-4 border-t border-[color:var(--line)] pt-4" onSubmit={onSubmit}>
        <textarea
          className="min-h-28 w-full rounded-[1.4rem] border border-[color:var(--line)] bg-white/75 px-4 py-3 text-sm leading-7 text-[color:var(--text)] outline-none transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)]"
          disabled={disabled}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder={
            documentStatus === "ready"
              ? "Paste a support question or ask for a drafted response grounded in the PDF."
              : "Wait for the PDF to finish processing before asking questions."
          }
          value={question}
        />

        {error ? (
          <div className="rounded-[1.2rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
            {documentStatus === "ready"
              ? "Citations are resolved after the model responds."
              : "Processing status controls when chat becomes available."}
          </p>
          <button
            className="inline-flex items-center justify-center rounded-full bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || !question.trim()}
            type="submit"
          >
            {isSending ? "Drafting..." : "Ask Copilot"}
          </button>
        </div>
      </form>
    </section>
  );
}
