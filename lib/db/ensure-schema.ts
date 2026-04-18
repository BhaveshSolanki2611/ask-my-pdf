import { getDb } from "@/lib/db/client";
import { getServerEnv, isDatabaseConfigured } from "@/lib/env";

let schemaPromise: Promise<void> | null = null;

export async function ensureDatabaseSchema(): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  if (schemaPromise) {
    return schemaPromise;
  }

  schemaPromise = (async () => {
    const db = getDb();
    const { VECTOR_DIMENSIONS } = getServerEnv();

    await db.query("CREATE EXTENSION IF NOT EXISTS vector");

    await db.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        status TEXT NOT NULL,
        page_count INTEGER,
        outline_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        parser_meta JSONB,
        blob_path TEXT NOT NULL,
        blob_url TEXT,
        workflow_run_id TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        page_from INTEGER NOT NULL,
        page_to INTEGER NOT NULL,
        section_path TEXT[] NOT NULL DEFAULT '{}'::text[],
        chunk_type TEXT NOT NULL,
        text TEXT NOT NULL,
        fts TSVECTOR NOT NULL,
        embedding VECTOR(${VECTOR_DIMENSIONS}) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(
      "CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)",
    );
    await db.query(
      "CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id)",
    );
    await db.query(
      "CREATE INDEX IF NOT EXISTS idx_document_chunks_fts ON document_chunks USING GIN(fts)",
    );
  })();

  return schemaPromise;
}
