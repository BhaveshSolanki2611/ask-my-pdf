import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getDocumentById } from "@/lib/db/documents";
import { getDocumentSource } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const document = await getDocumentById(id);

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const source = await getDocumentSource(document.blobPath);
  const stream =
    source.stream instanceof Readable
      ? Readable.toWeb(source.stream) as ReadableStream<Uint8Array>
      : source.stream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": source.blob.contentType ?? "application/pdf",
      "Content-Disposition": `inline; filename="${document.filename}"`,
    },
  });
}
