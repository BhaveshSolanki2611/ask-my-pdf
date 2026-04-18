import { embedChunks } from "@/lib/ai/embeddings";
import {
  markDocumentReady,
  replaceDocumentChunks,
  updateDocumentParsedData,
  updateDocumentStatus,
} from "@/lib/db/documents";
import { buildDocumentMap } from "@/lib/documents/chunking";
import { CURRENT_INGESTION_VERSION } from "@/lib/documents/version";
import { getServerEnv } from "@/lib/env";
import { parsePdfWithLlamaCloud } from "@/lib/llama/parse";
import { downloadDocumentSourceBuffer } from "@/lib/storage";
import type { IngestionWorkflowInput } from "@/lib/types";

export async function performDocumentIngestion(input: IngestionWorkflowInput) {
  const env = getServerEnv();

  await updateDocumentStatus(input.documentId, "parsing");

  const pdfBuffer = await downloadDocumentSourceBuffer(input.blobPath);
  const parsed = await parsePdfWithLlamaCloud(pdfBuffer, input.filename);
  const documentMap = buildDocumentMap(parsed, env.CHUNK_TARGET_TOKENS);

  await updateDocumentParsedData({
    documentId: input.documentId,
    pageCount: parsed.pageCount,
    outline: documentMap.outline,
    parserMeta: {
      ...parsed.parserMeta,
      contentFormat: parsed.contentFormat,
      chunkCount: documentMap.chunks.length,
      ingestionVersion: CURRENT_INGESTION_VERSION,
    },
  });

  await updateDocumentStatus(input.documentId, "chunking");
  await updateDocumentStatus(input.documentId, "embedding");

  const embeddings = await embedChunks(documentMap.chunks.map((chunk) => chunk.text));

  await replaceDocumentChunks(
    input.documentId,
    documentMap.chunks.map((chunk, index) => ({
      ...chunk,
      id: `${input.documentId}-chunk-${String(index + 1).padStart(4, "0")}`,
      embedding: embeddings[index],
    })),
  );

  await markDocumentReady(input.documentId);

  return {
    documentId: input.documentId,
    pageCount: parsed.pageCount,
    chunkCount: documentMap.chunks.length,
  };
}
