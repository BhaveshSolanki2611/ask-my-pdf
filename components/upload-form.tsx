"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import type { RuntimeCapabilities, RuntimeReadiness } from "@/lib/types";

type UploadResponse = {
  documentId: string;
  redirectTo: string;
};

export function UploadForm({
  capabilities,
  readiness,
}: {
  capabilities: RuntimeCapabilities;
  readiness: RuntimeReadiness;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!readiness.uploadsEnabled) {
      setError(readiness.summary);
      return;
    }

    if (!file) {
      setError("Choose a PDF file before uploading.");
      return;
    }

    setError(null);
    setIsUploading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    const request = new XMLHttpRequest();
    request.open("POST", "/api/documents");
    request.responseType = "json";

    request.upload.onprogress = (progressEvent) => {
      if (!progressEvent.lengthComputable) {
        return;
      }

      setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
    };

    request.onerror = () => {
      setIsUploading(false);
      setError("The upload failed before the server could process the PDF.");
    };

    request.onload = () => {
      setIsUploading(false);

      if (request.status < 200 || request.status >= 300) {
        const message =
          request.response?.error ??
          "The server could not accept this PDF. Please try again.";
        setError(message);
        return;
      }

      const data = request.response as UploadResponse;

      startTransition(() => {
        router.push(data.redirectTo as Route);
      });
    };

    request.send(formData);
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <label className="flex cursor-pointer flex-col gap-3 rounded-[1.5rem] border border-dashed border-[color:var(--line)] bg-white/50 p-5 transition hover:border-[color:var(--accent)]">
        <span className="text-sm font-medium text-[color:var(--muted)]">
          Choose a PDF
        </span>
        <input
          accept="application/pdf,.pdf"
          className="block w-full text-sm text-[color:var(--muted)] file:mr-4 file:rounded-full file:border-0 file:bg-[color:var(--accent-soft)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[color:var(--accent)]"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
          type="file"
        />
        <span className="text-xs leading-6 text-[color:var(--muted)]">
          {capabilities.parser === "llamaparse"
            ? "Supports text PDFs and scanned PDFs with OCR. Maximum size: 50 MB."
            : "Supports text PDFs locally. Scanned PDFs need LLAMA_CLOUD_API_KEY for OCR parsing. Maximum size: 50 MB."}
        </span>
      </label>

      {file ? (
        <div className="soft-panel rounded-[1.25rem] p-4 text-sm text-[color:var(--muted)]">
          <div className="font-medium text-[color:var(--text)]">{file.name}</div>
          <div className="mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
        </div>
      ) : null}

      {isUploading ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">
            <span>Uploading</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/70">
            <div
              className="h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!readiness.uploadsEnabled ? (
        <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-800">
          {readiness.detail}
        </div>
      ) : null}

      <button
        className="inline-flex w-full items-center justify-center rounded-full bg-[color:var(--text)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!file || isUploading || !readiness.uploadsEnabled}
        type="submit"
      >
        {isUploading
          ? "Uploading PDF..."
          : readiness.uploadsEnabled
            ? "Build Document Copilot"
            : "Configure Production Storage First"}
      </button>
    </form>
  );
}
