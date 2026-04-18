export const DOCUMENT_STATUSES = [
  "uploaded",
  "parsing",
  "chunking",
  "embedding",
  "ready",
  "failed",
] as const;

export const CHAT_MODES = ["answer", "draft"] as const;

export const CHUNK_TYPES = [
  "paragraph",
  "table",
  "warning",
  "procedure",
  "list",
  "faq",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type ChatMode = (typeof CHAT_MODES)[number];
export type ChunkType = (typeof CHUNK_TYPES)[number];

export type RuntimeCapabilities = {
  database: "postgres" | "blob-json" | "local-json";
  storage: "vercel-blob" | "local-filesystem";
  parser: "llamaparse" | "local-layout-parser";
  ai: "hosted-model" | "local-heuristic";
};

export type RuntimeReadiness = {
  deployment: "local" | "vercel";
  status: "ready" | "setup-required";
  uploadsEnabled: boolean;
  missingEnvVars: string[];
  summary: string;
  detail: string;
};

export type OutlineEntry = {
  id: string;
  title: string;
  level: number;
  pageStart: number;
  pageEnd: number;
};

export type StoredDocument = {
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
  createdAt: string;
  updatedAt: string;
};

export type PublicDocument = Omit<StoredDocument, "blobPath"> & {
  sourceUrl: string;
  needsReingestion: boolean;
  chunkCount: number | null;
  capabilities: RuntimeCapabilities;
  readiness: RuntimeReadiness;
};

export type ChunkDraft = {
  sourceId: string;
  pageFrom: number;
  pageTo: number;
  sectionPath: string[];
  chunkType: ChunkType;
  text: string;
};

export type StoredChunk = ChunkDraft & {
  id: string;
  documentId: string;
  vectorScore?: number;
  keywordScore?: number;
  score?: number;
};

export type RetrievedChunk = StoredChunk & {
  label: string;
};

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type SourceReference = {
  id: string;
  pageLabel: string;
  sectionLabel: string;
  chunkType: ChunkType;
};

export type ChatResult = {
  type: "answer" | "clarification";
  answer: string;
  clarifyingQuestion?: string;
  usedSourceIds: string[];
  missing: string[];
  sources: SourceReference[];
};

export type ParsedPdfLine = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  pageNumber: number;
};

export type ParsedPdfPage = {
  pageNumber: number;
  text: string;
  lines: ParsedPdfLine[];
  source: "markdown" | "layout";
};

export type ParsedPdf = {
  pages: ParsedPdfPage[];
  pageCount: number;
  parserMeta: Record<string, unknown>;
  contentFormat: "markdown" | "layout";
};

export type DocumentMap = {
  outline: OutlineEntry[];
  chunks: ChunkDraft[];
};

export type IngestionWorkflowInput = {
  documentId: string;
  filename: string;
  blobPath: string;
};
