import { notFound } from "next/navigation";
import { DocumentWorkspace } from "@/components/document-workspace";
import { getPublicDocument } from "@/lib/db/documents";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await getPublicDocument(id);

  if (!document) {
    notFound();
  }

  return <DocumentWorkspace initialDocument={document} />;
}
