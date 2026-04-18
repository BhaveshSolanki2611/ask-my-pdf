import { describe, expect, it } from "vitest";
import { buildDocumentMap } from "@/lib/documents/chunking";
import { __localPdfParseTestUtils } from "@/lib/llama/parse";
import type { ParsedPdf, ParsedPdfLine, ParsedPdfPage } from "@/lib/types";

function makeLine(
  text: string,
  pageNumber: number,
  y: number,
  fontSize: number,
): ParsedPdfLine {
  return {
    text,
    x: 40,
    y,
    fontSize,
    pageNumber,
  };
}

function makePage(
  pageNumber: number,
  lines: ParsedPdfLine[],
): ParsedPdfPage {
  return {
    pageNumber,
    text: lines.map((line) => line.text).join("\n"),
    lines,
    source: "layout",
  };
}

describe("layout chunking and parser regressions", () => {
  it("keeps numeric prose out of table chunks while preserving value tables", () => {
    const page1Lines = [
      makeLine("ARCHITECTURAL DESIGN CONSIDERATIONS", 1, 120, 24),
      makeLine("They are often layered with 4-8mm thick breathable finishes.", 1, 100, 12),
      makeLine("Rounded edges help prevent chipping during occupancy.", 1, 84, 12),
    ];
    const page2Lines = [
      makeLine("MATERIAL & COST ESTIMATION", 2, 120, 24),
      makeLine("50kg FAT LIME @ INR 900", 2, 100, 12),
      makeLine("20 sq.ft assumption", 2, 84, 12),
    ];
    const parsed: ParsedPdf = {
      pageCount: 2,
      parserMeta: {},
      contentFormat: "layout",
      pages: [makePage(1, page1Lines), makePage(2, page2Lines)],
    };

    const documentMap = buildDocumentMap(parsed, 300);
    const page1Chunks = documentMap.chunks.filter((chunk) => chunk.pageFrom === 1);
    const page2Chunks = documentMap.chunks.filter((chunk) => chunk.pageFrom === 2);

    expect(page1Chunks.every((chunk) => chunk.chunkType !== "table")).toBe(true);
    expect(page1Chunks.some((chunk) => chunk.chunkType === "paragraph")).toBe(true);
    expect(page2Chunks.some((chunk) => chunk.chunkType === "table")).toBe(true);
  });

  it("does not merge FAQ section headings with the first question line", () => {
    const merged = __localPdfParseTestUtils.mergeHeadingLines([
      makeLine("FAQ SUBSTRATE", 1, 120, 22),
      makeLine(
        "Can FAT LIME concrete be applied over underfloor heating?",
        1,
        104,
        16,
      ),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].text).toBe("FAQ SUBSTRATE");
    expect(merged[1].text).toContain("underfloor heating");
  });

  it("removes repeated page-number artifacts during local page cleanup", () => {
    const pages = __localPdfParseTestUtils.cleanupLocalPages([
      makePage(14, [
        makeLine("CURING REGIME", 14, 120, 24),
        makeLine("Wait about 4-6 days after laying.", 14, 100, 12),
        makeLine("14 14", 14, 70, 10),
      ]),
    ]);

    expect(pages[0].lines.map((line) => line.text)).not.toContain("14 14");
  });
});
