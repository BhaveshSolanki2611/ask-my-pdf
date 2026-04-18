import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  LLAMA_CLOUD_API_KEY: z.string().min(1).optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  VERCEL_OIDC_TOKEN: z.string().optional(),
  ANSWER_MODEL: z.string().default("openai/gpt-5.4"),
  EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-large"),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
  CHUNK_TARGET_TOKENS: z.coerce.number().default(800),
  VECTOR_DIMENSIONS: z.coerce.number().default(3072),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function assertAiGatewayConfigured(): void {
  const env = getServerEnv();

  if (!env.AI_GATEWAY_API_KEY && !env.VERCEL_OIDC_TOKEN) {
    throw new Error(
      "No hosted AI credentials are configured. The app will fall back to a local heuristic answer mode.",
    );
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getServerEnv().DATABASE_URL);
}

export function isBlobStorageConfigured(): boolean {
  return Boolean(getServerEnv().BLOB_READ_WRITE_TOKEN);
}

export function isLlamaParseConfigured(): boolean {
  return Boolean(getServerEnv().LLAMA_CLOUD_API_KEY);
}

export function isHostedAiConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}

export function getRuntimeCapabilities() {
  return {
    database: isDatabaseConfigured() ? "postgres" : "local-json",
    storage: isBlobStorageConfigured() ? "vercel-blob" : "local-filesystem",
    parser: isLlamaParseConfigured() ? "llamaparse" : "local-layout-parser",
    ai: isHostedAiConfigured() ? "hosted-model" : "local-heuristic",
  } as const;
}

export function shouldUseInlineIngestion(): boolean {
  return !(
    isDatabaseConfigured() &&
    isBlobStorageConfigured() &&
    isLlamaParseConfigured() &&
    isHostedAiConfigured()
  );
}
