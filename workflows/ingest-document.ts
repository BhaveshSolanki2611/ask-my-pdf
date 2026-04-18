import { FatalError } from "workflow";
import { markDocumentFailed } from "@/lib/db/documents";
import { performDocumentIngestion } from "@/lib/documents/ingest";
import type { IngestionWorkflowInput } from "@/lib/types";

export async function ingestDocumentWorkflow(input: IngestionWorkflowInput) {
  "use workflow";

  try {
    return await runIngestion(input);
  } catch (error) {
    await failIngestion(input.documentId, error);
    throw error;
  }
}

async function runIngestion(input: IngestionWorkflowInput) {
  "use step";

  return performDocumentIngestion(input);
}

async function failIngestion(documentId: string, error: unknown) {
  "use step";

  await markDocumentFailed(documentId, error);

  if (error instanceof Error && /password protected|encrypted/i.test(error.message)) {
    throw new FatalError(error.message);
  }
}
