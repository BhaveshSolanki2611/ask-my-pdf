import type { ChatMode, RetrievedChunk } from "@/lib/types";
import {
  dedupeStrings,
  normalizeWhitespace,
  tokenizeForSearch,
} from "@/lib/utils";

type QuestionIntentKind =
  | "faq"
  | "yesno"
  | "value"
  | "procedure"
  | "explanation";

type QuestionIntent = {
  kind: QuestionIntentKind;
  normalizedQuestion: string;
  questionTerms: string[];
  questionTermSet: Set<string>;
  wantsNumericDetails: boolean;
  wantsTools: boolean;
  wantsComposition: boolean;
  wantsCuring: boolean;
};

type EvidenceSpan = {
  sourceId: string;
  chunkType: RetrievedChunk["chunkType"];
  sectionKey: string;
  sectionTitle: string;
  pageFrom: number;
  pageTo: number;
  confidence: number;
  lines: string[];
  faqQuestion?: string;
  explicitAnswer?: "yes" | "no";
  chunkOrder: number;
};

type Fact = {
  text: string;
  sourceIds: string[];
  order: number;
};

export function generateLocalPdfSupportAnswer(input: {
  question: string;
  mode: ChatMode;
  chunks: RetrievedChunk[];
}) {
  const intent = inferQuestionIntent(input.question);

  if (needsClarification(input.question, intent.questionTerms, input.chunks)) {
    return {
      type: "clarification" as const,
      answer: "",
      clarifyingQuestion: "Which section, topic, or page should I focus on in the PDF?",
      usedSourceIds: [],
      missing: [],
    };
  }

  const spans = buildEvidenceSpans(input.chunks, intent);
  const selected = selectEvidenceSpans(spans, intent);

  if (!selected.length || !hasEnoughSupport(selected, intent)) {
    return {
      type: "answer" as const,
      answer: "I could not find this in the uploaded PDF.",
      usedSourceIds: [],
      missing: ["No relevant PDF excerpts matched the question in local fallback mode."],
    };
  }

  const usedSourceIds = dedupeStrings(selected.flatMap((span) => span.sourceId));
  const answer =
    input.mode === "draft"
      ? buildDraftAnswer(selected, intent)
      : buildGroundedAnswer(selected, intent);

  return {
    type: "answer" as const,
    answer,
    usedSourceIds,
    missing: buildMissingNotes(selected, intent),
  };
}

function inferQuestionIntent(question: string): QuestionIntent {
  const normalizedQuestion = question.trim().toLowerCase();
  const questionTerms = dedupeStrings(tokenizeForSearch(question));
  const questionTermSet = new Set(questionTerms);
  const yesNo = /^(can|is|are|do|does|should|will|would|could|did)\b/i.test(
    normalizedQuestion,
  );
  const wantsNumericDetails =
    /\d/.test(question) ||
    questionTerms.some((term) => VALUE_TERMS.has(term));
  const wantsComposition = questionTerms.some((term) =>
    COMPOSITION_TERMS.has(term),
  );
  const wantsTools = questionTerms.some((term) => TOOL_TERMS.has(term));
  const wantsCuring = /\b(cur(?:e|ed|ing)|watering|72 hours|dry out)\b/i.test(
    question,
  );
  const explicitProcedure = /^(how|steps?|procedure|process)\b/i.test(question);
  const procedure =
    explicitProcedure ||
    (!wantsNumericDetails &&
      !wantsComposition &&
      (wantsCuring || questionTerms.some((term) => PROCEDURE_TERMS.has(term))));

  let kind: QuestionIntentKind = "explanation";

  if (wantsTools && /\bwhat\b/i.test(question)) {
    kind = "explanation";
  } else if (wantsNumericDetails || wantsComposition) {
    kind = "value";
  } else if (procedure) {
    kind = "procedure";
  } else if (yesNo) {
    kind = "yesno";
  }

  return {
    kind,
    normalizedQuestion,
    questionTerms,
    questionTermSet,
    wantsNumericDetails,
    wantsTools,
    wantsComposition,
    wantsCuring,
  };
}

