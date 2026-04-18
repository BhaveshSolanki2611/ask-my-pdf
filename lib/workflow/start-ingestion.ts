import { start } from "workflow/api";
import type { IngestionWorkflowInput } from "@/lib/types";
import { ingestDocumentWorkflow } from "@/workflows/ingest-document";

export async function startDocumentIngestion(input: IngestionWorkflowInput) {
  return start(ingestDocumentWorkflow, [input]);
}
