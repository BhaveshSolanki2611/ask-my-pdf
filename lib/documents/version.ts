import type { StoredDocument } from "@/lib/types";

export const CURRENT_INGESTION_VERSION = 3;

export function getDocumentIngestionVersion(
  parserMeta: Record<string, unknown> | null,
): number | null {
  const version = parserMeta?.ingestionVersion;
  return typeof version === "number" ? version : null;
}

export function isLocalParserMeta(
  parserMeta: Record<string, unknown> | null,
): boolean {
  if (!parserMeta) {
    return false;
  }

  return (
    parserMeta.provider === "pdf-parse" ||
    parserMeta.mode === "local-layout-parser" ||
    parserMeta.mode === "local-text-parser"
  );
}

export function needsDocumentReingestion(document: StoredDocument): boolean {
  return (
    document.status === "ready" &&
    isLocalParserMeta(document.parserMeta) &&
    getDocumentIngestionVersion(document.parserMeta) !==
      CURRENT_INGESTION_VERSION
  );
}
