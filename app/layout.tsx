import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Support Copilot",
  description:
    "Upload a PDF, build a section-aware document map, and answer support questions using grounded retrieval only.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
