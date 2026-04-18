import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import LlamaCloud from "@llamaindex/llama-cloud";
import { getServerEnv, isLlamaParseConfigured } from "@/lib/env";
import type { ParsedPdf, ParsedPdfLine, ParsedPdfPage } from "@/lib/types";
import { normalizeWhitespace } from "@/lib/utils";

const require = createRequire(import.meta.url);

type PdfParseItem = {
  str: string;
  transform: number[];
};

type PdfParsePageData = {
  getTextContent: (options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }) => Promise<{
    items: PdfParseItem[];
  }>;
};

function passwordProtectedMessage(message: string): boolean {
  return /password|encrypted|owner password|permission/i.test(message);
}

export async function parsePdfWithLlamaCloud(
  buffer: Buffer,
  filename: string,
): Promise<ParsedPdf> {
  if (!isLlamaParseConfigured()) {
    return parsePdfLocally(buffer);
  }

  const env = getServerEnv();
  process.env.LLAMA_CLOUD_API_KEY = env.LLAMA_CLOUD_API_KEY;

  const tempDir = await mkdtemp(join(tmpdir(), "pdf-support-copilot-"));
  const tempPath = join(tempDir, filename);
  const client = new LlamaCloud();

  try {
    await writeFile(tempPath, buffer);

    const file = await client.files.create({
      file: createReadStream(tempPath),
      purpose: "parse",
    });

    const result = await client.parsing.parse({
      file_id: file.id,
      tier: "agentic",
      version: "latest",
      expand: ["markdown"],
    });

    const pages: ParsedPdfPage[] =
      result.markdown?.pages?.flatMap((page, index) => {
        const text = normalizeWhitespace(
          "markdown" in page && typeof page.markdown === "string"
            ? page.markdown
            : "",
        );

        if (!text) {
          return [];
        }

        return [
          {
            pageNumber: index + 1,
            text,
            lines: [],
            source: "markdown",
          } satisfies ParsedPdfPage,
        ];
      }) ?? [];

    if (!pages.length) {
      throw new Error("LlamaParse returned no markdown pages for this PDF.");
    }

    return {
      pages,
      pageCount: pages.length,
      contentFormat: "markdown",
      parserMeta: {
        provider: "llamaparse",
        fileId: file.id,
        tier: "agentic",
        version: "latest",
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LlamaParse failed to parse the PDF.";

    if (passwordProtectedMessage(message)) {
      throw new Error(
        "This PDF appears to be password protected or encrypted, so it could not be processed.",
      );
    }

    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function parsePdfLocally(buffer: Buffer): Promise<ParsedPdf> {
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
    dataBuffer: Buffer,
    options?: {
      pagerender?: (pageData: PdfParsePageData) => Promise<string>;
    },
  ) => Promise<{ numpages?: number }>;
  const rawPages: ParsedPdfPage[] = [];
  let pageNumber = 0;

  const parsed = await pdfParse(buffer, {
    pagerender: async (pageData: PdfParsePageData) => {
      pageNumber += 1;
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      const lines = buildLocalLayoutLines(textContent.items, pageNumber);

      rawPages.push({
        pageNumber,
        text: lines.map((line) => line.text).join("\n"),
        lines,
        source: "layout",
      });

      return lines.map((line) => line.text).join("\n");
    },
  });

  const cleanedPages = cleanupLocalPages(rawPages).filter(
    (page) => page.lines.length || page.text.length,
  );

  if (!cleanedPages.length) {
    throw new Error(
      "The local PDF parser could not extract text from this file. If this is a scanned PDF, configure LLAMA_CLOUD_API_KEY for OCR parsing.",
    );
  }

  return {
    pages: cleanedPages,
    pageCount: cleanedPages.length,
    contentFormat: "layout",
    parserMeta: {
      provider: "pdf-parse",
      mode: "local-layout-parser",
      layoutAware: true,
      pagesDetected:
        parsed && typeof parsed === "object" && "numpages" in parsed
          ? parsed.numpages
          : cleanedPages.length,
      note: "OCR is unavailable in local fallback mode.",
    },
  };
}

function buildLocalLayoutLines(
  items: PdfParseItem[],
  pageNumber: number,
): ParsedPdfLine[] {
  const normalizedItems = items
    .map((item) => ({
      text: normalizePdfText(item.str),
      x: Number(item.transform[4] ?? 0),
      y: Number(item.transform[5] ?? 0),
      fontSize: Math.max(
        Math.abs(Number(item.transform[0] ?? 0)),
        Math.abs(Number(item.transform[3] ?? 0)),
        1,
      ),
    }))
    .filter((item) => item.text);

  normalizedItems.sort((left, right) => {
    if (Math.abs(left.y - right.y) > 1.25) {
      return right.y - left.y;
    }

    return left.x - right.x;
  });

  const lineGroups: Array<{
    y: number;
    items: typeof normalizedItems;
  }> = [];

  for (const item of normalizedItems) {
    const currentGroup = lineGroups.at(-1);
    const tolerance = Math.max(1.8, item.fontSize * 0.18);

    if (currentGroup && Math.abs(currentGroup.y - item.y) <= tolerance) {
      currentGroup.items.push(item);
      currentGroup.y = (currentGroup.y + item.y) / 2;
      continue;
    }

    lineGroups.push({
      y: item.y,
      items: [item],
    });
  }

  const lines = lineGroups
    .map((group) => {
      group.items.sort((left, right) => left.x - right.x);

      return {
        text: normalizeWhitespace(joinLineItems(group.items)),
        x: group.items[0]?.x ?? 0,
        y: group.y,
        fontSize: Math.max(...group.items.map((item) => item.fontSize)),
        pageNumber,
      } satisfies ParsedPdfLine;
    })
    .filter((line) => line.text);

  return mergeHeadingLines(lines);
}

function joinLineItems(
  items: Array<{
    text: string;
    x: number;
  }>,
): string {
  let line = "";

  items.forEach((item, index) => {
    if (!index) {
      line = item.text;
      return;
    }

    const previous = items[index - 1];
    const compactJoin =
      /^[,.;:!?)}\]]/.test(item.text) ||
      /[(\[{/]$/.test(previous.text) ||
      /-$/.test(previous.text);
    const gap = item.x - previous.x;
    const spacer = compactJoin || gap < 2 ? "" : " ";

    line += `${spacer}${item.text}`;
  });

  return line;
}

function mergeHeadingLines(lines: ParsedPdfLine[]): ParsedPdfLine[] {
  if (lines.length < 2) {
    return lines;
  }

  const bodyFont = median(lines.map((line) => line.fontSize)) || 12;
  const merged: ParsedPdfLine[] = [];

  let index = 0;

  while (index < lines.length) {
    const current = lines[index];
    const next = lines[index + 1];
    const shouldMergeQuestion =
      Boolean(next) &&
      current.pageNumber === next.pageNumber &&
      Math.abs(current.x - next.x) < 24 &&
      current.y - next.y < Math.max(current.fontSize, next.fontSize) * 1.7 &&
      !/^\s*faq\b/i.test(current.text) &&
      current.text.split(/\s+/).length > 4 &&
      !/[.!?]$/.test(current.text) &&
      /\?$/.test(next.text) &&
      current.text.length >= 12;

    if (
      next &&
      ((looksLikeHeadingCandidate(current, bodyFont) &&
        looksLikeHeadingCandidate(next, bodyFont) &&
        Math.abs(current.x - next.x) < 32 &&
        current.pageNumber === next.pageNumber &&
        current.y - next.y < Math.max(current.fontSize, next.fontSize) * 1.7) ||
        shouldMergeQuestion)
    ) {
      merged.push({
        ...current,
        text: normalizeWhitespace(`${current.text} ${next.text}`),
        y: (current.y + next.y) / 2,
        fontSize: Math.max(current.fontSize, next.fontSize),
      });
      index += 2;
      continue;
    }

    merged.push(current);
    index += 1;
  }

  return merged;
}

function cleanupLocalPages(pages: ParsedPdfPage[]): ParsedPdfPage[] {
  const boundaryCounts = new Map<string, number>();

  for (const page of pages) {
    const candidates = [...page.lines.slice(0, 3), ...page.lines.slice(-4)];

    for (const line of candidates) {
      const key = boundaryKey(line.text);

      if (!key) {
        continue;
      }

      boundaryCounts.set(key, (boundaryCounts.get(key) ?? 0) + 1);
    }
  }

  return pages.map((page) => {
    const lines = page.lines.filter((line, index) => {
      if (isPageArtifactLine(line.text, page.pageNumber)) {
        return false;
      }

      if (isFooterNoise(line.text)) {
        return false;
      }

      const key = boundaryKey(line.text);

      if (!key) {
        return true;
      }

      const repeated = (boundaryCounts.get(key) ?? 0) >= 3;
      const nearBoundary = index <= 2 || index >= page.lines.length - 4;

      return !(repeated && nearBoundary);
    });

    return {
      ...page,
      lines,
      text: lines.map((line) => line.text).join("\n"),
    };
  });
}

function looksLikeHeadingCandidate(line: ParsedPdfLine, bodyFont: number): boolean {
  const text = line.text.trim();
  const uppercaseRatio =
    text.length > 0
      ? text.replace(/[^A-Z]/g, "").length / text.replace(/[^A-Za-z]/g, "").length
      : 0;

  return (
    text.length >= 4 &&
    text.length <= 90 &&
    !/[.!]$/.test(text) &&
    (line.fontSize >= bodyFont + 5 ||
      (line.fontSize >= bodyFont + 2 && uppercaseRatio >= 0.72))
  );
}

function boundaryKey(text: string): string | null {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[0-9]+/g, "")
    .trim();

  if (!normalized || normalized.length < 3 || normalized.length > 80) {
    return null;
  }

  return normalized;
}

function isStandalonePageNumber(text: string, pageNumber: number): boolean {
  const normalized = text.trim();

  return (
    /^\d{1,3}$/.test(normalized) &&
    (Number(normalized) === pageNumber || normalized.length <= 2)
  );
}

function isPageArtifactLine(text: string, pageNumber: number): boolean {
  const normalized = text.trim();
  const numericParts = normalized.split(/\s+/).filter(Boolean);

  if (!numericParts.length || numericParts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }

  if (isStandalonePageNumber(normalized, pageNumber)) {
    return true;
  }

  return numericParts.length <= 3 && numericParts.some((part) => Number(part) === pageNumber);
}

function isFooterNoise(text: string): boolean {
  return /(www\.|@|email|whatsapp|instagram|contact mlime)/i.test(text.trim());
}

function normalizePdfText(value: string): string {
  return value
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ|â€|â€/g, '"')
    .replace(/â€“|â€”/g, "-")
    .replace(/â€¦/g, "...")
    .replace(/\u0000/g, "")
    .replace(/Â/g, "")
    .replace(/â€˜|â€™/g, "'")
    .replace(/â|â/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â|â/g, '"')
    .replace(/â€“|â€”/g, "-")
    .replace(/â€¦/g, "...")
    .replace(/ï‚§||•/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

export const __localPdfParseTestUtils = {
  mergeHeadingLines,
  cleanupLocalPages,
  normalizePdfText,
};
