import type {
  ChunkDraft,
  ChunkType,
  DocumentMap,
  OutlineEntry,
  ParsedPdf,
  ParsedPdfLine,
  ParsedPdfPage,
} from "@/lib/types";
import { estimateTokens, normalizeWhitespace } from "@/lib/utils";

type HeadingFrame = {
  level: number;
  title: string;
  outlineIndex: number;
};

type RawBlock = {
  page: number;
  sectionPath: string[];
  type: ChunkType;
  text: string;
};

type FaqBuffer = {
  question: string;
  answerLines: string[];
  pageFrom: number;
  pageTo: number;
  sectionPath: string[];
};

function isHeading(line: string): RegExpMatchArray | null {
  return line.match(/^(#{1,6})\s+(.+)$/);
}

function isMarkdownImageLine(line: string): boolean {
  return /^!\[[^\]]*]\([^)]+\)$/.test(line) || /^<img\b/i.test(line);
}

function cleanMarkdownLine(line: string): string {
  return normalizeWhitespace(
    line
      .replace(/!\[[^\]]*]\([^)]+\)/g, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/<\/?(?:u|strong|em|span|p|div|b|i)[^>]*>/gi, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*\s][^*]*?)\*/g, "$1")
      .replace(/_([^_\s][^_]*?)_/g, "$1")
      .replace(/`([^`]+)`/g, "$1"),
  );
}

function extractFaqQuestionText(text: string): string | null {
  const normalized = cleanMarkdownLine(text);
  const match = normalized.match(
    /((?:what|why|how|can|is|are|do|does|should|will|when|where|which)\b.+\?)/i,
  );

  if (match?.[1]) {
    return match[1].trim();
  }

  return normalized.endsWith("?") ? normalized : null;
}

function isMarkdownTableLine(line: string): boolean {
  return /^\|.+\|$/.test(line) || /^\|?[-: ]+\|[-|: ]+$/.test(line);
}

function isOrderedListLine(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}

function isBulletListLine(line: string): boolean {
  return /^[-*+]\s+/.test(line);
}

function isCalloutLine(line: string): boolean {
  return (
    /^>\s*/.test(line) ||
    /^(warning|caution|note|important|alert)\b/i.test(line)
  );
}

function finalizeOpenSections(
  openSections: HeadingFrame[],
  outline: OutlineEntry[],
  currentPage: number,
): void {
  while (openSections.length) {
    const item = openSections.pop();

    if (!item) {
      continue;
    }

    outline[item.outlineIndex].pageEnd = Math.max(
      outline[item.outlineIndex].pageStart,
      currentPage,
    );
  }
}

function closeSectionsToLevel(
  openSections: HeadingFrame[],
  outline: OutlineEntry[],
  level: number,
  currentPage: number,
): void {
  while (openSections.length && openSections.at(-1)!.level >= level) {
    const item = openSections.pop();

    if (!item) {
      continue;
    }

    outline[item.outlineIndex].pageEnd = Math.max(
      outline[item.outlineIndex].pageStart,
      currentPage,
    );
  }
}

function sectionText(sectionPath: string[], text: string): string {
  if (!sectionPath.length) {
    return text;
  }

  return `${sectionPath.join(" > ")}\n${text}`;
}

function pushAtomicChunk(
  chunks: ChunkDraft[],
  block: RawBlock,
): void {
  const text = normalizeWhitespace(block.text);

  if (!text) {
    return;
  }

  chunks.push({
    sourceId: `src-${String(chunks.length + 1).padStart(4, "0")}`,
    pageFrom: block.page,
    pageTo: block.page,
    sectionPath: [...block.sectionPath],
    chunkType: block.type,
    text: sectionText(block.sectionPath, text),
  });
}

function pushFaqChunk(chunks: ChunkDraft[], faq: FaqBuffer): void {
  const answer = normalizeWhitespace(faq.answerLines.join("\n"));

  if (!answer) {
    return;
  }

  chunks.push({
    sourceId: `src-${String(chunks.length + 1).padStart(4, "0")}`,
    pageFrom: faq.pageFrom,
    pageTo: faq.pageTo,
    sectionPath: [...faq.sectionPath],
    chunkType: "faq",
    text: sectionText(
      faq.sectionPath,
      `Question: ${faq.question}\nAnswer: ${answer}`,
    ),
  });
}

function chunkParagraphBlocks(
  blocks: RawBlock[],
  targetTokens: number,
): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let buffer: RawBlock[] = [];

  const flush = () => {
    if (!buffer.length) {
      return;
    }

    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    const chunkType =
      buffer.find((item) => item.type === "list")?.type ?? "paragraph";

    chunks.push({
      sourceId: `src-${String(chunks.length + 1).padStart(4, "0")}`,
      pageFrom: first.page,
      pageTo: last.page,
      sectionPath: [...first.sectionPath],
      chunkType,
      text: sectionText(
        first.sectionPath,
        buffer.map((item) => item.text).join("\n\n"),
      ),
    });

    buffer = [];
  };

  for (const block of blocks) {
    if (
      block.type === "table" ||
      block.type === "warning" ||
      block.type === "procedure" ||
      block.type === "faq"
    ) {
      flush();
      pushAtomicChunk(chunks, block);
      continue;
    }

    const prospectiveText = buffer
      .concat(block)
      .map((item) => item.text)
      .join("\n\n");
    const sameSection =
      !buffer.length ||
      buffer[0].sectionPath.join(" > ") === block.sectionPath.join(" > ");
    const samePage = !buffer.length || buffer[buffer.length - 1].page === block.page;

    if (
      buffer.length &&
      (!sameSection ||
        !samePage ||
        estimateTokens(prospectiveText) > targetTokens)
    ) {
      flush();
    }

    buffer.push(block);
  }

  flush();

  return chunks;
}

export function buildDocumentMap(
  parsed: ParsedPdf,
  targetTokens = 800,
): DocumentMap {
  if (parsed.contentFormat === "layout") {
    return buildLayoutDocumentMap(parsed.pages, targetTokens);
  }

  return buildMarkdownDocumentMap(parsed.pages, targetTokens);
}

function buildMarkdownDocumentMap(
  pages: ParsedPdfPage[],
  targetTokens: number,
): DocumentMap {
  const outline: OutlineEntry[] = [];
  const blocks: RawBlock[] = [];
  const openSections: HeadingFrame[] = [];
  let sectionPath: string[] = [];

  pages.forEach((page) => {
    const lines = page.text.split("\n");
    const paragraphBuffer: string[] = [];
    const tableBuffer: string[] = [];
    const listBuffer: string[] = [];
    const calloutBuffer: string[] = [];
    let listType: ChunkType | null = null;
    let currentFaq: FaqBuffer | null = null;

    const flushParagraph = () => {
      const text = normalizeWhitespace(paragraphBuffer.join("\n"));

      if (text) {
        blocks.push({
          page: page.pageNumber,
          sectionPath: [...sectionPath],
          type: "paragraph",
          text,
        });
      }

      paragraphBuffer.length = 0;
    };

    const flushFaq = () => {
      if (!currentFaq) {
        return;
      }

      const answer = normalizeWhitespace(currentFaq.answerLines.join("\n"));

      if (answer) {
        blocks.push({
          page: currentFaq.pageFrom,
          sectionPath: [...currentFaq.sectionPath],
          type: "faq",
          text: `Question: ${currentFaq.question}\nAnswer: ${answer}`,
        });
      }

      currentFaq = null;
    };

    const flushAll = () => {
      flushFaq();

      if (calloutBuffer.length) {
        blocks.push({
          page: page.pageNumber,
          sectionPath: [...sectionPath],
          type: "warning",
          text: normalizeWhitespace(calloutBuffer.join("\n")),
        });
        calloutBuffer.length = 0;
      }

      if (tableBuffer.length) {
        blocks.push({
          page: page.pageNumber,
          sectionPath: [...sectionPath],
          type: "table",
          text: normalizeWhitespace(tableBuffer.join("\n")),
        });
        tableBuffer.length = 0;
      }

      if (listBuffer.length && listType) {
        blocks.push({
          page: page.pageNumber,
          sectionPath: [...sectionPath],
          type: listType,
          text: normalizeWhitespace(listBuffer.join("\n")),
        });
        listBuffer.length = 0;
        listType = null;
      }

      flushParagraph();
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      if (isMarkdownImageLine(trimmed)) {
        continue;
      }

      const normalizedLine = cleanMarkdownLine(trimmed);

      const heading = isHeading(normalizedLine);

      if (heading) {
        flushAll();
        const level = heading[1].length;
        const title = heading[2].trim();

        closeSectionsToLevel(openSections, outline, level, page.pageNumber);

        sectionPath = openSections.map((item) => item.title);
        sectionPath[level - 1] = title;
        sectionPath = sectionPath.slice(0, level);

        outline.push({
          id: `outline-${outline.length + 1}`,
          title,
          level,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
        });

        openSections.push({
          level,
          title,
          outlineIndex: outline.length - 1,
        });

        continue;
      }

      if (!normalizedLine) {
        flushAll();
        continue;
      }

      if (looksLikeFaqQuestion(normalizedLine, sectionPath)) {
        flushParagraph();

        if (calloutBuffer.length || tableBuffer.length || listBuffer.length) {
          flushAll();
        }

        flushFaq();
        currentFaq = {
          question: extractFaqQuestionText(normalizedLine) ?? normalizedLine,
          answerLines: [],
          pageFrom: page.pageNumber,
          pageTo: page.pageNumber,
          sectionPath: [...sectionPath],
        };
        continue;
      }

      if (currentFaq) {
        currentFaq.answerLines.push(normalizedLine);
        currentFaq.pageTo = page.pageNumber;
        continue;
      }

      if (isCalloutLine(normalizedLine)) {
        flushParagraph();

        if (tableBuffer.length || listBuffer.length) {
          flushAll();
        }

        calloutBuffer.push(normalizedLine.replace(/^>\s*/, ""));
        continue;
      }

      if (calloutBuffer.length) {
        flushAll();
      }

      if (isMarkdownTableLine(normalizedLine)) {
        flushParagraph();

        if (listBuffer.length && listType) {
          flushAll();
        }

        tableBuffer.push(normalizedLine);
        continue;
      }

      if (tableBuffer.length) {
        flushAll();
      }

      if (
        isOrderedListLine(normalizedLine) ||
        isBulletListLine(normalizedLine)
      ) {
        flushParagraph();
        listType = isOrderedListLine(normalizedLine) ? "procedure" : "list";
        listBuffer.push(normalizedLine);
        continue;
      }

      if (listBuffer.length && /^\s{2,}\S+/.test(rawLine)) {
        listBuffer.push(normalizedLine);
        continue;
      }

      if (listBuffer.length && listType) {
        flushAll();
      }

      paragraphBuffer.push(normalizedLine);
    }

    flushAll();
  });

  finalizeOpenSections(openSections, outline, pages.at(-1)?.pageNumber ?? 1);

  return {
    outline,
    chunks: chunkParagraphBlocks(blocks, targetTokens),
  };
}

function buildLayoutDocumentMap(
  pages: ParsedPdfPage[],
  targetTokens: number,
): DocumentMap {
  const outline: OutlineEntry[] = [];
  const chunks: ChunkDraft[] = [];
  const openSections: HeadingFrame[] = [];
  const bodyFont = inferBodyFontSize(pages);
  const localTarget = Math.min(450, Math.max(300, Math.round(targetTokens * 0.5)));
  let sectionPath: string[] = [];
  let paragraphLines: string[] = [];
  let paragraphPage = 1;
  let listBuffer: { type: ChunkType; lines: string[]; page: number } | null = null;
  let tableBuffer: { lines: string[]; page: number } | null = null;
  let warningBuffer: { lines: string[]; page: number } | null = null;
  let currentFaq: FaqBuffer | null = null;

  const flushParagraph = () => {
    const text = normalizeWhitespace(paragraphLines.join("\n"));

    if (text) {
      chunks.push({
        sourceId: `src-${String(chunks.length + 1).padStart(4, "0")}`,
        pageFrom: paragraphPage,
        pageTo: paragraphPage,
        sectionPath: [...sectionPath],
        chunkType: "paragraph",
        text: sectionText(sectionPath, text),
      });
    }

    paragraphLines = [];
  };

  const flushList = () => {
    if (!listBuffer) {
      return;
    }

    chunks.push({
      sourceId: `src-${String(chunks.length + 1).padStart(4, "0")}`,
      pageFrom: listBuffer.page,
      pageTo: listBuffer.page,
      sectionPath: [...sectionPath],
      chunkType: listBuffer.type,
      text: sectionText(
        sectionPath,
        normalizeWhitespace(listBuffer.lines.join("\n")),
      ),
    });

    listBuffer = null;
  };

  const flushTable = () => {
    if (!tableBuffer) {
      return;
    }

    chunks.push({
      sourceId: `src-${String(chunks.length + 1).padStart(4, "0")}`,
      pageFrom: tableBuffer.page,
      pageTo: tableBuffer.page,
      sectionPath: [...sectionPath],
      chunkType: "table",
      text: sectionText(
        sectionPath,
        normalizeWhitespace(tableBuffer.lines.join("\n")),
      ),
    });

    tableBuffer = null;
  };

  const flushWarning = () => {
    if (!warningBuffer) {
      return;
    }

    chunks.push({
      sourceId: `src-${String(chunks.length + 1).padStart(4, "0")}`,
      pageFrom: warningBuffer.page,
      pageTo: warningBuffer.page,
      sectionPath: [...sectionPath],
      chunkType: "warning",
      text: sectionText(
        sectionPath,
        normalizeWhitespace(warningBuffer.lines.join("\n")),
      ),
    });

    warningBuffer = null;
  };

  const flushFaq = () => {
    if (!currentFaq) {
      return;
    }

    pushFaqChunk(chunks, currentFaq);
    currentFaq = null;
  };

  const flushStructured = () => {
    flushFaq();
    flushWarning();
    flushTable();
    flushList();
  };

  const flushAll = () => {
    flushStructured();
    flushParagraph();
  };

  const openHeading = (title: string, level: number, pageNumber: number) => {
    flushAll();
    closeSectionsToLevel(openSections, outline, level, pageNumber);

    sectionPath = openSections.map((item) => item.title);
    sectionPath[level - 1] = title;
    sectionPath = sectionPath.slice(0, level);

    outline.push({
      id: `outline-${outline.length + 1}`,
      title,
      level,
      pageStart: pageNumber,
      pageEnd: pageNumber,
    });

    openSections.push({
      level,
      title,
      outlineIndex: outline.length - 1,
    });
  };

  for (const page of pages) {
    for (const line of page.lines) {
      if (looksLikeHeadingLine(line, bodyFont)) {
        openHeading(cleanHeadingText(line.text), headingLevel(line, bodyFont), page.pageNumber);
        continue;
      }

      if (currentFaq && looksLikeFaqQuestion(line.text, sectionPath)) {
        flushFaq();
        currentFaq = {
          question: line.text.trim(),
          answerLines: [],
          pageFrom: page.pageNumber,
          pageTo: page.pageNumber,
          sectionPath: [...sectionPath],
        };
        continue;
      }

      if (looksLikeFaqQuestion(line.text, sectionPath)) {
        flushParagraph();
        flushWarning();
        flushTable();
        flushList();
        flushFaq();

        currentFaq = {
          question: line.text.trim(),
          answerLines: [],
          pageFrom: page.pageNumber,
          pageTo: page.pageNumber,
          sectionPath: [...sectionPath],
        };
        continue;
      }

      if (currentFaq) {
        currentFaq.answerLines.push(line.text.trim());
        currentFaq.pageTo = page.pageNumber;
        continue;
      }

      if (looksLikeWarningLine(line.text)) {
        flushParagraph();
        flushTable();
        flushList();

        warningBuffer ??= { lines: [], page: page.pageNumber };
        warningBuffer.lines.push(line.text.trim());
        continue;
      }

      if (warningBuffer) {
        flushWarning();
      }

      if (looksLikeTableValueLine(line.text, sectionPath)) {
        flushParagraph();
        flushList();

        tableBuffer ??= { lines: [], page: page.pageNumber };
        tableBuffer.lines.push(line.text.trim());
        continue;
      }

      if (tableBuffer) {
        flushTable();
      }

      if (isOrderedListLine(line.text) || isBulletListLine(line.text)) {
        flushParagraph();

        listBuffer ??= {
          type: isOrderedListLine(line.text) ? "procedure" : "list",
          lines: [],
          page: page.pageNumber,
        };
        listBuffer.lines.push(line.text.trim());
        continue;
      }

      if (listBuffer && line.x > 110) {
        listBuffer.lines.push(line.text.trim());
        continue;
      }

      if (listBuffer) {
        flushList();
      }

      if (!paragraphLines.length) {
        paragraphPage = page.pageNumber;
      }

      paragraphLines.push(line.text.trim());

      if (estimateTokens(paragraphLines.join("\n")) >= localTarget) {
        flushParagraph();
      }
    }

    flushStructured();
    flushParagraph();
  }

  finalizeOpenSections(openSections, outline, pages.at(-1)?.pageNumber ?? 1);

  return {
    outline,
    chunks,
  };
}

function inferBodyFontSize(pages: ParsedPdfPage[]): number {
  const sizes = pages
    .flatMap((page) => page.lines)
    .filter((line) => {
      const text = line.text.trim();
      const letters = text.replace(/[^A-Za-z]/g, "");
      const uppercaseRatio = letters.length
        ? text.replace(/[^A-Z]/g, "").length / letters.length
        : 0;

      return text.length >= 20 && letters.length >= 8 && uppercaseRatio < 0.65;
    })
    .map((line) => line.fontSize)
    .filter((size) => size > 0);

  if (!sizes.length) {
    return 14;
  }

  const sorted = [...sizes].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 14;
}

function looksLikeHeadingLine(line: ParsedPdfLine, bodyFont: number): boolean {
  const text = line.text.trim();
  const letters = text.replace(/[^A-Za-z]/g, "");
  const words = text.split(/\s+/).filter(Boolean);
  const uppercaseRatio = letters.length
    ? text.replace(/[^A-Z]/g, "").length / letters.length
    : 0;
  const allCapsLike = uppercaseRatio >= 0.88 && words.length <= 10;
  const largeShortTitle =
    line.fontSize >= bodyFont + 6 &&
    words.length <= 8 &&
    !/[.,]/.test(text) &&
    !/[a-z]{4,}/.test(text);

  return (
    letters.length >= 4 &&
    text.length >= 4 &&
    text.length <= 90 &&
    !/[.,]$/.test(text) &&
    (/^faq\b/i.test(text) ||
      allCapsLike ||
      largeShortTitle ||
      (line.fontSize >= bodyFont + 8 &&
        words.length <= 12 &&
        !/[a-z]{5,}/.test(text)))
  );
}

function headingLevel(line: ParsedPdfLine, bodyFont: number): number {
  return line.fontSize >= bodyFont + 8 || /^faq\b/i.test(line.text) ? 1 : 2;
}

function cleanHeadingText(text: string): string {
  return normalizeWhitespace(text.replace(/^-+\s*/, ""));
}

function looksLikeFaqQuestion(text: string, sectionPath: string[]): boolean {
  const normalized = extractFaqQuestionText(text);

  if (!normalized || normalized.length < 8) {
    return false;
  }

  return (
    /^((what|why|how|can|is|are|do|does|should|will|when|where|which)\b)/i.test(
      normalized,
    ) ||
    sectionPath.some((entry) => /^faq\b/i.test(cleanMarkdownLine(entry)))
  );
}

function looksLikeWarningLine(text: string): boolean {
  return /^(warning|caution|note|important|alert)\b/i.test(text.trim());
}

function looksLikeTableValueLine(
  text: string,
  sectionPath: string[],
): boolean {
  const normalized = text.trim();
  const numericTokens = normalized.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const valueSection = sectionPath.some((entry) =>
    /(cost|estimation|mix|composition|ratio|material)/i.test(entry),
  );
  const words = normalized.split(/\s+/).filter(Boolean);
  const sentenceLike =
    words.length >= 7 &&
    /\b(is|are|was|were|be|been|being|with|instead|because|allow|wait|keep|begin|used|using|applied)\b/i.test(
      normalized,
    );
  const tableCue =
    /[:|]/.test(normalized) ||
    /\b(total|qty|quantity|rate|cost|assumption|bag|per|ratio|inr|sq\.?ft|kg|mm|%)\b/i.test(
      normalized,
    );
  const shortDescriptor = words.length <= 7;

  return (
    normalized.length <= 120 &&
    !sentenceLike &&
    (numericTokens.length >= 2 ||
      (valueSection && numericTokens.length >= 1 && tableCue) ||
      (shortDescriptor &&
        tableCue &&
        /@|inr|kg|sq\.?ft|ton|%|mm/i.test(normalized)))
  );
}
