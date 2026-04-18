import { NextResponse } from "next/server";
import { z } from "zod";
import { generatePdfSupportAnswer } from "@/lib/ai/answer";
import { embedQuery } from "@/lib/ai/embeddings";
import {
  getDocumentById,
  resolveSourcesFromChunks,
  searchDocumentChunks,
} from "@/lib/db/documents";
import { labelRetrievedChunks } from "@/lib/documents/retrieval";
import { needsDocumentReingestion } from "@/lib/documents/version";
import { summarizeError } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  documentId: z.string().min(1),
  question: z.string().trim().min(3),
  mode: z.enum(["answer", "draft"]).default("answer"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1),
      }),
    )
    .default([]),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const document = await getDocumentById(payload.documentId);

    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    if (document.status !== "ready") {
      return NextResponse.json(
        { error: "The PDF is still processing. Wait until the document is ready." },
        { status: 409 },
      );
    }

    if (needsDocumentReingestion(document)) {
      return NextResponse.json(
        { error: "This PDF is refreshing its document map. Please wait a moment and ask again." },
        { status: 409 },
      );
    }

    const queryEmbedding = await embedQuery(payload.question);
    const retrievedChunks = await searchDocumentChunks({
      documentId: payload.documentId,
      question: payload.question,
      embedding: queryEmbedding,
      limit: 12,
    });

    const labelledChunks = labelRetrievedChunks(retrievedChunks);

    if (!labelledChunks.length) {
      return NextResponse.json({
        type: "answer",
        answer: "I could not find this in the uploaded PDF.",
        usedSourceIds: [],
        missing: ["No relevant PDF excerpts were retrieved for this question."],
        sources: [],
      });
    }

    const result = await generatePdfSupportAnswer({
      question: payload.question,
      mode: payload.mode,
      history: payload.history,
      outline: document.outline,
      chunks: labelledChunks,
    });

    return NextResponse.json({
      ...result,
      sources: resolveSourcesFromChunks(labelledChunks, result.usedSourceIds),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: summarizeError(error) },
      { status: 500 },
    );
  }
}
