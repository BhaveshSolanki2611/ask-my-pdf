import { describe, expect, it } from "vitest";
import { CURRENT_INGESTION_VERSION, needsDocumentReingestion } from "@/lib/documents/version";
import type { StoredDocument } from "@/lib/types";

function makeDocument(
  parserMeta: Record<string, unknown> | null,
): StoredDocument {
  return {
    id: "doc-1",
    filename: "manual.pdf",
    status: "ready",
    pageCount: 12,
    outline: [],
    parserMeta,
    blobPath: "/tmp/manual.pdf",
    blobUrl: null,
    workflowRunId: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("document ingestion versioning", () => {
  it("flags older local parser documents for reingestion", () => {
    const document = makeDocument({
      provider: "pdf-parse",
      mode: "local-layout-parser",
      ingestionVersion: CURRENT_INGESTION_VERSION - 1,
    });

    expect(needsDocumentReingestion(document)).toBe(true);
  });

  it("does not reingest current-version local documents", () => {
    const document = makeDocument({
      provider: "pdf-parse",
      mode: "local-layout-parser",
      ingestionVersion: CURRENT_INGESTION_VERSION,
    });

    expect(needsDocumentReingestion(document)).toBe(false);
  });

  it("does not reingest hosted-parser documents", () => {
    const document = makeDocument({
      provider: "llamaparse",
      ingestionVersion: CURRENT_INGESTION_VERSION - 1,
    });

    expect(needsDocumentReingestion(document)).toBe(false);
  });
});
