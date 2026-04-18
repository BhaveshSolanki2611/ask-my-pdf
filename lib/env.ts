import { z } from "zod";
import type { RuntimeCapabilities, RuntimeReadiness } from "@/lib/types";

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

export function isVercelDeployment(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.VERCEL_ENV ||
      process.env.VERCEL_URL,
  );
}

export function canUseLocalPersistence(): boolean {
  return !isVercelDeployment();
}

export function canUseFallbackDocumentStore(): boolean {
  return canUseLocalPersistence() || isBlobStorageConfigured();
}

export function isDurableDocumentPersistenceConfigured(): boolean {
  return isBlobStorageConfigured();
}

export function getRuntimeCapabilities(): RuntimeCapabilities {
  const database: RuntimeCapabilities["database"] = isDatabaseConfigured()
    ? "postgres"
    : isVercelDeployment() && isBlobStorageConfigured()
      ? "blob-json"
      : "local-json";

  return {
    database,
    storage: isBlobStorageConfigured() ? "vercel-blob" : "local-filesystem",
    parser: isLlamaParseConfigured() ? "llamaparse" : "local-layout-parser",
    ai: isHostedAiConfigured() ? "hosted-model" : "local-heuristic",
  };
}

export function getRuntimeReadiness(): RuntimeReadiness {
  if (!isVercelDeployment()) {
    return {
      deployment: "local",
      status: "ready",
      uploadsEnabled: true,
      missingEnvVars: [],
      summary: "Local fallback mode is enabled for development.",
      detail:
        "This machine can use on-disk storage locally. For a Vercel deployment, configure BLOB_READ_WRITE_TOKEN for durable uploads. DATABASE_URL is optional and enables the Postgres retrieval backend.",
    };
  }

  if (!isBlobStorageConfigured()) {
    return {
      deployment: "vercel",
      status: "setup-required",
      uploadsEnabled: false,
      missingEnvVars: ["BLOB_READ_WRITE_TOKEN"],
      summary:
        "Uploads are disabled in this deployment until durable storage is configured.",
      detail:
        "Set BLOB_READ_WRITE_TOKEN in Vercel so uploaded PDFs, document metadata, and retrieval chunks persist across requests. Add DATABASE_URL later if you want the Postgres retrieval backend.",
    };
  }

  if (!isDatabaseConfigured()) {
    return {
      deployment: "vercel",
      status: "ready",
      uploadsEnabled: true,
      missingEnvVars: [],
      summary: "This deployment is configured for durable PDF uploads.",
      detail:
        "Uploads, document metadata, and retrieval chunks are persisting in private Vercel Blob storage. Text PDFs are production-ready. Add DATABASE_URL later to switch to the Postgres + pgvector backend, and LLAMA_CLOUD_API_KEY for scanned-PDF OCR.",
    };
  }

  return {
    deployment: "vercel",
    status: "ready",
    uploadsEnabled: true,
    missingEnvVars: [],
    summary: "This deployment is configured for durable PDF uploads.",
    detail:
      "Text PDFs are production-ready. Add LLAMA_CLOUD_API_KEY for scanned-PDF OCR, and AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN for hosted answer generation.",
  };
}

export function getDocumentPersistenceErrorMessage(): string {
  const readiness = getRuntimeReadiness();

  if (readiness.uploadsEnabled) {
    return "Document persistence is configured.";
  }

  return `${readiness.summary} Missing: ${readiness.missingEnvVars.join(", ")}.`;
}

export function assertDocumentPersistenceConfigured(): void {
  if (!getRuntimeReadiness().uploadsEnabled) {
    throw new Error(getDocumentPersistenceErrorMessage());
  }
}

export function shouldUseInlineIngestion(): boolean {
  return !isBlobStorageConfigured();
}

export const __envTestUtils = {
  resetCache() {
    cachedEnv = null;
  },
};