function buildEvidenceSpans(
  chunks: RetrievedChunk[],
  intent: QuestionIntent,
): EvidenceSpan[] {
  const spans = chunks
    .map((chunk, chunkOrder) => buildEvidenceSpan(chunk, chunkOrder, intent))
    .filter((span): span is EvidenceSpan => Boolean(span))
    .sort((left, right) => right.confidence - left.confidence);

  const faqMatch = spans.find(
    (span) =>
      span.faqQuestion &&
      normalizeLine(span.faqQuestion) === intent.normalizedQuestion,
  );

  if (faqMatch && intent.kind !== "procedure") {
    return spans
      .map((span) =>
        span.sourceId === faqMatch.sourceId
          ? { ...span, confidence: span.confidence + 0.7 }
          : span,
      )
      .sort((left, right) => right.confidence - left.confidence);
  }

  return spans;
}

function buildEvidenceSpan(
  chunk: RetrievedChunk,
  chunkOrder: number,
  intent: QuestionIntent,
): EvidenceSpan | null {
  const sectionKey = chunk.sectionPath.join(" > ");
  const sectionTitle = chunk.sectionPath.at(-1) ?? "";
  const body = cleanChunkBody(chunk);
  const baseLines = collapseWrappedEvidenceLines(
    body.split("\n").map(cleanEvidenceLine).filter(Boolean),
    chunk.chunkType,
  );

  if (!baseLines.length) {
    return null;
  }

  if (chunk.chunkType === "faq") {
    const faqSpan = buildFaqSpan(chunk, chunkOrder, intent, sectionKey, sectionTitle);

    if (faqSpan) {
      return faqSpan;
    }
  }

  const lineScores = baseLines.map((line, index) => ({
    line,
    index,
    score: scoreEvidenceLine(line, sectionTitle, intent),
  }));
  const selectedLines = selectRelevantLines(baseLines, lineScores, intent);

  if (!selectedLines.length) {
    return null;
  }

  const bestScore = Math.max(...lineScores.map((item) => item.score));
  const confidence =
    bestScore +
    Math.min(1.2, (chunk.score ?? 0) * 0.14) +
    (intent.wantsNumericDetails && hasNumericSignal(selectedLines) ? 0.25 : 0) +
    (intent.wantsComposition && hasCompositionFormulaSignal(selectedLines) ? 0.9 : 0) +
    (intent.wantsComposition &&
    /^\d/.test(sectionTitle) &&
    hasNumericSignal(selectedLines) &&
    selectedLines.some((line) => hasCompositionSignal(line))
      ? 0.75
      : 0) +
    (intent.wantsComposition &&
    isExplanatoryCompositionSection(sectionTitle) &&
    !hasCompositionFormulaSignal(selectedLines)
      ? -1.25
      : 0) +
    (intent.wantsTools && hasToolSignal(selectedLines.join(" ")) ? 0.3 : 0) +
    (intent.kind === "procedure" ? 0.15 : 0);

  return {
    sourceId: chunk.label,
    chunkType: chunk.chunkType,
    sectionKey,
    sectionTitle,
    pageFrom: chunk.pageFrom,
    pageTo: chunk.pageTo,
    confidence,
    lines: selectedLines,
    chunkOrder,
  };
}

function buildFaqSpan(
  chunk: RetrievedChunk,
  chunkOrder: number,
  intent: QuestionIntent,
  sectionKey: string,
  sectionTitle: string,
): EvidenceSpan | null {
  const match = cleanChunkBody(chunk).match(/Question:\s*(.+?)\nAnswer:\s*([\s\S]+)/i);

  if (!match) {
    return null;
  }

  const faqQuestion = cleanEvidenceLine(match[1]);
  const answerText = normalizeWhitespace(match[2]);
  const answerLines = collapseWrappedEvidenceLines(
    answerText.split("\n").map(cleanEvidenceLine).filter(Boolean),
    "faq",
  );

  if (!answerLines.length) {
    return null;
  }

  const confidence =
    Math.max(
      scoreEvidenceLine(faqQuestion, sectionTitle, intent) + 0.65,
      scoreEvidenceLine(answerText, sectionTitle, intent),
    ) +
    Math.min(1.35, (chunk.score ?? 0) * 0.16) +
    0.6 +
    (intent.wantsTools && /\bvibrators?\b/i.test(`${faqQuestion} ${answerText}`) ? 0.35 : 0) +
    (intent.wantsTools && /\bweighted rammers?\b/i.test(answerText) ? 0.25 : 0) -
    (intent.wantsTools && /\bbamboo\b/i.test(faqQuestion) ? 0.15 : 0) -
    (intent.wantsComposition && !hasNumericSignal(answerLines) ? 1.9 : 0);

  return {
    sourceId: chunk.label,
    chunkType: "faq",
    sectionKey,
    sectionTitle,
    pageFrom: chunk.pageFrom,
    pageTo: chunk.pageTo,
    confidence,
    lines: answerLines,
    faqQuestion,
    explicitAnswer: detectYesNoAnswer(answerText),
    chunkOrder,
  };
}

