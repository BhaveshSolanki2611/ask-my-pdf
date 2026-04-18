# PDF Support Copilot

A greenfield Next.js App Router application that turns an uploaded PDF into a support co-pilot. The app stores one PDF per workspace, parses it deeply, builds a section-aware outline, chunks the content for hybrid retrieval, and answers questions using only retrieved PDF evidence.

## What This Build Does

- Accepts one PDF upload at a time and stores the source file in private Vercel Blob storage.
- Starts a durable background ingestion workflow after upload.
- Parses both text PDFs and scanned PDFs through LlamaParse using OCR-capable extraction.
- Builds a heading-aware outline before chunking.
- Keeps tables, warnings, and ordered procedures atomic during chunking.
- Stores chunk text, full-text search vectors, and embeddings in Postgres with pgvector.
- Uses hybrid retrieval for chat: vector similarity plus PostgreSQL full-text search.
- Forces the answer model to cite only retrieved source IDs such as `[S1]`.
- Supports two answer styles:
  - `answer`: direct grounded answer from the PDF
  - `draft`: polished support reply that is still grounded in the PDF

## Implementation Notes

### 1. Upload and workspace creation

- `POST /api/documents` validates that the upload is a PDF and below the configured size limit.
- The original file is written to private blob storage.
- A `documents` row is inserted immediately with status `uploaded`.
- The ingestion workflow starts right after storage succeeds.

### 2. Durable ingestion

- The current Workflow DevKit package is `workflow`, so the app uses `workflow/next` and `workflow/api`.
- The workflow downloads the stored blob, sends it to LlamaParse, builds the outline and chunks, embeds the chunks, persists them, and then marks the document `ready`.
- If the parser reports that the PDF is password-protected or encrypted, the workflow marks the document `failed` with a clear message.

### 3. Section-aware chunking

- Markdown headings from the parser become outline nodes with `title`, `level`, `pageStart`, and `pageEnd`.
- Ordered lists become `procedure` chunks.
- Markdown tables stay intact as `table` chunks.
- Notes and warnings become `warning` chunks.
- Regular prose is merged by section until it reaches the target token size.

### 4. Retrieval and answer generation

- Each user question is embedded and searched against the document with a hybrid query.
- Retrieval combines:
  - vector similarity on `document_chunks.embedding`
  - `websearch_to_tsquery()` ranking on `document_chunks.fts`
- The app labels the top 8 retrieved chunks as `S1` to `S8`.
- The model sees only:
  - the question
  - the selected answer mode
  - recent conversation history
  - the document outline
  - the retrieved excerpts
- The backend resolves cited source IDs back into human-readable page and section labels for the UI.

## Prompt Design

The prompt contract lives in `lib/prompts/pdf-support.ts`.

Key rules enforced there:

- Use only retrieved PDF excerpts.
- Never add outside knowledge.
- Return the exact fallback sentence when the PDF does not answer the question.
- Ask one short clarifying question when ambiguity changes the answer.
- Preserve exact values, steps, warnings, and conditions.
- Use only source IDs like `[S1]`.

## Project Structure

- `app/`: routes, pages, and API handlers
- `components/`: upload, status, outline, and chat UI
- `lib/ai/`: answer generation and embeddings
- `lib/db/`: Postgres access and hybrid retrieval
- `lib/documents/`: outline and chunking logic
- `lib/llama/`: LlamaParse integration
- `lib/workflow/` and `workflows/`: durable ingestion
- `db/schema.sql`: reference schema for Postgres + pgvector

## Environment Variables

Copy `.env.example` to `.env.local` and set:

- `DATABASE_URL`
- `BLOB_READ_WRITE_TOKEN`
- `LLAMA_CLOUD_API_KEY`
- `AI_GATEWAY_API_KEY`

If you do **not** set these, the app now boots in a local fallback mode:

- documents are stored on disk in `.local-data/uploads`
- document metadata and chunks are stored in `.local-data/store.json`
- PDFs are parsed with `pdf-parse`
- answers are generated with a local heuristic summarizer instead of a hosted model

Local fallback is enough to test text-based PDFs end to end. Scanned PDFs still need `LLAMA_CLOUD_API_KEY` so OCR can run.

## Production Deployment Notes

For a Vercel deployment, the app now requires durable document storage before it will accept PDF uploads:

- `DATABASE_URL`
- `BLOB_READ_WRITE_TOKEN`

Without those two variables, the deployed UI will stay online but uploads are intentionally disabled so the app does not fall back to an unsafe serverless filesystem mode.

Optional production upgrades:

- `LLAMA_CLOUD_API_KEY` for scanned-PDF OCR
- `AI_GATEWAY_API_KEY` (or `VERCEL_OIDC_TOKEN`) for hosted answer generation

Optional:

- `ANSWER_MODEL` defaults to `openai/gpt-5.4`
- `EMBEDDING_MODEL` defaults to `openai/text-embedding-3-large`
- `MAX_UPLOAD_MB` defaults to `50`
- `CHUNK_TARGET_TOKENS` defaults to `800`

## Install and Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm run dev
   ```

3. Open `http://localhost:3000`.

### Fastest local test path

If you just want to boot the app without external services:

1. Leave `.env.local` empty or omit it entirely.
2. Run `npm install`
3. Run `npm run dev`
4. Upload a text-based PDF

This path uses the local fallback stack automatically.

## Database Setup

The app auto-runs schema creation for the core tables on first use, but your Postgres database still needs pgvector support enabled so `CREATE EXTENSION vector` succeeds.

If you prefer to inspect or apply the schema yourself, use `db/schema.sql`.

## Suggested Verification Pass

- Upload a normal text PDF and confirm the document reaches `ready`.
- Upload a scanned PDF and confirm OCR content appears in answers.
- Ask for a procedural answer and confirm ordered steps stay in source order.
- Ask about a value in a table and confirm the numeric answer matches the table.
- Ask something absent from the PDF and confirm the fallback sentence is exact.
- Ask an ambiguous question and confirm the app asks one short clarifying question.
- Switch to draft mode and confirm the answer stays polished but source-grounded.

## Current Tradeoffs

- The app keeps chat history client-side for the MVP.
- Vector indexing is functional but intentionally simple; add a dedicated pgvector ANN index once the chunk volume grows.
- The outline depends on heading quality in parser output, but the retrieval layer still works when headings are sparse.
