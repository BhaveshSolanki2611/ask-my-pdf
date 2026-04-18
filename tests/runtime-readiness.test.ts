import { afterEach, describe, expect, it } from "vitest";
import {
  __envTestUtils,
  getRuntimeReadiness,
  shouldUseInlineIngestion,
} from "@/lib/env";

const ENV_KEYS = [
  "DATABASE_URL",
  "BLOB_READ_WRITE_TOKEN",
  "LLAMA_CLOUD_API_KEY",
  "AI_GATEWAY_API_KEY",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
];

const originalEnv = new Map(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const originalValue = originalEnv.get(key);

    if (originalValue === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = originalValue;
  }

  __envTestUtils.resetCache();
}

function setEnv(values: Record<string, string | undefined>) {
  restoreEnv();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }

  __envTestUtils.resetCache();
}

afterEach(() => {
  restoreEnv();
});

describe("runtime readiness", () => {
  it("keeps local development fallback enabled without requiring hosted services", () => {
    setEnv({
      VERCEL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_URL: undefined,
      DATABASE_URL: undefined,
      BLOB_READ_WRITE_TOKEN: undefined,
    });

    const readiness = getRuntimeReadiness();

    expect(readiness.deployment).toBe("local");
    expect(readiness.uploadsEnabled).toBe(true);
    expect(readiness.status).toBe("ready");
    expect(shouldUseInlineIngestion()).toBe(true);
  });

  it("marks Vercel deployments without durable storage as setup-required", () => {
    setEnv({
      VERCEL: "1",
      DATABASE_URL: undefined,
      BLOB_READ_WRITE_TOKEN: undefined,
    });

    const readiness = getRuntimeReadiness();

    expect(readiness.deployment).toBe("vercel");
    expect(readiness.status).toBe("setup-required");
    expect(readiness.uploadsEnabled).toBe(false);
    expect(readiness.missingEnvVars).toEqual([
      "DATABASE_URL",
      "BLOB_READ_WRITE_TOKEN",
    ]);
    expect(shouldUseInlineIngestion()).toBe(true);
  });

  it("treats Vercel deployments with durable storage as production-ready even without optional AI keys", () => {
    setEnv({
      VERCEL: "1",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/pdf_support_copilot",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_token",
      LLAMA_CLOUD_API_KEY: undefined,
      AI_GATEWAY_API_KEY: undefined,
    });

    const readiness = getRuntimeReadiness();

    expect(readiness.deployment).toBe("vercel");
    expect(readiness.status).toBe("ready");
    expect(readiness.uploadsEnabled).toBe(true);
    expect(readiness.missingEnvVars).toEqual([]);
    expect(shouldUseInlineIngestion()).toBe(false);
  });
});