function selectRelevantLines(
  lines: string[],
  lineScores: Array<{ line: string; index: number; score: number }>,
  intent: QuestionIntent,
): string[] {
  if (intent.kind === "procedure") {
    if (lines.length <= 5) {
      return lines;
    }

    return expandAroundTopLine(lines, lineScores, 4);
  }

  if (intent.kind === "value") {
    const relevant = lineScores
      .filter(
        ({ line, score }) =>
          score >= 0.5 ||
          hasNumericSignal([line]) ||
          (intent.wantsComposition && hasCompositionFactSignal(line)) ||
          (intent.wantsTools && hasToolSignal(line)),
      )
      .map(({ line }) => line);

    if (relevant.length) {
      return relevant.slice(0, 5);
    }

    return keepOrderedTopLines(lineScores, 3);
  }

  return expandAroundTopLine(lines, lineScores, 3);
}

function selectEvidenceSpans(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): EvidenceSpan[] {
  const selected: EvidenceSpan[] = [];
  const maxSpans =
    intent.kind === "procedure" || intent.kind === "value" || intent.wantsTools
      ? 4
      : 3;
  const anchor = pickAnchorSpan(spans, intent);

  if (!anchor) {
    return [];
  }

  if (
    anchor.faqQuestion &&
    normalizeLine(anchor.faqQuestion) === intent.normalizedQuestion &&
    intent.kind !== "procedure"
  ) {
    return [anchor];
  }

  selected.push(anchor);

  for (const span of spans) {
    if (selected.some((item) => item.sourceId === span.sourceId)) {
      continue;
    }

    if (!shouldIncludeSpan(span, selected, anchor, intent)) {
      continue;
    }

    selected.push(span);

    if (selected.length >= maxSpans) {
      break;
    }
  }

  return selected;
}

function pickAnchorSpan(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): EvidenceSpan | undefined {
  if (!spans.length) {
    return undefined;
  }

  const exactFaq = spans.find(
    (span) =>
      span.faqQuestion &&
      normalizeLine(span.faqQuestion) === intent.normalizedQuestion,
  );

  if (exactFaq) {
    return exactFaq;
  }

  if (intent.wantsCuring) {
    const curingSpan = spans.find(
      (span) =>
        hasCuringSignal(`${span.sectionTitle} ${span.lines.join(" ")}`) &&
        span.confidence >= (spans[0]?.confidence ?? 0) * 0.68,
    );

    if (curingSpan) {
      return curingSpan;
    }
  }

  if (intent.wantsTools) {
    const toolingSpan = spans.find(
      (span) =>
        span.chunkType !== "faq" &&
        /(tools?|compaction)/i.test(span.sectionKey) &&
        hasToolSignal(span.lines.join(" ")) &&
        span.confidence >= (spans[0]?.confidence ?? 0) * 0.7,
    );

    if (toolingSpan) {
      return toolingSpan;
    }
  }

  if (intent.kind === "value") {
    const numericFormulaSpan = spans.find(
      (span) =>
        span.chunkType !== "faq" &&
        hasNumericSignal(span.lines) &&
        (/^\d/.test(span.sectionTitle) ||
          span.lines.some((line) => hasCompositionSignal(line))) &&
        (!intent.wantsComposition || hasCompositionFormulaSignal(span.lines)),
    );

    if (
      numericFormulaSpan &&
      numericFormulaSpan.confidence >= (spans[0]?.confidence ?? 0) * 0.42
    ) {
      return numericFormulaSpan;
    }
  }

  return spans[0];
}

