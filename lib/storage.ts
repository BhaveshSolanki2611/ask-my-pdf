import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cwd } from "node:process";
import { Readable } from "node:stream";
import { get, put } from "@vercel/blob";
import {
  canUseLocalPersistence,
  getDocumentPersistenceErrorMessage,
  isBlobStorageConfigured,
} from "@/lib/env";
import { sanitizeFilename, summarizeError } from "@/lib/utils";

const LOCAL_UPLOADS_DIR = join(cwd(), ".local-data", "uploads");

function normalizeBlobStorageError(error: unknown): Error {
  const message = summarizeError(error);

  if (/cannot use private access on a public store/i.test(message)) {
    return new Error(
      "This deployment is linked to a public Vercel Blob store, but uploaded PDFs require a private Blob store. Replace BLOB_READ_WRITE_TOKEN with a token from a private store.",
    );
  }

  return error instanceof Error ? error : new Error(message);
}

async function ensureLocalUploadDir(documentId?: string): Promise<string> {
  const target = documentId ? join(LOCAL_UPLOADS_DIR, documentId) : LOCAL_UPLOADS_DIR;
  await mkdir(target, { recursive: true });
  return target;
}

export async function uploadDocumentSource(
  documentId: string,
  file: File,
): Promise<{ pathname: string; url: string }> {
  const pathname = `documents/${documentId}/${Date.now()}-${sanitizeFilename(file.name)}`;

  if (!isBlobStorageConfigured()) {
    if (!canUseLocalPersistence()) {
      throw new Error(getDocumentPersistenceErrorMessage());
    }

    const targetDir = await ensureLocalUploadDir(documentId);
    const localPath = join(targetDir, `${Date.now()}-${sanitizeFilename(file.name)}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(localPath, buffer);

    return {
      pathname: localPath,
      url: `/api/documents/${documentId}/source`,
    };
  }

  let blob;

  try {
    blob = await put(pathname, file, {
      access: "private",
      addRandomSuffix: false,
      multipart: file.size > 5_000_000,
    });
  } catch (error) {
    throw normalizeBlobStorageError(error);
  }

  return {
    pathname: blob.pathname,
    url: blob.url,
  };
}

export async function getDocumentSource(pathname: string) {
  if (!isBlobStorageConfigured()) {
    if (!canUseLocalPersistence()) {
      throw new Error(getDocumentPersistenceErrorMessage());
    }

    return {
      statusCode: 200,
      stream: createReadStream(pathname),
      blob: {
        contentType: "application/pdf",
      },
    };
  }

  let result;

  try {
    result = await get(pathname, { access: "private" });
  } catch (error) {
    throw normalizeBlobStorageError(error);
  }

  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("Document source could not be found in blob storage.");
  }

  return result;
}

export async function downloadDocumentSourceBuffer(
  pathname: string,
): Promise<Buffer> {
  const result = await getDocumentSource(pathname);
  const stream =
    result.stream instanceof Readable
      ? (Readable.toWeb(result.stream) as ReadableStream<Uint8Array>)
      : result.stream;
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}
