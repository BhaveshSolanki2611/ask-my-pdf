import { Pool } from "pg";
import { getServerEnv, isDatabaseConfigured } from "@/lib/env";

declare global {
  var __pdfSupportPool: Pool | undefined;
}

export function getDb(): Pool {
  if (!isDatabaseConfigured()) {
    throw new Error(
      "DATABASE_URL is not configured. The app should be using the local JSON store fallback instead of Postgres.",
    );
  }

  if (!global.__pdfSupportPool) {
    global.__pdfSupportPool = new Pool({
      connectionString: getServerEnv().DATABASE_URL,
      max: 10,
    });
  }

  return global.__pdfSupportPool;
}
