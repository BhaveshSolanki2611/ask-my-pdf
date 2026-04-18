import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cwd } from "node:process";
import { Readable } from "node:stream";
import { get, put } from "@vercel/blob";
import {
  canUseLocalPersistence,
  isBlobStorageConfigured,
} from "@/lib/env";
import type {
  ChunkDraft,
  DocumentStatus,
  OutlineEntry,
  StoredChunk,
  StoredDocument,
} from "@/lib/types";
import {
  diversifyRetrievedChunks,
  rerankRetrievedChunks,
} from "@/lib/documents/retrieval-ranking";
import { dedupeStrings, summarizeError, tokenizeForSearch } from "@/lib/utils";

type PersistedChunk = StoredChunk & {
  embedding?: number[];
};

type LocalStore = {
  documents: StoredDocument[];
  chunks: PersistedChunk[];
};

const DATA_DIR = join(cwd(), ".local-data");
const STORE_PATH = join(DATA_DIR, "store.json");
const BLOB_STORE_PATH = "documents/internal/store.json";

function createEmptyStore(): LocalStore {
  return {
    documents: [],
    chunks: [],
  };
}

function shouldUseBlobBackedStore(): boolean {
  return !canUseLocalPersistence() && isBlobStorageConfigured();
}

async function ensureFilesystemStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(STORE_PATH, "utf8");
  } catch {
    await writeFile(STORE_PATH, JSON.stringify(createEmptyStore(), null, 2), "utf8");
  }
}

async function readFilesystemStore(): Promise<LocalStore> {
  await ensureFilesystemStore();
  const raw = await readFile(STORE_PATH, "utf8");
  return JSON.parse(raw) as LocalStore;
}

async function writeFilesystemStore(nextStore: LocalStore): Promise<void> {
  await ensureFilesystemStore();
  const tempPath = `${STORE_PATH}.tmp`;
  await writeFile(tempPath, JSON.stringify(nextStore, null, 2), "utf8");
  await rename(tempPath, STORE_PATH);
}

async function readBlobBackedStore(): Promise<LocalStore> {
  try {
    const result = await get(BLOB_STORE_PATH, { access: "private" });

    if (!result || result.statusCode !== 200 || !result.stream) {
      return createEmptyStore();
    }

    const stream =
      result.stream instanceof Readable
        ? (Readable.toWeb(result.stream) as ReadableStream<Uint8Array>)
        : result.stream;
    const raw = await new Response(stream).text();

    if (!raw.trim()) {
      return createEmptyStore();
    }

    return JSON.parse(raw) as LocalStore;
  } catch (error) {
    const message = summarizeError(error);

    if (/404|not found|does not exist/i.test(message)) {
      return createEmptyStore();
    }

    throw error;
  }
}

