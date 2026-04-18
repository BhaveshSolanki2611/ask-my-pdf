import { describe, expect, it } from "vitest";
import { generateLocalPdfSupportAnswer } from "@/lib/ai/local-answer";
import type { RetrievedChunk } from "@/lib/types";
import {
  compactionChunks,
  curingChunks,
  faqPriorityChunks,
  irrelevantChunks,
  mixCompositionChunks,
} from "@/tests/fixtures/mlime-benchmark";

function makeChunk(
  overrides: Partial<RetrievedChunk> & {
    label: string;
    text: string;
    sectionPath: string[];
  },
): RetrievedChunk {
  return {
    id: overrides.id ?? overrides.label.toLowerCase(),
    documentId: overrides.documentId ?? "doc-mlime",
    sourceId: overrides.sourceId ?? overrides.label.toLowerCase(),
    pageFrom: overrides.pageFrom ?? 1,
    pageTo: overrides.pageTo ?? overrides.pageFrom ?? 1,
    sectionPath: overrides.sectionPath,
    chunkType: overrides.chunkType ?? "paragraph",
    text: overrides.text,
    vectorScore: overrides.vectorScore ?? 0.8,
    keywordScore: overrides.keywordScore ?? 0.8,
    score: overrides.score ?? 3,
    label: overrides.label,
  };
}

