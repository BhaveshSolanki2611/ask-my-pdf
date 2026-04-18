import { embed, embedMany } from "ai";
import { createHash } from "node:crypto";
import { getServerEnv, isHostedAiConfigured } from "@/lib/env";
import { tokenizeForSearch } from "@/lib/utils";

export async function embedQuery(question: string): Promise<number[]> {
  const env = getServerEnv();

  if (!isHostedAiConfigured()) {
    return lexicalEmbedding(question, env.VECTOR_DIMENSIONS);
  }

  const { embedding } = await embed({
    model: env.EMBEDDING_MODEL,
    value: question,
  });

  return embedding;
}

export async function embedChunks(texts: string[]): Promise<number[][]> {
  const env = getServerEnv();

  if (!isHostedAiConfigured()) {
    return texts.map((text) => lexicalEmbedding(text, env.VECTOR_DIMENSIONS));
  }

  const results: number[][] = [];

  for (let index = 0; index < texts.length; index += 16) {
    const batch = texts.slice(index, index + 16);
    const { embeddings } = await embedMany({
      model: env.EMBEDDING_MODEL,
      values: batch,
    });

    results.push(...embeddings);
  }

  return results;
}

function lexicalEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenizeForSearch(text);

  if (!tokens.length) {
    return vector;
  }

  for (const token of tokens) {
    const hash = createHash("sha1").update(token).digest();
    const index = hash.readUInt32BE(0) % dimensions;
    const sign = hash[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (!magnitude) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}
