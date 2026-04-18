import type { RetrievedChunk } from "@/lib/types";

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

export const mixCompositionChunks: RetrievedChunk[] = [
  makeChunk({
    label: "S1",
    pageFrom: 11,
    sectionPath: ["1 FAT LIME"],
    text: "1 FAT LIME\n1 ASH\n2.5 coarse sand",
    score: 4.3,
  }),
  makeChunk({
    label: "S2",
    pageFrom: 11,
    sectionPath: ["1 FAT LIME"],
    chunkType: "paragraph",
    text: "1 FAT LIME\n0.5 stone aggregate up to 2\"",
    score: 4.1,
  }),
  makeChunk({
    label: "S3",
    pageFrom: 11,
    sectionPath: ["1 FAT LIME"],
    text: "1 FAT LIME\n~1 water\n62.5 gram Booster #1555",
    score: 4.4,
  }),
  makeChunk({
    label: "S4",
    pageFrom: 11,
    sectionPath: ["1 FAT LIME"],
    text: "1 FAT LIME\nfor every 25kg bag of FAT LIME",
    score: 3.9,
  }),
];

export const curingChunks: RetrievedChunk[] = [
  makeChunk({
    label: "S1",
    pageFrom: 13,
    sectionPath: ["CURING REGIME"],
    text:
      "CURING REGIME\nKeep wet and do not allow the application to dry out.\nThis is critical for the first 72 hours.\nIf possible, make an embankment and allow water to stand on the application for the first 72 hours.\nThereafter, carry on with daily watering.",
    score: 4.5,
  }),
  makeChunk({
    label: "S2",
    pageFrom: 14,
    sectionPath: ["CURING REGIME"],
    text:
      "CURING REGIME\nWait about 4-6 days after laying till the surface is dry enough to work on without tools sticking.\nThen begin phase 2.",
    score: 4.1,
  }),
];

export const compactionChunks: RetrievedChunk[] = [
  makeChunk({
    label: "S1",
    pageFrom: 16,
    sectionPath: ["COMPACTION"],
    text:
      "COMPACTION\nFeed this slurry to the FAT LIME concrete and begin compacting its surface manually with standard heavy round rammers (~12kg).\nMore compacting effort will result in denser, more durable concrete.",
    score: 4.3,
  }),
  makeChunk({
    label: "S2",
    pageFrom: 16,
    sectionPath: ["COMPACTION"],
    text:
      "COMPACTION\nWe recommend compacting 3-4 times a day x 2 weeks, until the tool starts bouncing back and a ringing sound can be heard.",
    score: 4,
  }),
  makeChunk({
    label: "S3",
    pageFrom: 22,
    sectionPath: ["FAQ COMPACTION Is compacting mandatory?"],
    chunkType: "faq",
    text:
      "FAQ COMPACTION Is compacting mandatory?\nQuestion: Can vibrators be used, like those used for RCC slab casting?\nAnswer: Vibrators can be used in the first few days when the mix is still quite wet. They are not essential and not very useful after the first few days. Weighted rammers are essential, whether manual or mechanical.",
    score: 4.6,
  }),
  makeChunk({
    label: "S4",
    pageFrom: 22,
    sectionPath: ["FAQ COMPACTION Is compacting mandatory?"],
    chunkType: "faq",
    text:
      "FAQ COMPACTION Is compacting mandatory?\nQuestion: Can a bamboo stick or a small hand-held wooden tool be used for compaction?\nAnswer: Such light weight tools will compact a 4\"+ thick FAT LIME concrete very slowly and somewhat ineffectively. They are better suited for thinner applications such as wall plasters.",
    score: 4.2,
  }),
];

export const faqPriorityChunks: RetrievedChunk[] = [
  makeChunk({
    label: "S1",
    pageFrom: 20,
    sectionPath: ["FAQ SUBSTRATE"],
    chunkType: "faq",
    text:
      "FAQ SUBSTRATE\nQuestion: Can FAT LIME concrete be used over foam insulation directly?\nAnswer: No! It does not bond with plastic or foam insulation. Use a thin coat of cement concrete.",
    score: 4.8,
  }),
  makeChunk({
    label: "S2",
    pageFrom: 9,
    sectionPath: ["APPROPRIATE SUBSTRATES"],
    text:
      "APPROPRIATE SUBSTRATES\nFAT LIME concrete may be directly applied on stone bed or RCC slabs.",
    score: 2.8,
  }),
];

export const irrelevantChunks: RetrievedChunk[] = [
  makeChunk({
    label: "S1",
    pageFrom: 3,
    sectionPath: ["WHY CHOOSE FAT LIME CONCRETE?"],
    text:
      "WHY CHOOSE FAT LIME CONCRETE?\nFAT LIME concrete can be left exposed and continues to gain strength over time.",
    score: 1.2,
  }),
  makeChunk({
    label: "S2",
    pageFrom: 8,
    sectionPath: ["HANDLING & SAFETY"],
    text:
      "HANDLING & SAFETY\nUse gloves and avoid direct contact with the wet mix.",
    score: 1.1,
  }),
];