describe("local PDF answer synthesis", () => {
  it("combines multiple evidence spans for mix composition questions", () => {
    const result = generateLocalPdfSupportAnswer({
      question:
        "What is the mix ratio and water / booster requirement for FAT LIME concrete?",
      mode: "answer",
      chunks: mixCompositionChunks,
    });

    expect(result.type).toBe("answer");
    expect(result.answer).toContain("1 FAT LIME");
    expect(result.answer).toContain("2.5 coarse sand");
    expect(result.answer).toContain("62.5 gram Booster #1555");
    expect(result.answer).toContain("25kg bag of FAT LIME");
    expect(result.usedSourceIds).toEqual(expect.arrayContaining(["S1", "S3", "S4"]));
  });

  it("preserves curing order and includes the 72 hour plus daily watering guidance", () => {
    const result = generateLocalPdfSupportAnswer({
      question: "What is the curing regime after laying?",
      mode: "answer",
      chunks: curingChunks,
    });

    expect(result.type).toBe("answer");
    expect(result.answer).toContain("72 hours");
    expect(result.answer).toContain("daily watering");
    expect(result.answer).toContain("4-6 days");
    expect(result.answer).toContain("1.");
    expect(result.usedSourceIds).toEqual(expect.arrayContaining(["S1", "S2"]));
  });

  it("combines compaction guidance with FAQ tooling evidence", () => {
    const result = generateLocalPdfSupportAnswer({
      question: "What tools should be used for compaction?",
      mode: "answer",
      chunks: compactionChunks,
    });

    expect(result.type).toBe("answer");
    expect(result.answer).toContain("rammers");
    expect(result.answer).toContain("Vibrators can be used");
    expect(result.answer).toContain("3-4 times a day");
    expect(result.usedSourceIds).toEqual(expect.arrayContaining(["S1", "S2", "S3"]));
  });

  it("prefers the exact FAQ match over weaker lexical matches", () => {
    const result = generateLocalPdfSupportAnswer({
      question: "Can FAT LIME concrete be used over foam insulation directly?",
      mode: "answer",
      chunks: faqPriorityChunks,
    });

    expect(result.type).toBe("answer");
    expect(result.answer).toContain("No.");
    expect(result.answer).toContain("foam insulation");
    expect(result.usedSourceIds[0]).toBe("S1");
  });

  it("returns the exact fallback when the question is not supported by the PDF", () => {
    const result = generateLocalPdfSupportAnswer({
      question: "What is the warranty period for exported shipments?",
      mode: "answer",
      chunks: irrelevantChunks,
    });

    expect(result.type).toBe("answer");
    expect(result.answer).toBe("I could not find this in the uploaded PDF.");
    expect(result.usedSourceIds).toEqual([]);
  });

  it("keeps curing answers anchored to curing guidance even when laying chunks are nearby", () => {
    const result = generateLocalPdfSupportAnswer({
      question: "How should the FAT LIME concrete be cured after laying?",
      mode: "answer",
      chunks: [
        makeChunk({
          label: "S1",
          pageFrom: 13,
          sectionPath: ["LAYING"],
          text:
            "LAYING\nWet the substrate repeatedly and thoroughly till it is ALMOST saturated.\nLay the FAT LIME concrete layers of up to 4” thick, as many as desired to build up to the total thickness of the application.",
          score: 4.5,
        }),
        makeChunk({
          label: "S2",
          pageFrom: 13,
          sectionPath: ["CURING REGIME"],
          text:
            "CURING REGIME\nKeep wet and do not allow the application to dry out.\nThis is critical for the first 72 hours. If possible, make\nan embankment and allow water to stand on the\napplication for the first 72 hours.\nThereafter, carry on with daily watering.\nLay the materials on the\nsame day they are mixed.",
          score: 4.3,
        }),
        makeChunk({
          label: "S3",
          pageFrom: 14,
          sectionPath: ["CURING REGIME"],
          chunkType: "table",
          text: "CURING REGIME\nWait about 4-6 days after laying",
          score: 4.1,
        }),
      ],
    });

    expect(result.answer).toContain("72 hours");
    expect(result.answer).toContain("daily watering");
    expect(result.answer).toContain("4-6 days");
    expect(result.answer).not.toContain("Wet the substrate repeatedly");
    expect(result.answer).not.toContain("Lay the FAT LIME concrete layers");
  });

  it("keeps ratio answers focused on measurable mix facts instead of slurry setup prose", () => {
    const result = generateLocalPdfSupportAnswer({
      question:
        "What is the mix ratio and water / booster requirement for FAT LIME concrete?",
      mode: "answer",
      chunks: [
        ...mixCompositionChunks,
        makeChunk({
          label: "S5",
          pageFrom: 12,
          sectionPath: ["MIX PREPARATION"],
          text:
            "MIX PREPARATION\nAdd the moist FAT LIME to an excess of water to form a slurry.\nMeasure by weight.",
          score: 3.7,
        }),
      ],
    });

    expect(result.answer).toContain("62.5 gram Booster #1555");
    expect(result.answer).toContain("~1 water");
    expect(result.answer).not.toContain("form a slurry");
  });

  it("prefers formula chunks over explanatory composition FAQs for mix requirement questions", () => {
    const result = generateLocalPdfSupportAnswer({
      question:
        "What is the mix ratio and water / booster requirement for FAT LIME concrete?",
      mode: "answer",
      chunks: [
        ...mixCompositionChunks,
        makeChunk({
          label: "S5",
          pageFrom: 21,
          sectionPath: [
            "FAQ MIX COMPOSITION & DESIGN",
            "Why is Booster #1555 added to FAT LIME concrete?",
          ],
          text:
            "FAQ MIX COMPOSITION & DESIGN > Why is Booster #1555 added to FAT LIME concrete?\nAdditives like jaggery and fenugreek are traditional, but MLIME offers Booster #1555 as a controlled way of improving the mix properties.",
          score: 5.2,
        }),
      ],
    });

    expect(result.answer).toContain("1 FAT LIME");
    expect(result.answer).toContain("~1 water");
    expect(result.answer).toContain("62.5 gram Booster #1555");
    expect(result.answer).not.toContain("jaggery");
  });

  it("keeps curing answers focused on curing sections instead of far-away compaction FAQs", () => {
    const result = generateLocalPdfSupportAnswer({
      question: "What is the curing regime after laying?",
      mode: "answer",
      chunks: [
        ...curingChunks,
        makeChunk({
          label: "S3",
          pageFrom: 22,
          sectionPath: ["FAQ COMPACTION"],
          text:
            "FAQ COMPACTION\nDepending on the frequency and intensity of your compacting, it can take 2 to 4 weeks. Only carry on watering or curing the application till 4 weeks from the start date.",
          score: 4.2,
        }),
      ],
    });

    expect(result.answer).toContain("72 hours");
    expect(result.answer).toContain("daily watering");
    expect(result.answer).not.toContain("Depending on the frequency and intensity");
  });
});