function shouldIncludeSpan(
  candidate: EvidenceSpan,
  selected: EvidenceSpan[],
  anchor: EvidenceSpan,
  intent: QuestionIntent,
): boolean {
  const sameSection = candidate.sectionKey === anchor.sectionKey;
  const sameRoot =
    candidate.sectionTitle &&
    anchor.sectionTitle &&
    candidate.sectionTitle === anchor.sectionTitle;
  const nearbyPage = Math.abs(candidate.pageFrom - anchor.pageTo) <= 1;
  const strongEnough = candidate.confidence >= anchor.confidence * 0.45;
  const newCoverage = addsCoverage(candidate, selected, intent);

  if (intent.kind === "value" && candidate.chunkType === "faq") {
    return false;
  }

  if (
    intent.wantsCuring &&
    !hasCuringSignal(candidate.lines.join(" ")) &&
    !/curing regime/i.test(candidate.sectionKey)
  ) {
    return false;
  }

  if (sameSection && nearbyPage && strongEnough) {
    return true;
  }

  if (
    intent.kind === "procedure" &&
    nearbyPage &&
    candidate.confidence >= anchor.confidence * 0.35
  ) {
    return true;
  }

  if (
    intent.kind === "value" &&
    candidate.chunkType !== "faq" &&
    ((sameSection || nearbyPage) ||
      (intent.wantsComposition &&
        hasCompositionFormulaSignal(candidate.lines) &&
        newCoverage)) &&
    (candidate.confidence >= anchor.confidence * 0.24 || newCoverage)
  ) {
    return true;
  }

  if (intent.kind === "value") {
    return false;
  }

  if (intent.wantsCuring && hasCuringSignal(candidate.lines.join(" "))) {
    return (
      nearbyPage ||
      /curing regime|post-compaction/i.test(candidate.sectionKey) ||
      (strongEnough && /curing regime|post-compaction/i.test(candidate.sectionKey))
    );
  }

  if (
    intent.wantsTools &&
    (hasToolSignal(candidate.lines.join(" ")) || candidate.chunkType === "faq")
  ) {
    return candidate.confidence >= anchor.confidence * 0.28 || newCoverage;
  }

  if (sameRoot && nearbyPage && newCoverage) {
    return true;
  }

  return strongEnough && newCoverage;
}

function buildGroundedAnswer(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): string {
  switch (resolveIntentKind(spans, intent)) {
    case "faq":
    case "yesno":
      return buildYesNoAnswer(spans, intent);
    case "value":
      return buildValueAnswer(spans, intent);
    case "procedure":
      return buildProcedureAnswer(spans, intent);
    default:
      return buildExplanationAnswer(spans, intent);
  }
}

function buildYesNoAnswer(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): string {
  const exactFaq =
    spans[0]?.faqQuestion &&
    normalizeLine(spans[0].faqQuestion) === intent.normalizedQuestion;
  const lead =
    spans.find((span) => span.explicitAnswer)?.explicitAnswer ??
    detectYesNoAnswer(spans[0]?.lines.join(" ") ?? "");
  const supportingFacts = collectExplanationFacts(
    exactFaq ? [spans[0]] : spans,
    intent,
  ).slice(0, exactFaq ? 1 : 3);
  const intro = lead ? `${capitalize(lead)}.` : "Based on the uploaded PDF:";

  if (!supportingFacts.length) {
    return `${intro} ${formatCitationList([spans[0].sourceId])}`.trim();
  }

  return [
    intro,
    ...supportingFacts.map(
      (fact) => `- ${fact.text} ${formatCitationList(fact.sourceIds)}`,
    ),
  ].join("\n");
}

function buildValueAnswer(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): string {
  const facts = collectValueFacts(spans, intent).slice(0, 8);

  if (!facts.length) {
    return buildExplanationAnswer(spans, intent);
  }

  if (facts.length === 1) {
    return `${facts[0].text} ${formatCitationList(facts[0].sourceIds)}`;
  }

  return [
    "The PDF gives these details:",
    ...facts.map((fact) => `- ${fact.text} ${formatCitationList(fact.sourceIds)}`),
  ].join("\n");
}

function buildProcedureAnswer(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): string {
  const steps = collectProcedureFacts(spans, intent).slice(0, 5);

  if (!steps.length) {
    return buildExplanationAnswer(spans, intent);
  }

  return [
    "The PDF describes the process as:",
    ...steps.map(
      (step, index) =>
        `${index + 1}. ${step.text} ${formatCitationList(step.sourceIds)}`,
    ),
  ].join("\n");
}