async function writeBlobBackedStore(nextStore: LocalStore): Promise<void> {
  await put(BLOB_STORE_PATH, JSON.stringify(nextStore, null, 2), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export async function readLocalStore(): Promise<LocalStore> {
  if (shouldUseBlobBackedStore()) {
    return readBlobBackedStore();
  }

  return readFilesystemStore();
}

async function writeLocalStore(nextStore: LocalStore): Promise<void> {
  if (shouldUseBlobBackedStore()) {
    await writeBlobBackedStore(nextStore);
    return;
  }

  await writeFilesystemStore(nextStore);
}

export async function updateLocalStore<T>(
  updater: (store: LocalStore) => T | Promise<T>,
): Promise<T> {
  const store = await readLocalStore();
  const result = await updater(store);
  await writeLocalStore(store);
  return result;
}

export async function createLocalDocument(input: {
  id: string;
  filename: string;
  blobPath: string;
  blobUrl: string | null;
}): Promise<StoredDocument> {
  const now = new Date().toISOString();

  return updateLocalStore((store) => {
    const document: StoredDocument = {
      id: input.id,
      filename: input.filename,
      status: "uploaded",
      pageCount: null,
      outline: [],
      parserMeta: null,
      blobPath: input.blobPath,
      blobUrl: input.blobUrl,
      workflowRunId: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    store.documents.push(document);
    return document;
  });
}

export async function updateLocalDocument(
  documentId: string,
  updater: (document: StoredDocument) => void,
): Promise<void> {
  await updateLocalStore((store) => {
    const document = store.documents.find((item) => item.id === documentId);

    if (!document) {
      throw new Error(`Document ${documentId} was not found in local storage.`);
    }

    updater(document);
    document.updatedAt = new Date().toISOString();
  });
}

export async function getLocalDocumentById(
  documentId: string,
): Promise<StoredDocument | null> {
  const store = await readLocalStore();
  return store.documents.find((item) => item.id === documentId) ?? null;
}

export async function replaceLocalChunks(
  documentId: string,
  chunks: Array<ChunkDraft & { id: string; embedding?: number[] }>,
): Promise<void> {
  await updateLocalStore((store) => {
    store.chunks = store.chunks.filter((chunk) => chunk.documentId !== documentId);
    store.chunks.push(
      ...chunks.map((chunk) => ({
        ...chunk,
        documentId,
      })),
    );
  });
}

export async function getLocalChunkCount(documentId: string): Promise<number> {
  const store = await readLocalStore();
  return store.chunks.filter((chunk) => chunk.documentId === documentId).length;
}

export async function searchLocalChunks(input: {
  documentId: string;
  question: string;
  embedding: number[];
  limit: number;
}): Promise<StoredChunk[]> {
  const store = await readLocalStore();
  const questionTerms = dedupeStrings(tokenizeForSearch(input.question));
  const questionTermSet = new Set(questionTerms);
  const normalizedQuestion = normalizeQuery(input.question);
  const explicitProcedureQuery = /^(how|steps?|procedure|process)\b/i.test(
    input.question,
  );
  const valueQuery =
    /\d/.test(input.question) ||
    questionTerms.some((term) => VALUE_QUERY_TERMS.has(term));
  const procedureQuery =
    explicitProcedureQuery ||
    (!valueQuery && questionTerms.some((term) => PROCEDURE_QUERY_TERMS.has(term)));
  const yesNoQuery = /^(can|is|are|do|does|should|will|would|could|did)\b/i.test(
    normalizedQuestion,
  );
  const toolingQuery = questionTerms.some((term) => TOOLING_QUERY_TERMS.has(term));
  const curingQuery = /\b(cur(?:e|ed|ing)|watering|72 hours|dry out)\b/i.test(
    input.question,
  );
  const compositionQuery = questionTerms.some((term) =>
    COMPOSITION_QUERY_TERMS.has(term),
  );

  const scored = store.chunks
    .filter((chunk) => chunk.documentId === input.documentId)
    .map((chunk) => {
      const haystack = `${chunk.sectionPath.join(" ")} ${chunk.text}`.toLowerCase();
      const chunkTerms = new Set(tokenizeForSearch(haystack));
      const overlapTerms = questionTerms.filter((term) => chunkTerms.has(term));
      const keywordScore =
        overlapTerms.length +
        (questionTerms.length > 0 ? (overlapTerms.length / questionTerms.length) * 2 : 0) +
        (haystack.includes(normalizedQuestion) ? 2 : 0);
      const vectorScore = chunk.embedding
        ? Math.max(0, cosineSimilarity(input.embedding, chunk.embedding))
        : 0;
      const sectionBonus = chunk.sectionPath.some((item) =>
        tokenizeForSearch(item).some((term) => questionTermSet.has(term)),
      )
        ? 1.35
        : 0;
      const procedureBoost = procedureQuery && chunk.chunkType === "procedure" ? 0.85 : 0;
      const procedureContentBoost =
        procedureQuery && /\b(mix|lay|cure|compact|step|water)\b/i.test(haystack)
          ? 0.55
          : 0;
      const valueBoost =
        valueQuery && (chunk.chunkType === "table" || /\d/.test(chunk.text)) ? 0.85 : 0;
      const curingBoost =
        curingQuery &&
        /\b(cur(?:e|ing|ed)|72 hours|daily watering|dry out)\b/i.test(haystack)
          ? 1.05
          : 0;
      const toolingBoost =
        toolingQuery &&
        /\b(tool|rammer|vibrator|bamboo|mechanical|manual)\b/i.test(haystack)
          ? 0.85
          : 0;
      const compositionBoost =
        compositionQuery &&
        /\b(fat lime|ash|sand|aggregate|water|booster|ratio|mix)\b/i.test(haystack)
          ? 0.7
          : 0;
      const toolingFaqPenalty =
        toolingQuery && !yesNoQuery && chunk.chunkType === "faq" ? 0.2 : 0;
      const specificityBoost =
        Math.max(0, 1.2 - Math.max(0, chunk.pageTo - chunk.pageFrom) * 0.25) +
        Math.min(0.9, chunk.sectionPath.length * 0.18);
      const score =
        vectorScore * 3.2 +
        keywordScore * 0.8 +
        sectionBonus +
        procedureBoost +
        procedureContentBoost +
        valueBoost +
        curingBoost +
        toolingBoost +
        compositionBoost +
        specificityBoost;

      return {
        ...chunk,
        score: score - toolingFaqPenalty,
        keywordScore,
        vectorScore,
      };
    })
    .filter((chunk) => (chunk.score ?? 0) > 0.2)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return diversifyLocalChunks(rerankRetrievedChunks(scored, input.question), input.limit);
}

function diversifyLocalChunks(chunks: StoredChunk[], limit: number): StoredChunk[] {
  return diversifyRetrievedChunks(chunks, limit).map(stripEmbedding);
}

function stripEmbedding(chunk: PersistedChunk): StoredChunk {
  const { embedding: _embedding, ...rest } = chunk;
  return rest;
}

function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || !left.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}
const PROCEDURE_QUERY_TERMS = new Set([
  "apply",
  "build",
  "compact",
  "cure",
  "install",
  "lay",
  "mix",
  "prepare",
  "process",
  "procedure",
  "step",
]);

const VALUE_QUERY_TERMS = new Set([
  "cost",
  "day",
  "estimate",
  "hour",
  "inr",
  "kg",
  "measurement",
  "mm",
  "percent",
  "price",
  "quantity",
  "ratio",
  "thick",
  "thickness",
  "value",
  "week",
]);

const TOOLING_QUERY_TERMS = new Set([
  "bamboo",
  "compact",
  "manual",
  "mechanical",
  "method",
  "rammer",
  "tool",
  "vibrator",
]);
const COMPOSITION_QUERY_TERMS = new Set([
  "aggregate",
  "ash",
  "booster",
  "composition",
  "mix",
  "ratio",
  "sand",
  "water",
]);

export async function markLocalDocumentFailed(
  documentId: string,
  error: unknown,
): Promise<void> {
  await updateLocalDocument(documentId, (document) => {
    document.status = "failed";
    document.errorMessage = summarizeError(error);
  });
}

export async function setLocalDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  errorMessage?: string | null,
): Promise<void> {
  await updateLocalDocument(documentId, (document) => {
    document.status = status;
    document.errorMessage = errorMessage ?? null;
  });
}

export async function setLocalDocumentParsedData(input: {
  documentId: string;
  pageCount: number;
  outline: OutlineEntry[];
  parserMeta: Record<string, unknown>;
}): Promise<void> {
  await updateLocalDocument(input.documentId, (document) => {
    document.pageCount = input.pageCount;
    document.outline = input.outline;
    document.parserMeta = input.parserMeta;
  });
}
