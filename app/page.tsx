import { RuntimeCapabilityBanner } from "@/components/runtime-capability-banner";
import { UploadForm } from "@/components/upload-form";
import { getRuntimeCapabilities, getRuntimeReadiness } from "@/lib/env";

const buildSteps = [
  "Upload one PDF and store the original in private blob storage.",
  "Parse the document with OCR-aware extraction, build an outline, then section-first chunk the content.",
  "Embed each chunk, run hybrid retrieval, and answer with explicit source references only.",
];

export const dynamic = "force-dynamic";

export default function HomePage() {
  const capabilities = getRuntimeCapabilities();
  const readiness = getRuntimeReadiness();

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-10 px-6 py-8 lg:px-10">
      <section className="grid gap-6 lg:grid-cols-[1.25fr_0.9fr]">
        <div className="glass-panel rounded-[2rem] p-8 lg:p-10">
          <p className="mb-4 text-sm uppercase tracking-[0.24em] text-[color:var(--muted)]">
            Next.js PDF Support Copilot
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-[color:var(--text)] md:text-6xl">
            Ground customer replies in the exact content of any uploaded PDF.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-[color:var(--muted)] md:text-lg">
            This app builds a section-aware understanding of each PDF, including
            scanned pages, tables, warnings, and procedures, then drafts precise
            answers using retrieval only.
          </p>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {buildSteps.map((step, index) => (
              <div
                key={step}
                className="soft-panel rounded-[1.4rem] p-4 text-sm leading-7 text-[color:var(--muted)]"
              >
                <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--accent-soft)] text-sm font-semibold text-[color:var(--accent)]">
                  0{index + 1}
                </div>
                {step}
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-[2rem] p-8">
          <div className="mb-6">
            <p className="text-sm uppercase tracking-[0.2em] text-[color:var(--muted)]">
              Upload
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Start with a PDF</h2>
            <p className="mt-3 text-sm leading-7 text-[color:var(--muted)]">
              The MVP accepts one PDF at a time, supports OCR-backed parsing, and
              keeps answers strictly grounded in the uploaded document.
            </p>
          </div>
          <div className="space-y-5">
            <RuntimeCapabilityBanner
              capabilities={capabilities}
              compact
              readiness={readiness}
            />
            <UploadForm capabilities={capabilities} readiness={readiness} />
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <article className="soft-panel rounded-[1.6rem] p-6">
          <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
            Retrieval Rules
          </p>
          <p className="mt-3 text-sm leading-7 text-[color:var(--muted)]">
            Hybrid retrieval combines vector similarity and full-text search, then
            diversifies results across pages and sections before the model sees them.
          </p>
        </article>
        <article className="soft-panel rounded-[1.6rem] p-6">
          <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
            Prompt Contract
          </p>
          <p className="mt-3 text-sm leading-7 text-[color:var(--muted)]">
            The answer model can cite only source IDs like <span className="font-mono">[S1]</span>, and
            the backend resolves those to page and section labels in the UI.
          </p>
        </article>
        <article className="soft-panel rounded-[1.6rem] p-6">
          <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
            Output Modes
          </p>
          <p className="mt-3 text-sm leading-7 text-[color:var(--muted)]">
            Switch between direct grounded answers and polished support drafts without
            letting the model invent anything beyond the retrieved excerpts.
          </p>
        </article>
      </section>
    </main>
  );
}