function buildExplanationAnswer(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): string {
  const facts = collectExplanationFacts(spans, intent).slice(0, 4);

  if (!facts.length) {
    const fallbackText = spans
      .map((span) => `${span.lines.join(" ")} ${formatCitationList([span.sourceId])}`)
      .join("\n\n");

    return fallbackText || "I could not find this in the uploaded PDF.";
  }

  if (facts.length === 1) {
    return `${facts[0].text} ${formatCitationList(facts[0].sourceIds)}`;
  }

  return [
    "Based on the uploaded PDF:",
    ...facts.map((fact) => `- ${fact.text} ${formatCitationList(fact.sourceIds)}`),
  ].join("\n");
}

function buildDraftAnswer(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): string {
  const facts =
    resolveIntentKind(spans, intent) === "procedure"
      ? collectProcedureFacts(spans, intent)
      : collectExplanationFacts(spans, intent);
  const statements = facts
    .slice(0, 4)
    .map((fact) => `${lowercaseFirst(fact.text)} ${formatCitationList(fact.sourceIds)}`);

  if (!statements.length) {
    return "I could not find this in the uploaded PDF.";
  }

  return `Thank you for your question. Based on the uploaded PDF, ${statements.join(
    " ",
  )}\n\nPlease let us know if you would like the exact page or section reference from the document.`;
}

function resolveIntentKind(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): QuestionIntentKind {
  if (
    spans[0]?.faqQuestion &&
    normalizeLine(spans[0].faqQuestion) === intent.normalizedQuestion
  ) {
    return intent.kind === "procedure" ? "procedure" : "faq";
  }

  return intent.kind;
}

function collectValueFacts(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): Fact[] {
  const facts: Fact[] = [];

  for (const span of spans) {
    const lines = [...span.lines];

    if (
      intent.wantsComposition &&
      /^\d/.test(span.sectionTitle) &&
      !lines.some((line) => normalizeLine(line) === normalizeLine(span.sectionTitle))
    ) {
      lines.unshift(span.sectionTitle);
    }

    for (const line of lines) {
      const compositionFact =
        intent.wantsComposition && hasCompositionFactSignal(line);
      const numericFact = hasNumericSignal([line]);
      const toolingFact = intent.wantsTools && hasToolSignal(line);

      if (!numericFact && !compositionFact && !toolingFact) {
        continue;
      }

      facts.push({
        text: line,
        sourceIds: [span.sourceId],
        order: buildFactOrder(span),
      });
    }
  }

  return dedupeFacts(facts);
}

function collectProcedureFacts(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): Fact[] {
  const facts: Fact[] = [];

  for (const span of spans) {
    const relevantLines = span.lines.filter(
      (line) =>
        intent.wantsCuring
          ? hasCuringSignal(line) || hasNumericSignal([line])
          : scoreProcedureLanguage(line) > 0 ||
            hasNumericSignal([line]) ||
            /^(yes|no)\b/i.test(line),
    );

    for (const line of relevantLines.length ? relevantLines : span.lines) {
      facts.push({
        text: line,
        sourceIds: [span.sourceId],
        order: buildFactOrder(span),
      });
    }
  }

  return dedupeFacts(facts);
}

function collectExplanationFacts(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): Fact[] {
  const facts: Fact[] = [];

  for (const span of spans) {
    if (intent.wantsTools && span.chunkType === "faq" && span.faqQuestion) {
      const toolingFact = buildToolingFaqFact(span);

      if (toolingFact) {
        facts.push({
          text: toolingFact,
          sourceIds: [span.sourceId],
          order: buildFactOrder(span),
        });
        continue;
      }
    }

    const lines = span.lines.filter((line) => {
      if (intent.wantsTools && hasToolSignal(line)) {
        return true;
      }

      if (intent.wantsCuring && hasCuringSignal(line)) {
        return true;
      }

      if (intent.wantsNumericDetails && hasNumericSignal([line])) {
        return true;
      }

      return scoreEvidenceLine(line, span.sectionTitle, intent) > 0.18;
    });

    for (const line of (lines.length ? lines : span.lines).slice(0, 2)) {
      facts.push({
        text: line,
        sourceIds: [span.sourceId],
        order: buildFactOrder(span),
      });
    }
  }

  return dedupeFacts(facts);
}

