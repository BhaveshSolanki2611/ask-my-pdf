import type { StoredDocument } from "@/lib/types";

export const CURRENT_INGESTION_VERSION = 4;

export function getDocumentIngestionVersion(
  parserMeta: Record<string, unknown> | null,
): number | null {
  const version = parserMeta?.ingestionVersion;
  return typeof version === "number" ? version : null;
}

export function needsDocumentReingestion(document: StoredDocument): boolean {
  return (
    document.status === "ready" &&
    getDocumentIngestionVersion(document.parserMeta) !==
      CURRENT_INGESTION_VERSION
  );
}
