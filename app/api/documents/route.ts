import { NextResponse } from "next/server";
import {
  createDocumentRecord,
  markDocumentFailed,
  setDocumentWorkflowRunId,
} from "@/lib/db/documents";
import { performDocumentIngestion } from "@/lib/documents/ingest";
import {
  assertDocumentPersistenceConfigured,
  getServerEnv,
  shouldUseInlineIngestion,
} from "@/lib/env";
import { uploadDocumentSource } from "@/lib/storage";
import { startDocumentIngestion } from "@/lib/workflow/start-ingestion";
import { isDeploymentSetupErrorMessage, summarizeError } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

function looksLikePdf(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

function workflowRunIdFromResult(result: unknown): string | null {
  if (
    result &&
    typeof result === "object" &&
    "id" in result &&
    typeof result.id === "string"
  ) {
    return result.id;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    assertDocumentPersistenceConfigured();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Attach a PDF file in the `file` field." },
        { status: 400 },
      );
    }

    if (!looksLikePdf(file)) {
      return NextResponse.json(
        { error: "Only PDF uploads are supported." },
        { status: 400 },
      );
    }

    if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `This file exceeds the ${env.MAX_UPLOAD_MB} MB upload limit.` },
        { status: 400 },
      );
    }

    const documentId = crypto.randomUUID();
    const blob = await uploadDocumentSource(documentId, file);

    await createDocumentRecord({
      id: documentId,
      filename: file.name,
      blobPath: blob.pathname,
      blobUrl: blob.url,
    });

    if (shouldUseInlineIngestion()) {
      await performDocumentIngestion({
        documentId,
        filename: file.name,
        blobPath: blob.pathname,
      });

      return NextResponse.json({
        documentId,
        redirectTo: `/documents/${documentId}`,
      });
    }

    try {
      const workflowRun = await startDocumentIngestion({
        documentId,
        filename: file.name,
        blobPath: blob.pathname,
      });

      const workflowRunId = workflowRunIdFromResult(workflowRun);

      if (workflowRunId) {
        await setDocumentWorkflowRunId(documentId, workflowRunId);
      }
    } catch (error) {
      try {
        await performDocumentIngestion({
          documentId,
          filename: file.name,
          blobPath: blob.pathname,
        });
      } catch (inlineError) {
        await markDocumentFailed(documentId, inlineError);
        throw inlineError;
      }
    }

    return NextResponse.json({
      documentId,
      redirectTo: `/documents/${documentId}`,
    });
  } catch (error) {
    const message = summarizeError(error);
    const status = isDeploymentSetupErrorMessage(message) ? 503 : 500;

    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
