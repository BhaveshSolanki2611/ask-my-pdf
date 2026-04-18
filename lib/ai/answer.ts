import { Output, generateText } from "ai";
import { z } from "zod";
import { getServerEnv, isHostedAiConfigured } from "@/lib/env";
import { generateLocalPdfSupportAnswer } from "@/lib/ai/local-answer";
import {
  buildPdfAnswerPrompt,
  PDF_SUPPORT_SYSTEM_PROMPT,
} from "@/lib/prompts/pdf-support";
import type {
  ChatHistoryItem,
  ChatMode,
  OutlineEntry,
  RetrievedChunk,
} from "@/lib/types";
import { dedupeStrings } from "@/lib/utils";

const answerSchema = z.object({
  type: z.enum(["answer", "clarification"]),
  answer: z.string().default(""),
  clarifyingQuestion: z.string().default(""),
  usedSourceIds: z.array(z.string().regex(/^S\d+$/)).default([]),
  missing: z.array(z.string()).default([]),
});

export async function generatePdfSupportAnswer(input: {
  question: string;
  mode: ChatMode;
  history: ChatHistoryItem[];
  outline: OutlineEntry[];
  chunks: RetrievedChunk[];
}) {
  if (!isHostedAiConfigured()) {
    return generateLocalPdfSupportAnswer({
      question: input.question,
      mode: input.mode,
      chunks: input.chunks,
    });
  }

  const env = getServerEnv();

  const { output } = await generateText({
    model: env.ANSWER_MODEL,
    system: PDF_SUPPORT_SYSTEM_PROMPT,
    prompt: buildPdfAnswerPrompt(input),
    temperature: 0,
    output: Output.object({
      schema: answerSchema,
    }),
  });

  const validSourceIds = new Set(input.chunks.map((chunk) => chunk.label));

  return {
    type: output.type,
    answer:
      output.type === "clarification"
        ? output.answer || ""
        : output.answer || "I could not find this in the uploaded PDF.",
    clarifyingQuestion:
      output.type === "clarification"
        ? output.clarifyingQuestion ||
          output.answer ||
          "Could you clarify your question?"
        : undefined,
    usedSourceIds: dedupeStrings(
      output.usedSourceIds.filter((sourceId) => validSourceIds.has(sourceId)),
    ),
    missing: dedupeStrings(output.missing),
  };
}