function dedupeFacts(facts: Fact[]): Fact[] {
  const merged = new Map<string, Fact>();

  for (const fact of facts) {
    const key = normalizeLine(fact.text);
    const existing = merged.get(key);

    if (existing) {
      existing.sourceIds = dedupeStrings(existing.sourceIds.concat(fact.sourceIds));
      existing.order = Math.min(existing.order, fact.order);
      continue;
    }

    merged.set(key, {
      ...fact,
      sourceIds: dedupeStrings(fact.sourceIds),
    });
  }

  return [...merged.values()].sort((left, right) => left.order - right.order);
}

function hasEnoughSupport(spans: EvidenceSpan[], intent: QuestionIntent): boolean {
  const aggregatedTokens = new Set(
    tokenizeForSearch(
      spans
        .flatMap((span) => [
          span.sectionTitle,
          span.faqQuestion ?? "",
          span.lines.join(" "),
        ])
        .join(" "),
    ),
  );
  const overlap = intent.questionTerms.filter((term) => aggregatedTokens.has(term));
  const matchedRatio = overlap.length / Math.max(1, intent.questionTerms.length);
  const exactFaq =
    spans[0]?.faqQuestion &&
    normalizeLine(spans[0].faqQuestion) === intent.normalizedQuestion;
  const procedureSupport =
    intent.kind === "procedure" &&
    spans.some(
      (span) =>
        hasCuringSignal(span.lines.join(" ")) ||
        scoreProcedureLanguage(span.lines.join(" ")) > 0,
    ) &&
    (matchedRatio >= 0.24 || spans.length >= 2);

  return Boolean(
    exactFaq ||
      spans[0]?.explicitAnswer ||
      matchedRatio >= 0.34 ||
      (intent.kind === "value" && spans.some((span) => hasNumericSignal(span.lines))) ||
      procedureSupport,
  );
}

function buildMissingNotes(
  spans: EvidenceSpan[],
  intent: QuestionIntent,
): string[] {
  const aggregatedTokens = new Set(
    tokenizeForSearch(spans.flatMap((span) => span.lines).join(" ")),
  );
  const uncoveredTerms = intent.questionTerms.filter((term) => !aggregatedTokens.has(term));

  if (!uncoveredTerms.length || uncoveredTerms.length < Math.ceil(intent.questionTerms.length / 2)) {
    return [];
  }

  return ["The local fallback could only support part of this question from the PDF text."];
}

function addsCoverage(
  candidate: EvidenceSpan,
  selected: EvidenceSpan[],
  intent: QuestionIntent,
): boolean {
  const seenTokens = new Set(
    tokenizeForSearch(selected.flatMap((span) => span.lines).join(" ")),
  );
  const candidateTokens = tokenizeForSearch(candidate.lines.join(" "));
  const newTerms = candidateTokens.filter(
    (term) => intent.questionTermSet.has(term) && !seenTokens.has(term),
  );

  if (newTerms.length) {
    return true;
  }

  if (intent.wantsNumericDetails && hasNumericSignal(candidate.lines)) {
    return !selected.some((span) => hasNumericSignal(span.lines));
  }

  if (intent.wantsTools && hasToolSignal(candidate.lines.join(" "))) {
    const seenToolTerms = new Set(
      selected.flatMap((span) => extractToolTerms(span.lines.join(" "))),
    );
    return extractToolTerms(candidate.lines.join(" ")).some(
      (term) => !seenToolTerms.has(term),
    );
  }

  if (intent.wantsCuring && hasCuringSignal(candidate.lines.join(" "))) {
    return !selected.some((span) => hasCuringSignal(span.lines.join(" ")));
  }

  return false;
}

function scoreEvidenceLine(
  line: string,
  sectionTitle: string,
  intent: QuestionIntent,
): number {
  const sectionScore = sectionTitle
    ? scoreTextMatch(sectionTitle, intent.questionTermSet) * 0.4
    : 0;

  return (
    scoreTextMatch(line, intent.questionTermSet) +
    sectionScore +
    (intent.wantsNumericDetails && hasNumericSignal([line]) ? 0.7 : 0) +
    (intent.wantsComposition && hasCompositionSignal(line) ? 0.75 : 0) +
    (intent.wantsTools && hasToolSignal(line) ? 0.75 : 0) +
    (intent.wantsCuring && hasCuringSignal(line) ? 0.85 : 0) +
    (intent.kind === "procedure" ? scoreProcedureLanguage(line) : 0)
  );
}

