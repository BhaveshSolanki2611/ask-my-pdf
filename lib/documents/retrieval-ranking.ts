import type { StoredChunk } from "@/lib/types";
import { dedupeStrings, tokenizeForSearch } from "@/lib/utils";

type QuestionSignals = {
  normalizedQuestion: string;
  questionTerms: string[];
  questionTermSet: Set<string>;
  isProcedureQuery: boolean;
  isValueQuery: boolean;
  isYesNoQuery: boolean;
  isCompositionQuery: boolean;
  isToolingQuery: boolean;
  isCuringQuery: boolean;
};

export function rerankRetrievedChunks(
  chunks: StoredChunk[],
  question: string,
): StoredChunk[] {
  const signals = buildQuestionSignals(question);

  const baseRanked = chunks
    .map((chunk) => ({
      ...chunk,
      score: baseChunkScore(chunk, signals),
    }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

  const anchor = pickAnchorChunk(baseRanked, signals) ?? baseRanked[0];

  if (!anchor) {
    return [];
  }

  return baseRanked
    .map((chunk) => ({
      ...chunk,
      score:
        (chunk.score ?? 0) +
        continuityBonus(chunk, anchor, signals) +
        supportSignalBonus(chunk, signals),
    }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

export function diversifyRetrievedChunks(
  chunks: StoredChunk[],
  limit: number,
): StoredChunk[] {
  const selected: StoredChunk[] = [];
  const bySection = new Map<string, number>();
  const byPage = new Map<string, number>();
  const anchor = chunks[0];
  const anchorSection = fullSectionKey(anchor);
  const anchorRoot = anchor?.sectionPath[0] ?? "Document";

  for (const chunk of chunks) {
    const sectionKey = fullSectionKey(chunk);
    const pageKey = `${chunk.pageFrom}-${chunk.pageTo}`;
    const sectionHits = bySection.get(sectionKey) ?? 0;
    const pageHits = byPage.get(pageKey) ?? 0;
    const sameAnchorSection = anchorSection && sectionKey === anchorSection;
    const sameAnchorRoot = chunk.sectionPath[0] === anchorRoot;
    const pageGap = anchor ? pageDistance(chunk, anchor) : 99;
    const allowSection =
      sectionHits < 2 ||
      (sameAnchorSection && sectionHits < 4) ||
      (sameAnchorRoot && pageGap <= 1 && sectionHits < 3);
    const allowPage = pageHits < 2 || (sameAnchorSection && pageGap <= 1);

    if (selected.length < limit && allowSection && allowPage) {
      selected.push(chunk);
      bySection.set(sectionKey, sectionHits + 1);
      byPage.set(pageKey, pageHits + 1);
    }
  }

  if (selected.length >= limit) {
    return selected.slice(0, limit);
  }

  for (const chunk of chunks) {
    if (selected.some((item) => item.id === chunk.id)) {
      continue;
    }

    selected.push(chunk);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected.slice(0, limit);
}

function buildQuestionSignals(question: string): QuestionSignals {
  const normalizedQuestion = normalizeQuery(question);
  const questionTerms = dedupeStrings(tokenizeForSearch(question));
  const questionTermSet = new Set(questionTerms);
  const isValueQuery =
    /\d/.test(question) || questionTerms.some((term) => VALUE_QUERY_TERMS.has(term));
  const explicitProcedureQuery = /^(how|steps?|procedure|process)\b/i.test(question);

  return {
    normalizedQuestion,
    questionTerms,
    questionTermSet,
    isProcedureQuery:
      explicitProcedureQuery ||
      (!isValueQuery && questionTerms.some((term) => PROCEDURE_QUERY_TERMS.has(term))),
    isValueQuery,
    isYesNoQuery:
      /^(can|is|are|do|does|should|will|would|could|did)\b/i.test(
        normalizedQuestion,
      ),
    isCompositionQuery: questionTerms.some((term) => COMPOSITION_QUERY_TERMS.has(term)),
    isToolingQuery: questionTerms.some((term) => TOOLING_QUERY_TERMS.has(term)),
    isCuringQuery: /\b(cur(?:e|ed|ing)|watering|72 hours|dry out)\b/i.test(question),
  };
}

function baseChunkScore(chunk: StoredChunk, signals: QuestionSignals): number {
  const haystack = `${chunk.sectionPath.join(" ")} ${chunk.text}`.toLowerCase();
  const lexicalCoverage = tokenOverlapScore(haystack, signals.questionTermSet);
  const phraseBonus = haystack.includes(signals.normalizedQuestion) ? 2.1 : 0;
  const exactSectionBonus = sectionMatchBonus(
    chunk.sectionPath,
    signals.normalizedQuestion,
  );
  const faqBoost =
    chunk.chunkType === "faq" && !signals.isCompositionQuery
      ? faqMatchBonus(chunk.text, signals.normalizedQuestion)
      : 0;
  const procedureBoost =
    signals.isProcedureQuery &&
    (chunk.chunkType === "procedure" ||
      /(mix|lay|cur(?:e|ing|ed)|compact|step|water)/i.test(haystack))
      ? 0.95
      : 0;
  const valueBoost =
    signals.isValueQuery &&
    (chunk.chunkType === "table" || hasNumericDensity(chunk.text))
      ? 0.95
      : 0;
  const compositionBoost =
    signals.isCompositionQuery &&
    /(fat lime|ash|sand|aggregate|water|booster|ratio|mix)/i.test(haystack)
      ? 0.9
      : 0;
  const formulaBoost = signals.isCompositionQuery
    ? compositionFormulaBonus(chunk)
    : 0;
  const faqPenalty = compositionFaqPenalty(chunk, signals);
  const toolingBoost =
    signals.isToolingQuery &&
    /(tool|rammer|rammers|vibrator|vibrators|bamboo|mechanical|manual)/i.test(
      haystack,
    )
      ? 0.95
      : 0;
  const curingBoost =
    signals.isCuringQuery &&
    /(cur(?:e|ing|ed)|watering|72 hours|daily watering|dry out)/i.test(haystack)
      ? 0.9
      : 0;
  const curingSectionBoost =
    signals.isCuringQuery && /curing regime/i.test(chunk.sectionPath.join(" "))
      ? 1.35
      : 0;
  const toolingSectionBoost =
    signals.isToolingQuery &&
    chunk.chunkType !== "faq" &&
    /\b(tools?|compaction)\b/i.test(chunk.sectionPath.join(" "))
      ? 0.65
      : 0;
  const broadToolingFaqPenalty =
    signals.isToolingQuery && !signals.isYesNoQuery && chunk.chunkType === "faq"
      ? -0.25
      : 0;
  const yesNoBoost =
    signals.isYesNoQuery && /^(yes|no)\b/i.test(cleanChunkBody(chunk)) ? 0.7 : 0;
  const specificityBoost =
    Math.max(0, 1.25 - Math.max(0, chunk.pageTo - chunk.pageFrom) * 0.25) +
    Math.min(0.9, chunk.sectionPath.length * 0.18);

  return (
    (chunk.vectorScore ?? 0) * 0.68 +
    (chunk.keywordScore ?? 0) * 0.32 +
    lexicalCoverage +
    phraseBonus +
    exactSectionBonus +
    faqBoost +
    procedureBoost +
    valueBoost +
    compositionBoost +
    formulaBoost +
    faqPenalty +
    toolingBoost +
    curingBoost +
    curingSectionBoost +
    toolingSectionBoost +
    broadToolingFaqPenalty +
    yesNoBoost +
    specificityBoost
  );
}

function continuityBonus(
  chunk: StoredChunk,
  anchor: StoredChunk,
  signals: QuestionSignals,
): number {
  if (chunk.id === anchor.id) {
    return 0;
  }

  const sameSection = fullSectionKey(chunk) === fullSectionKey(anchor);
  const sameRoot = chunk.sectionPath[0] === anchor.sectionPath[0];
  const gap = pageDistance(chunk, anchor);
  let bonus = 0;

  if (sameSection) {
    bonus += 0.55;
  } else if (sameRoot && gap <= 1) {
    bonus += 0.3;
  }

  if (gap === 0) {
    bonus += 0.12;
  } else if (gap === 1) {
    bonus += 0.18;
  }

  if ((signals.isProcedureQuery || signals.isValueQuery) && sameSection && gap <= 1) {
    bonus += 0.3;
  }

  return bonus;
}

function supportSignalBonus(
  chunk: StoredChunk,
  signals: QuestionSignals,
): number {
  const body = cleanChunkBody(chunk);

  if (
    signals.isToolingQuery &&
    chunk.chunkType === "faq" &&
    /(rammer|vibrator|bamboo|mechanical|manual)/i.test(body)
  ) {
    return 0.4;
  }

  if (
    signals.isCompositionQuery &&
    /\b(fat lime|ash|sand|aggregate|water|booster|25kg)\b/i.test(body)
  ) {
    return 0.35;
  }

  if (
    signals.isCuringQuery &&
    /\b(cur(?:e|ing|ed)|72 hours|daily watering|wait about 4-6 days|dry out)\b/i.test(
      body,
    )
  ) {
    return /curing regime/i.test(chunk.sectionPath.join(" ")) ? 0.5 : 0.35;
  }

  if (
    signals.isToolingQuery &&
    chunk.chunkType !== "faq" &&
    /\b(rammer|rammers|vibrator|vibrators|bamboo|mechanical|manual)\b/i.test(body)
  ) {
    return 0.35;
  }

  return 0;
}

function pickAnchorChunk(
  chunks: StoredChunk[],
  signals: QuestionSignals,
): StoredChunk | undefined {
  if (!chunks.length) {
    return undefined;
  }

  const topScore = chunks[0]?.score ?? 0;

  if (signals.isCuringQuery) {
    const curingAnchor = chunks.find(
      (chunk) =>
        isCuringChunk(chunk) && (chunk.score ?? 0) >= topScore * 0.68,
    );

    if (curingAnchor) {
      return curingAnchor;
    }
  }

  if (signals.isToolingQuery && !signals.isYesNoQuery) {
    const toolingAnchor = chunks.find(
      (chunk) =>
        chunk.chunkType !== "faq" &&
        isToolingChunk(chunk) &&
        (chunk.score ?? 0) >= topScore * 0.72,
    );

    if (toolingAnchor) {
      return toolingAnchor;
    }
  }

  return chunks[0];
}

function cleanChunkBody(chunk: StoredChunk): string {
  const sectionHeader = chunk.sectionPath.join(" > ");
  const text = normalizeQuery(chunk.text);

  if (!sectionHeader) {
    return text;
  }

  const prefix = normalizeQuery(`${sectionHeader}\n`);
  return text.startsWith(prefix) ? text.slice(prefix.length).trim() : text;
}

function pageDistance(left: StoredChunk, right: StoredChunk): number {
  if (left.pageFrom <= right.pageTo && right.pageFrom <= left.pageTo) {
    return 0;
  }

  if (left.pageFrom > right.pageTo) {
    return left.pageFrom - right.pageTo;
  }

  return right.pageFrom - left.pageTo;
}

function hasNumericDensity(text: string): boolean {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).length >= 1;
}

function isCuringChunk(chunk: StoredChunk): boolean {
  const haystack = `${chunk.sectionPath.join(" ")} ${cleanChunkBody(chunk)}`;
  return /\b(cur(?:e|ing|ed)|72 hours|daily watering|dry out|watering)\b/i.test(
    haystack,
  );
}

function isToolingChunk(chunk: StoredChunk): boolean {
  const haystack = `${chunk.sectionPath.join(" ")} ${cleanChunkBody(chunk)}`;
  return /\b(tools?|compaction|rammer|rammers|vibrator|vibrators|bamboo|mechanical|manual)\b/i.test(
    haystack,
  );
}

function compositionFormulaBonus(chunk: StoredChunk): number {
  const body = cleanChunkBody(chunk);
  const numericTokens = body.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const ingredientHits = (
    body.match(/\b(fat lime|ash|sand|aggregate|water|booster|bag|weight|volume)\b/gi) ?? []
  ).length;
  const numericHeading = /^\d/.test(chunk.sectionPath.at(-1) ?? "");
  let bonus = 0;

  if (numericHeading) {
    bonus += 1.2;
  }

  if (numericTokens.length >= 1) {
    bonus += Math.min(1.3, numericTokens.length * 0.45);
  }

  if (ingredientHits >= 2) {
    bonus += 0.8;
  }

  if (/\b(measure by volume|measure by weight)\b/i.test(body)) {
    bonus += 0.35;
  }

  return bonus;
}

function compositionFaqPenalty(
  chunk: StoredChunk,
  signals: QuestionSignals,
): number {
  if (!signals.isCompositionQuery || chunk.chunkType !== "faq") {
    return 0;
  }

  const match = cleanChunkBody(chunk).match(/question:\s*(.+?)\s+answer:\s*([\s\S]+)/i);
  const faqQuestion = normalizeQuery(match?.[1] ?? "");
  const numericTokens = cleanChunkBody(chunk).match(/\d+(?:[.,]\d+)?/g) ?? [];

  if (!faqQuestion) {
    return -1.8;
  }

  if (
    faqQuestion === signals.normalizedQuestion ||
    faqQuestion.includes(signals.normalizedQuestion) ||
    signals.normalizedQuestion.includes(faqQuestion)
  ) {
    return 0;
  }

  let penalty = 1.6;

  if (!/\b(ratio|mix|water|booster|quantity|how much|proportion)\b/i.test(faqQuestion)) {
    penalty += 0.6;
  }

  if (numericTokens.length < 2) {
    penalty += 0.6;
  }

  return -penalty;
}

function fullSectionKey(chunk?: Pick<StoredChunk, "sectionPath">): string {
  return chunk?.sectionPath.join(" > ") || "Document";
}

function tokenOverlapScore(text: string, questionTerms: Set<string>): number {
  if (!questionTerms.size) {
    return 0;
  }

  const tokens = dedupeStrings(tokenizeForSearch(text));
  const overlap = tokens.filter((term) => questionTerms.has(term)).length;

  return overlap / Math.max(1, questionTerms.size);
}

function faqMatchBonus(text: string, question: string): number {
  const match = text.match(/Question:\s*(.+?)\nAnswer:/is);
  const faqQuestion = match?.[1] ? normalizeQuery(match[1]) : "";

  if (!faqQuestion) {
    return 0;
  }

  if (faqQuestion === question) {
    return 3.2;
  }

  if (faqQuestion.includes(question) || question.includes(faqQuestion)) {
    return 2.2;
  }

  const faqTerms = new Set(dedupeStrings(tokenizeForSearch(faqQuestion)));
  const questionTerms = dedupeStrings(tokenizeForSearch(question));
  const overlap = questionTerms.filter((term) => faqTerms.has(term)).length;

  return overlap >= Math.max(2, Math.floor(questionTerms.length * 0.6)) ? 1.4 : 0;
}

function sectionMatchBonus(sectionPath: string[], question: string): number {
  const deepest = normalizeQuery(sectionPath.at(-1) ?? "");

  if (!deepest) {
    return 0;
  }

  if (deepest === question) {
    return 3.2;
  }

  if (deepest.includes(question) || question.includes(deepest)) {
    return 2.25;
  }

  const sectionTerms = new Set(dedupeStrings(tokenizeForSearch(deepest)));
  const questionTerms = dedupeStrings(tokenizeForSearch(question));
  const overlap = questionTerms.filter((term) => sectionTerms.has(term)).length;

  return overlap >= Math.max(2, Math.floor(questionTerms.length * 0.6)) ? 1.15 : 0;
}

function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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
