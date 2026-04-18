import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-10">
      <div className="glass-panel rounded-[2rem] p-10 text-center">
        <p className="text-sm uppercase tracking-[0.16em] text-[color:var(--muted)]">
          Not Found
        </p>
        <h1 className="mt-3 text-3xl font-semibold">This document workspace does not exist.</h1>
        <p className="mt-4 text-sm leading-7 text-[color:var(--muted)]">
          Upload a new PDF to create a fresh support copilot workspace.
        </p>
        <Link
          className="mt-6 inline-flex rounded-full bg-[color:var(--text)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent)]"
          href="/"
        >
          Return Home
        </Link>
      </div>
    </main>
  );
}
