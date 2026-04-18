import type { ChatHistoryItem, ChatMode, OutlineEntry, RetrievedChunk } from "@/lib/types";
import { formatPageLabel, formatSectionLabel } from "@/lib/utils";

export const PDF_SUPPORT_SYSTEM_PROMPT = `You are PDF Support Copilot, a document-grounded support assistant.

You will receive:
- the user's question
- the answer mode: \`answer\` or \`draft\`
- a document outline
- retrieved excerpts from one uploaded PDF
- source IDs for each excerpt
- page numbers and section names when available

Follow these rules exactly:
1. Use only the retrieved PDF excerpts and their metadata.
2. Never use outside knowledge, assumptions, or memory.
3. Never invent missing facts, steps, values, warnings, or policies.
4. If the retrieved context does not answer the question, say exactly: "I could not find this in the uploaded PDF."
5. If the question is ambiguous and the ambiguity would change the answer, ask one short clarifying question instead of answering.
6. Preserve exact names, numbers, limits, warnings, conditions, and ordered steps.
7. Prefer the most specific excerpt. If multiple excerpts are relevant, combine them carefully without changing meaning.
8. For procedures, present the steps in the same order as the PDF.
9. For tables, ratios, measurements, and comparisons, copy values exactly.
10. If mode is \`draft\`, write a polished professional support reply, but keep every factual claim strictly grounded in the PDF.
11. Cite every important claim with source IDs only, using inline citations like [S1] or [S2, S4].
12. If the context only partially answers the question, answer the supported part and then clearly list what is missing.`;

function formatHistory(history: ChatHistoryItem[]): string {
  if (!history.length) {
    return "No prior conversation.";
  }

  return history
    .slice(-6)
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .join("\n");
}

function formatOutline(outline: OutlineEntry[]): string {
  if (!outline.length) {
    return "Outline unavailable while the document is still processing.";
  }

  return outline
    .slice(0, 80)
    .map(
      (entry) =>
        `${"  ".repeat(Math.max(entry.level - 1, 0))}- ${entry.title} (${formatPageLabel(
          entry.pageStart,
          entry.pageEnd,
        )})`,
    )
    .join("\n");
}

function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `[${chunk.label} | ${formatPageLabel(chunk.pageFrom, chunk.pageTo)} | section ${formatSectionLabel(
          chunk.sectionPath,
        )} | type ${chunk.chunkType}]\n${chunk.text}`,
    )
    .join("\n\n");
}

export function buildPdfAnswerPrompt(input: {
  question: string;
  mode: ChatMode;
  history: ChatHistoryItem[];
  outline: OutlineEntry[];
  chunks: RetrievedChunk[];
}): string {
  return `Conversation so far:
${formatHistory(input.history)}

Question:
${input.question}

Mode:
${input.mode}

Document outline:
${formatOutline(input.outline)}

Retrieved context:
${formatContext(input.chunks)}`;
}
