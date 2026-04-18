import type { RetrievedChunk, StoredChunk } from "@/lib/types";

export function labelRetrievedChunks(chunks: StoredChunk[]): RetrievedChunk[] {
  return chunks.map((chunk, index) => ({
    ...chunk,
    label: `S${index + 1}`,
  }));
}
