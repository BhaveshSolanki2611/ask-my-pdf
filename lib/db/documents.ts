import { getDb } from "@/lib/db/client";
import { ensureDatabaseSchema } from "@/lib/db/ensure-schema";
import {
  createLocalDocument,
  getLocalChunkCount,
  getLocalDocumentById,
  markLocalDocumentFailed,
  replaceLocalChunks,
  searchLocalChunks,
  setLocalDocumentParsedData,
  setLocalDocumentStatus,
  updateLocalDocument,
} from "@/lib/db/local-store";
import { getRuntimeCapabilities, isDatabaseConfigured } from "@/lib/env";
import {
  diversifyRetrievedChunks,
  rerankRetrievedChunks,
} from "@/lib/documents/retrieval-ranking";
import { needsDocumentReingestion } from "@/lib/documents/version";
import type {
  ChunkDraft,
  DocumentStatus,
  OutlineEntry,
  PublicDocument,
  SourceReference,
  StoredChunk,
  StoredDocument,
} from "@/lib/types";
import {
  formatPageLabel,
  formatSectionLabel,
  summarizeError,
  toIsoString,
  toPgVector,
  dedupeStrings,
} from "@/lib/utils";

type DocumentRow = {
  id: string;
  filename: string;
  status: DocumentStatus;
  pageCount: number | null;
  outline: OutlineEntry[];
  parserMeta: Record<string, unknown> | null;
  blobPath: string;
  blobUrl: string | null;
  workflowRunId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapDocumentRow(row: Record<string, unknown>): StoredDocument {
  const mapped = row as unknown as DocumentRow;

  return {
    id: mapped.id,
    filename: mapped.filename,
    status: mapped.status,
    pageCount: mapped.pageCount,
    outline: mapped.outline ?? [],
    parserMeta: mapped.parserMeta ?? null,
    blobPath: mapped.blobPath,
    blobUrl: mapped.blobUrl,
    workflowRunId: mapped.workflowRunId,
    errorMessage: mapped.errorMessage,
    createdAt: toIsoString(mapped.createdAt),
    updatedAt: toIsoString(mapped.updatedAt),
  };
}

function mapChunkRow(row: Record<string, unknown>): StoredChunk {
  return {
    id: String(row.id),
    documentId: String(row.documentId),
    sourceId: String(row.sourceId),
    pageFrom: Number(row.pageFrom),
    pageTo: Number(row.pageTo),
    sectionPath: Array.isArray(row.sectionPath)
      ? row.sectionPath.map(String)
      : [],
    chunkType: String(row.chunkType) as StoredChunk["chunkType"],
    text: String(row.text),
    vectorScore:
      row.vectorScore === null || row.vectorScore === undefined
        ? undefined
        : Number(row.vectorScore),
    keywordScore:
      row.keywordScore === null || row.keywordScore === undefined
        ? undefined
        : Number(row.keywordScore),
    score:
      row.score === null || row.score === undefined
        ? undefined
        : Number(row.score),
  };
}

export async function createDocumentRecord(input: {
  id: string;
  filename: string;
  blobPath: string;
  blobUrl: string | null;
}): Promise<StoredDocument> {
  if (!isDatabaseConfigured()) {
    return createLocalDocument(input);
  }

  await ensureDatabaseSchema();

  const db = getDb();
  const result = await db.query(
    `
      INSERT INTO documents (
        id,
        filename,
        status,
        blob_path,
        blob_url,
        outline_json
      )
      VALUES ($1, $2, 'uploaded', $3, $4, '[]'::jsonb)
      RETURNING
        id,
        filename,
        status,
        page_count AS "pageCount",
        outline_json AS outline,
        parser_meta AS "parserMeta",
        blob_path AS "blobPath",
        blob_url AS "blobUrl",
        workflow_run_id AS "workflowRunId",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [input.id, input.filename, input.blobPath, input.blobUrl],
  );

  return mapDocumentRow(result.rows[0]);
}

export async function setDocumentWorkflowRunId(
  documentId: string,
  workflowRunId: string,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    await updateLocalDocument(documentId, (document) => {
      document.workflowRunId = workflowRunId;
    });
    return;
  }

  await ensureDatabaseSchema();
  await getDb().query(
    `
      UPDATE documents
      SET workflow_run_id = $2,
          updated_at = NOW()
      WHERE id = $1
    `,
    [documentId, workflowRunId],
  );
}

export async function updateDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  errorMessage?: string | null,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    await setLocalDocumentStatus(documentId, status, errorMessage);
    return;
  }

  await ensureDatabaseSchema();
  await getDb().query(
    `
      UPDATE documents
      SET status = $2,
          error_message = $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [documentId, status, errorMessage ?? null],
  );
}

export async function updateDocumentParsedData(input: {
  documentId: string;
  pageCount: number;
  outline: OutlineEntry[];
  parserMeta: Record<string, unknown>;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    await setLocalDocumentParsedData(input);
    return;
  }

  await ensureDatabaseSchema();
  await getDb().query(
    `
      UPDATE documents
      SET page_count = $2,
          outline_json = $3::jsonb,
          parser_meta = $4::jsonb,
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      input.documentId,
      input.pageCount,
      JSON.stringify(input.outline),
      JSON.stringify(input.parserMeta),
    ],
  );
}

export async function replaceDocumentChunks(
  documentId: string,
  chunks: Array<ChunkDraft & { id: string; embedding: number[] }>,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    await replaceLocalChunks(documentId, chunks);
    return;
  }

  await ensureDatabaseSchema();

  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM document_chunks WHERE document_id = $1", [
      documentId,
    ]);

    for (const chunk of chunks) {
      const searchableText = `${chunk.sectionPath.join(" ")} ${chunk.text}`.trim();

      await client.query(
        `
          INSERT INTO document_chunks (
            id,
            document_id,
            source_id,
            page_from,
            page_to,
            section_path,
            chunk_type,
            text,
            fts,
            embedding
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            to_tsvector('english', $9),
            $10::vector
          )
        `,
        [
          chunk.id,
          documentId,
          chunk.sourceId,
          chunk.pageFrom,
          chunk.pageTo,
          chunk.sectionPath,
          chunk.chunkType,
          chunk.text,
          searchableText,
          toPgVector(chunk.embedding),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markDocumentReady(documentId: string): Promise<void> {
  await updateDocumentStatus(documentId, "ready", null);
}

export async function markDocumentFailed(
  documentId: string,
  error: unknown,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    await markLocalDocumentFailed(documentId, error);
    return;
  }

  await updateDocumentStatus(documentId, "failed", summarizeError(error));
}

export async function getDocumentById(
  documentId: string,
): Promise<StoredDocument | null> {
  if (!isDatabaseConfigured()) {
    return getLocalDocumentById(documentId);
  }

  await ensureDatabaseSchema();
  const result = await getDb().query(
    `
      SELECT
        id,
        filename,
        status,
        page_count AS "pageCount",
        outline_json AS outline,
        parser_meta AS "parserMeta",
        blob_path AS "blobPath",
        blob_url AS "blobUrl",
        workflow_run_id AS "workflowRunId",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM documents
      WHERE id = $1
    `,
    [documentId],
  );

  if (!result.rowCount) {
    return null;
  }

  return mapDocumentRow(result.rows[0]);
}

export async function getPublicDocument(
  documentId: string,
): Promise<PublicDocument | null> {
  const document = await getDocumentById(documentId);

  if (!document) {
    return null;
  }

  return {
    ...document,
    sourceUrl: `/api/documents/${documentId}/source`,
    needsReingestion: needsDocumentReingestion(document),
    chunkCount: await getDocumentChunkCount(documentId),
    capabilities: getRuntimeCapabilities(),
  };
}

export async function searchDocumentChunks(input: {
  documentId: string;
  question: string;
  embedding: number[];
  limit?: number;
}): Promise<StoredChunk[]> {
  if (!isDatabaseConfigured()) {
    return searchLocalChunks({
      documentId: input.documentId,
      question: input.question,
      embedding: input.embedding,
      limit: input.limit ?? 8,
    });
  }

  await ensureDatabaseSchema();

  const limit = input.limit ?? 8;
  const db = getDb();
  const result = await db.query(
    `
      WITH query_input AS (
        SELECT
          $1::vector AS query_embedding,
          websearch_to_tsquery('english', $2) AS query_text
      ),
      vector_matches AS (
        SELECT
          id,
          document_id AS "documentId",
          source_id AS "sourceId",
          page_from AS "pageFrom",
          page_to AS "pageTo",
          section_path AS "sectionPath",
          chunk_type AS "chunkType",
          text,
          GREATEST(0, 1 - (embedding <=> (SELECT query_embedding FROM query_input))) AS "vectorScore",
          0::float AS "keywordScore"
        FROM document_chunks
        WHERE document_id = $3
        ORDER BY embedding <=> (SELECT query_embedding FROM query_input)
        LIMIT 24
      ),
      keyword_matches AS (
        SELECT
          id,
          document_id AS "documentId",
          source_id AS "sourceId",
          page_from AS "pageFrom",
          page_to AS "pageTo",
          section_path AS "sectionPath",
          chunk_type AS "chunkType",
          text,
          0::float AS "vectorScore",
          ts_rank_cd(fts, (SELECT query_text FROM query_input)) AS "keywordScore"
        FROM document_chunks
        WHERE document_id = $3
          AND fts @@ (SELECT query_text FROM query_input)
        ORDER BY "keywordScore" DESC
        LIMIT 24
      )
      SELECT
        id,
        "documentId",
        "sourceId",
        "pageFrom",
        "pageTo",
        "sectionPath",
        "chunkType",
        text,
        MAX("vectorScore") AS "vectorScore",
        MAX("keywordScore") AS "keywordScore",
        MAX("vectorScore") * 0.72 + MAX("keywordScore") * 0.28 AS score
      FROM (
        SELECT * FROM vector_matches
        UNION ALL
        SELECT * FROM keyword_matches
      ) merged
      GROUP BY
        id,
        "documentId",
        "sourceId",
        "pageFrom",
        "pageTo",
        "sectionPath",
        "chunkType",
        text
      ORDER BY score DESC
      LIMIT 32
    `,
    [toPgVector(input.embedding), input.question, input.documentId],
  );

  return diversifyChunks(
    rerankRetrievedChunks(result.rows.map(mapChunkRow), input.question),
    limit,
  );
}

export async function getDocumentChunkCount(documentId: string): Promise<number> {
  if (!isDatabaseConfigured()) {
    return getLocalChunkCount(documentId);
  }

  await ensureDatabaseSchema();
  const result = await getDb().query(
    `
      SELECT COUNT(*)::int AS count
      FROM document_chunks
      WHERE document_id = $1
    `,
    [documentId],
  );

  return Number(result.rows[0]?.count ?? 0);
}

function diversifyChunks(chunks: StoredChunk[], limit: number): StoredChunk[] {
  return diversifyRetrievedChunks(chunks, limit);
}

export function resolveSourcesFromChunks(
  chunks: Array<StoredChunk & { label: string }>,
  usedSourceIds: string[],
): SourceReference[] {
  return usedSourceIds
    .map((sourceId) => chunks.find((chunk) => chunk.label === sourceId))
    .filter((chunk): chunk is StoredChunk & { label: string } => Boolean(chunk))
    .map((chunk) => ({
      id: chunk.label,
      pageLabel: formatPageLabel(chunk.pageFrom, chunk.pageTo),
      sectionLabel: formatSectionLabel(chunk.sectionPath),
      chunkType: chunk.chunkType,
    }));
}