function expandAroundTopLine(
  lines: string[],
  lineScores: Array<{ line: string; index: number; score: number }>,
  maxLines: number,
): string[] {
  const best = [...lineScores].sort((left, right) => right.score - left.score)[0];

  if (!best || best.score <= 0) {
    return lines.slice(0, Math.min(lines.length, maxLines));
  }

  const start = Math.max(0, best.index - 1);
  const end = Math.min(lines.length, start + maxLines);

  return lines.slice(start, end);
}

function keepOrderedTopLines(
  lineScores: Array<{ line: string; index: number; score: number }>,
  maxLines: number,
): string[] {
  return [...lineScores]
    .sort((left, right) => right.score - left.score)
    .slice(0, maxLines)
    .sort((left, right) => left.index - right.index)
    .map(({ line }) => line);
}

function buildFactOrder(span: EvidenceSpan): number {
  return span.pageFrom * 100 + span.chunkOrder;
}

function cleanChunkBody(chunk: RetrievedChunk): string {
  const sectionHeader = chunk.sectionPath.join(" > ");
  const text = normalizeWhitespace(chunk.text);

  if (!sectionHeader) {
    return text;
  }

  const prefix = `${sectionHeader}\n`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function detectYesNoAnswer(text: string): "yes" | "no" | undefined {
  const normalized = normalizeLine(text);

  if (normalized.startsWith("yes")) {
    return "yes";
  }

  if (normalized.startsWith("no")) {
    return "no";
  }

  return undefined;
}

function formatCitationList(sourceIds: string[]): string {
  return `[${dedupeStrings(sourceIds).join(", ")}]`;
}

function scoreTextMatch(text: string, questionTerms: Set<string>): number {
  if (!questionTerms.size) {
    return 0;
  }

  const tokens = dedupeStrings(tokenizeForSearch(text));
  const overlap = tokens.filter((term) => questionTerms.has(term)).length;
  return overlap / Math.max(1, questionTerms.size);
}

function scoreProcedureLanguage(line: string): number {
  return /\b(add|mix|measure|combine|wet|lay|keep|allow|wait|begin|carry|compact|cure|feed|create)\b/i.test(
    line,
  )
    ? 0.42
    : 0;
}

function hasNumericSignal(lines: string[]): boolean {
  return lines.some((line) => /\d/.test(line));
}

function hasCompositionSignal(line: string): boolean {
  return /\b(fat lime|ash|sand|aggregate|water|booster|25kg|ratio|mix)\b/i.test(line);
}

function hasCompositionFactSignal(line: string): boolean {
  return (
    /\bmeasure by (weight|volume)\b/i.test(line) ||
    /\bfor every \d+(?:[.,]\d+)?\s*kg\b/i.test(line) ||
    (/\d/.test(line) && hasCompositionSignal(line))
  );
}

function hasCompositionFormulaSignal(lines: string[]): boolean {
  const normalized = lines.join(" ");
  const numericLines = lines.filter((line) => /\d/.test(line));

  return (
    /\bmeasure by (weight|volume)\b/i.test(normalized) ||
    /\bfor every \d+(?:[.,]\d+)?\s*kg\b/i.test(normalized) ||
    numericLines.filter((line) => hasCompositionSignal(line)).length >= 2
  );
}

function isExplanatoryCompositionSection(sectionTitle: string): boolean {
  return /^(why|should|can|what is the role of|we have)/i.test(sectionTitle.trim());
}

function hasToolSignal(line: string): boolean {
  return /\b(tool|rammer|rammers|vibrator|vibrators|bamboo|mechanical|manual)\b/i.test(
    line,
  );
}

function extractToolTerms(line: string): string[] {
  const terms: string[] = [];

  if (/\bbamboo\b/i.test(line)) {
    terms.push("bamboo");
  }
  if (/\bvibrators?\b/i.test(line)) {
    terms.push("vibrator");
  }
  if (/\brammers?\b/i.test(line)) {
    terms.push("rammer");
  }
  if (/\bmanual\b/i.test(line)) {
    terms.push("manual");
  }
  if (/\bmechanical\b/i.test(line)) {
    terms.push("mechanical");
  }

  return dedupeStrings(terms);
}

function hasCuringSignal(line: string): boolean {
  return /\b(cur(?:e|ing|ed)|watering|72 hours|4-6 days|dry out|embankment)\b/i.test(
    line,
  );
}

function buildToolingFaqFact(span: EvidenceSpan): string | null {
  if (!span.faqQuestion) {
    return null;
  }

  const answerText = span.lines.join(" ");

  if (!answerText) {
    return null;
  }

  if (hasToolSignal(answerText)) {
    return answerText;
  }

  const subject = extractFaqSubject(span.faqQuestion);

  if (!subject) {
    return answerText;
  }

  return `Regarding ${subject}, ${lowercaseFirst(answerText)}`;
}

function extractFaqSubject(question: string): string | null {
  const canMatch = question.match(/^Can\s+(.+?)\s+be used/i);

  if (canMatch?.[1]) {
    return canMatch[1];
  }

  const useMatch = question.match(/^What\s+(.+?)\s+(?:is|are)\s+used/i);

  if (useMatch?.[1]) {
    return useMatch[1];
  }

  return null;
}

function collapseWrappedEvidenceLines(
  lines: string[],
  chunkType: RetrievedChunk["chunkType"],
): string[] {
  if (chunkType === "table" || chunkType === "list") {
    return lines;
  }

  const merged: string[] = [];

  for (const line of lines) {
    const previous = merged.at(-1);

    if (!previous) {
      merged.push(line);
      continue;
    }

    if (shouldMergeWrappedLine(previous, line)) {
      merged[merged.length - 1] = `${previous} ${line}`.replace(/\s+/g, " ").trim();
      continue;
    }

    merged.push(line);
  }

  return merged;
}

function shouldMergeWrappedLine(previous: string, next: string): boolean {
  if (!previous || !next) {
    return false;
  }

  if (looksLikeStandaloneValueRow(previous) || looksLikeStandaloneValueRow(next)) {
    return false;
  }

  if (/[.!?:]$/.test(previous) && /^[A-Z0-9]/.test(next)) {
    return false;
  }

  if (/^[A-Z][A-Z\s/&-]{3,}$/.test(next)) {
    return false;
  }

  return !/[.!?:]$/.test(previous) || /^[a-z(]/.test(next);
}

function looksLikeStandaloneValueRow(line: string): boolean {
  return /^(~?\d+(?:[.,]\d+)?\b|for every \d|measure by\b)/i.test(line);
}

function normalizeLine(value: string): string {
  return cleanEvidenceLine(value).toLowerCase();
}

function cleanEvidenceLine(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/!\[[^\]]*]\([^)]+\)/g, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/?(?:u|strong|em|span|p|div|b|i)[^>]*>/gi, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*\s][^*]*?)\*/g, "$1")
      .replace(/_([^_\s][^_]*?)_/g, "$1")
      .replace(/`([^`]+)`/g, "$1"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function needsClarification(
  question: string,
  questionTerms: string[],
  chunks: RetrievedChunk[],
): boolean {
  const compact = question.trim().toLowerCase();
  const pronounOnly =
    /^(what|why|how|can|is|are|do|does|should|will)\s+(this|that|it|they|those|these)\b/.test(
      compact,
    ) || compact === "this?" || compact === "that?";

  if (!pronounOnly && questionTerms.length >= 2) {
    return false;
  }

  return (
    chunks.length <= 1 ||
    Math.abs((chunks[0]?.score ?? 0) - (chunks[1]?.score ?? 0)) < 0.15
  );
}

function lowercaseFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

const VALUE_TERMS = new Set([
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

const COMPOSITION_TERMS = new Set([
  "aggregate",
  "ash",
  "booster",
  "composition",
  "mix",
  "ratio",
  "sand",
  "water",
]);

const TOOL_TERMS = new Set([
  "bamboo",
  "compact",
  "manual",
  "mechanical",
  "method",
  "rammer",
  "tool",
  "vibrator",
]);

const PROCEDURE_TERMS = new Set([
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
  "start",
  "step",
]);
