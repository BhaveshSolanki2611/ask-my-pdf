import type { RuntimeCapabilities, RuntimeReadiness } from "@/lib/types";

export function RuntimeCapabilityBanner({
  capabilities,
  compact = false,
  readiness,
}: {
  capabilities: RuntimeCapabilities;
  compact?: boolean;
  readiness: RuntimeReadiness;
}) {
  const parserMessage =
    capabilities.parser === "llamaparse"
      ? "OCR-aware parsing is active for both text PDFs and scanned PDFs."
      : "Text PDFs work in local mode. Scanned PDFs need LLAMA_CLOUD_API_KEY for OCR parsing.";
  const aiMessage =
    capabilities.ai === "hosted-model"
      ? "Hosted grounded answer generation is active."
      : "Answers are using the local fallback responder. AI Gateway credentials will improve answer quality.";
  const readinessTone =
    readiness.status === "ready"
      ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
      : "border-amber-200 bg-amber-50/80 text-amber-900";

  return (
    <div className="rounded-[1.25rem] border border-[color:var(--line)] bg-white/70 px-4 py-3 text-sm leading-7 text-[color:var(--muted)]">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text)]">
        Runtime Mode
      </div>
      <div className={compact ? "mt-2" : "mt-3"}>{parserMessage}</div>
      <div className="mt-1">{aiMessage}</div>
      <div className={`mt-3 rounded-[1rem] border px-3 py-2 text-sm leading-6 ${readinessTone}`}>
        <div className="font-medium">{readiness.summary}</div>
        <div className="mt-1">{readiness.detail}</div>
        {readiness.missingEnvVars.length ? (
          <div className="mt-1 font-mono text-xs">
            Missing: {readiness.missingEnvVars.join(", ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
