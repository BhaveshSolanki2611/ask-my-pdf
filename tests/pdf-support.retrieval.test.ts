import { describe, expect, it } from "vitest";
import { rerankRetrievedChunks } from "@/lib/documents/retrieval-ranking";
import type { StoredChunk } from "@/lib/types";

function makeChunk(
  overrides: Partial<StoredChunk> & {
    id: string;
    text: string;
    sectionPath: string[];
  },
): StoredChunk {
  return {
    id: overrides.id,
    documentId: overrides.documentId ?? "doc-mlime",
    sourceId: overrides.sourceId ?? overrides.id,
    pageFrom: overrides.pageFrom ?? 1,
    pageTo: overrides.pageTo ?? overrides.pageFrom ?? 1,
    sectionPath: overrides.sectionPath,
    chunkType: overrides.chunkType ?? "paragraph",
    text: overrides.text,
    vectorScore: overrides.vectorScore ?? 0.5,
    keywordScore: overrides.keywordScore ?? 0.5,
    score: overrides.score,
  };
}

describe("retrieval reranking", () => {
  it("prioritizes curing regime chunks over nearby laying content for curing questions", () => {
    const ranked = rerankRetrievedChunks(
      [
        makeChunk({
          id: "laying",
          pageFrom: 13,
          sectionPath: ["LAYING"],
          text:
            "LAYING\nWet the substrate repeatedly and thoroughly till it is ALMOST saturated.\nLay the FAT LIME concrete layers of up to 4” thick.",
          vectorScore: 0.8,
          keywordScore: 4.4,
        }),
        makeChunk({
          id: "curing-main",
          pageFrom: 13,
          sectionPath: ["CURING REGIME"],
          text:
            "CURING REGIME\nKeep wet and do not allow the application to dry out.\nThis is critical for the first 72 hours.\nThereafter, carry on with daily watering.",
          vectorScore: 0.55,
          keywordScore: 1.6,
        }),
        makeChunk({
          id: "curing-followup",
          pageFrom: 14,
          sectionPath: ["CURING REGIME"],
          chunkType: "table",
          text: "CURING REGIME\nWait about 4-6 days after laying",
          vectorScore: 0.48,
          keywordScore: 1.9,
        }),
      ],
      "How should the FAT LIME concrete be cured after laying?",
    );

    expect(ranked.slice(0, 3).filter((chunk) => chunk.sectionPath.at(-1) === "CURING REGIME")).toHaveLength(2);
    expect(ranked[1]?.sectionPath.at(-1)).toBe("CURING REGIME");
  });

  it("prefers core tools and compaction chunks over FAQ-only chunks for broad tooling questions", () => {
    const ranked = rerankRetrievedChunks(
      [
        makeChunk({
          id: "faq-bamboo",
          pageFrom: 22,
          sectionPath: ["FAQ COMPACTION"],
          chunkType: "faq",
          text:
            "FAQ COMPACTION\nQuestion: Can a bamboo stick or a small hand-held wooden tool be used for compaction?\nAnswer: Such light weight tools will compact a 4”+ thick FAT LIME concrete very slowly.",
          vectorScore: 0.72,
          keywordScore: 3.2,
        }),
        makeChunk({
          id: "compaction",
          pageFrom: 16,
          sectionPath: ["COMPACTION"],
          text:
            "COMPACTION\nFeed this slurry to the FAT LIME concrete and begin compacting its surface manually with standard heavy round rammers (~12kg).",
          vectorScore: 0.63,
          keywordScore: 2.8,
        }),
        makeChunk({
          id: "tools",
          pageFrom: 7,
          sectionPath: ["TOOLS"],
          text:
            "TOOLS\n~12 kg heavy manual, round-shaped, rammers\nor equivalent mechanical rammers for large projects",
          vectorScore: 0.58,
          keywordScore: 2.5,
        }),
      ],
      "What tools or methods are used for compaction?",
    );

    expect(ranked[0]?.chunkType).not.toBe("faq");
    expect(["COMPACTION", "TOOLS"]).toContain(ranked[0]?.sectionPath.at(-1));
  });
});
