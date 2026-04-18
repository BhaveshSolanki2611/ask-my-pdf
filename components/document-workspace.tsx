"use client";

import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { ChatPanel, type ChatTurn } from "@/components/chat-panel";
import { OutlineSidebar } from "@/components/outline-sidebar";
import { ProcessingStatus } from "@/components/processing-status";
import { RuntimeCapabilityBanner } from "@/components/runtime-capability-banner";
import type { ChatMode, ChatResult, ChatHistoryItem, PublicDocument } from "@/lib/types";
import { summarizeError } from "@/lib/utils";

export function DocumentWorkspace({
  initialDocument,
}: {
  initialDocument: PublicDocument;
}) {
  const [document, setDocument] = useState(initialDocument);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<ChatMode>("answer");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [reingestStarted, setReingestStarted] = useState(false);

  const refreshDocument = useEffectEvent(async () => {
    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const nextDocument = (await response.json()) as PublicDocument;
      setDocument(nextDocument);
    } catch {
      // The next interval will retry, so keep the UI calm here.
    }
  });

  const reingestDocument = useEffectEvent(async () => {
    setReingestStarted(true);
    setChatError(null);
    setDocument((current) => ({
      ...current,
      status: "parsing",
      needsReingestion: false,
      errorMessage: null,
    }));

    try {
      const response = await fetch(`/api/documents/${document.id}/reingest`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "The document could not be refreshed.");
      }

      setDocument(payload as PublicDocument);
    } catch (error) {
      setChatError(summarizeError(error));
      await refreshDocument();
    }
  });

  useEffect(() => {
    if (
      (document.status === "ready" || document.status === "failed") &&
      !document.needsReingestion
    ) {
      return;
    }

    void refreshDocument();
    const intervalId = window.setInterval(() => {
      void refreshDocument();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [document.id, document.needsReingestion, document.status, refreshDocument]);

  useEffect(() => {
    if (
      reingestStarted ||
      document.status !== "ready" ||
      !document.needsReingestion
    ) {
      return;
    }

    void reingestDocument();
  }, [
    document.needsReingestion,
    document.status,
    reingestDocument,
    reingestStarted,
  ]);

  async function sendQuestion(nextQuestion: string) {
    setIsSending(true);
    setChatError(null);

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      content: nextQuestion,
      mode,
    };

    setMessages((current) => [...current, userTurn]);
    setQuestion("");

    try {
      const history: ChatHistoryItem[] = messages.map((message) => ({
        role: message.role,
        content:
          message.role === "assistant" && message.result?.type === "clarification"
            ? message.result.clarifyingQuestion ?? message.content
            : message.content,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentId: document.id,
          question: nextQuestion,
          mode,
          history,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "The copilot could not answer this question.");
      }

      const result = payload as ChatResult;
      const assistantTurn: ChatTurn = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: result.answer,
        mode,
        result,
      };

      setMessages((current) => [...current, assistantTurn]);
    } catch (error) {
      setChatError(summarizeError(error));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-8 lg:px-10">
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          <OutlineSidebar
            chunkCount={document.chunkCount}
            filename={document.filename}
            isReady={document.status === "ready"}
            outline={document.outline}
            sourceUrl={document.sourceUrl}
          />
        </div>

        <div className="space-y-6">
          <RuntimeCapabilityBanner
            capabilities={document.capabilities}
            readiness={document.readiness}
          />
          <ProcessingStatus
            chunkCount={document.chunkCount}
            errorMessage={document.errorMessage}
            needsReingestion={document.needsReingestion}
            pageCount={document.pageCount}
            status={document.status}
          />
          <ChatPanel
            documentStatus={document.status}
            error={chatError}
            isSending={isSending}
            messages={messages}
            mode={mode}
            onModeChange={setMode}
            onQuestionChange={setQuestion}
            onSubmit={(event) => {
              event.preventDefault();

              const nextQuestion = question.trim();

              if (!nextQuestion || isSending || document.status !== "ready") {
                return;
              }

              startTransition(() => {
                void sendQuestion(nextQuestion);
              });
            }}
            question={question}
          />
        </div>
      </div>
    </main>
  );
}
