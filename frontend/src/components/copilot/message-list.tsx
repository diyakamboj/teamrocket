import { useEffect, useRef, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCopilot } from "@/lib/copilot-state";
import { MessageBubble } from "./message-bubble";
import { ToolIndicator } from "./tool-indicator";

export function MessageList({ emptyState }: { emptyState?: ReactNode }) {
  const { messages, loading, toolInFlight, thinking, send } = useCopilot();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" />
        </span>
        {emptyState ?? (
          <div>
            <p className="text-sm font-semibold">Ask AI about your candidates</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Search, compare, and check requirements — grounded in your evaluation data.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 px-4 py-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} onRetry={(text) => void send(text)} />
        ))}
        {loading && (
          <div className="space-y-1.5">
            <ToolIndicator
              pending
              label={thinking[thinking.length - 1]?.detail ?? toolInFlight ?? undefined}
            />
            {/* Steps the agent already finished, so a slow answer shows its
                working rather than an unchanging spinner. */}
            {thinking.length > 1 && (
              <ul className="ml-5 space-y-0.5 border-l pl-3">
                {thinking.slice(0, -1).map((step, i) => (
                  <li key={`${step.stage}-${i}`} className="text-xs text-muted-foreground/70">
                    {step.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
