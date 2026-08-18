import { useEffect, useRef, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCopilot } from "@/lib/copilot-state";
import { MessageBubble } from "./message-bubble";
import { ToolIndicator } from "./tool-indicator";

export function MessageList({ emptyState }: { emptyState?: ReactNode }) {
  const { messages, loading, toolInFlight, send } = useCopilot();
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
            <p className="text-sm font-semibold">Ask Copilot about your candidates</p>
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
        {loading && <ToolIndicator pending label={toolInFlight ?? undefined} />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
