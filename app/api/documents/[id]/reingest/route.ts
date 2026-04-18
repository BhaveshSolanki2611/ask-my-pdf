import { NextResponse } from "next/server";
import { getPublicDocument, getDocumentById } from "@/lib/db/documents";
import { performDocumentIngestion } from "@/lib/documents/ingest";
import { assertDocumentPersistenceConfigured } from "@/lib/env";
import { isDeploymentSetupErrorMessage, summarizeError } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertDocumentPersistenceConfigured();
    const { id } = await params;
    const document = await getDocumentById(id);

    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    await performDocumentIngestion({
      documentId: document.id,
      filename: document.filename,
      blobPath: document.blobPath,
    });

    const refreshed = await getPublicDocument(document.id);

    return NextResponse.json(
      refreshed ?? { documentId: document.id, status: "ready" },
    );
  } catch (error) {
    const message = summarizeError(error);
    const status = isDeploymentSetupErrorMessage(message) ? 503 : 500;

    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
