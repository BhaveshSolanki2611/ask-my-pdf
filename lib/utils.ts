import clsx, { type ClassValue } from "clsx";
import type { ChunkType, DocumentStatus } from "@/lib/types";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function estimateTokens(value: string): number {
  const normalized = value.trim();

  if (!normalized) {
    return 0;
  }

  return Math.ceil(normalized.split(/\s+/).length * 1.3);
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function sanitizeFilename(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned || "document.pdf";
}

export function toPgVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

export function toIsoString(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

export function formatPageLabel(pageFrom: number, pageTo: number): string {
  return pageFrom === pageTo ? `Page ${pageFrom}` : `Pages ${pageFrom}-${pageTo}`;
}

export function formatSectionLabel(sectionPath: string[]): string {
  return sectionPath.length ? sectionPath.join(" > ") : "Document";
}

export function chunkTypeLabel(chunkType: ChunkType): string {
  switch (chunkType) {
    case "faq":
      return "FAQ";
    case "procedure":
      return "Procedure";
    case "table":
      return "Table";
    case "warning":
      return "Warning";
    case "list":
      return "List";
    default:
      return "Paragraph";
  }
}

export function statusLabel(status: DocumentStatus): string {
  switch (status) {
    case "uploaded":
      return "Queued";
    case "parsing":
      return "Parsing PDF";
    case "chunking":
      return "Building sections";
    case "embedding":
      return "Embedding chunks";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

const SEARCH_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "have",
  "what",
  "when",
  "where",
  "which",
  "about",
  "there",
  "their",
  "them",
  "then",
  "will",
  "would",
  "should",
  "could",
  "does",
  "using",
  "only",
  "page",
  "pages",
]);

const SEARCH_TOKEN_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /^cur(?:e|es|ed|ing)$/, replacement: "cure" },
  { pattern: /^water(?:ing|ed|s)?$/, replacement: "water" },
  { pattern: /^lay(?:ing|ed|s)?$/, replacement: "lay" },
  { pattern: /^compact(?:ion|ing|ed|s)?$/, replacement: "compact" },
  { pattern: /^mix(?:ing|ed|es)?$/, replacement: "mix" },
  { pattern: /^tools?$/, replacement: "tool" },
  { pattern: /^methods?$/, replacement: "method" },
  { pattern: /^rammers?$/, replacement: "rammer" },
  { pattern: /^vibrators?$/, replacement: "vibrator" },
  { pattern: /^aggregates?$/, replacement: "aggregate" },
  { pattern: /^applications?$/, replacement: "application" },
  { pattern: /^days?$/, replacement: "day" },
  { pattern: /^weeks?$/, replacement: "week" },
  { pattern: /^hours?$/, replacement: "hour" },
];

export function normalizeSearchToken(value: string): string {
  let normalized = value.toLowerCase().trim();

  if (!normalized) {
    return "";
  }

  for (const rule of SEARCH_TOKEN_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.replacement;
    }
  }

  if (normalized.length > 4 && normalized.endsWith("ies")) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (
    normalized.length > 4 &&
    normalized.endsWith("s") &&
    !normalized.endsWith("ss")
  ) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function tokenizeForSearch(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(normalizeSearchToken)
    .filter((term) => term.length > 2 && !SEARCH_STOPWORDS.has(term));
}
