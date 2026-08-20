import { useState } from "react";
import { ChevronDown, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/lib/copilot-state";
import { cn } from "@/lib/utils";
import { AttachmentChip } from "./attachment-chip";
import { CopilotMarkdown } from "./markdown";
import { ResultRenderer } from "./structured/result-renderer";
import { ToolIndicator } from "./tool-indicator";
import { SpeakButton } from "./voice/speak-button";

export function MessageBubble({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry?: (text: string) => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  if (message.role === "error") {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
        <p>{message.text}</p>
        {message.retryText && onRetry && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 rounded-lg border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => onRetry(message.retryText!)}
          >
            <RotateCw className="mr-1.5 h-3 w-3" /> Retry
          </Button>
        )}
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={cn("flex flex-col gap-1.5", isUser && "items-end")}>
      <div
        className={cn(
          "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser ? "bg-primary text-white shadow-xs" : "border border-border bg-card text-foreground shadow-xs",
        )}

      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.text}</p>
        ) : (
          <CopilotMarkdown text={message.text} />
        )}

        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} />
            ))}
          </div>
        )}
      </div>

      {!isUser && (
        <div className="flex w-full max-w-[92%] flex-wrap items-center gap-2">
          <ToolIndicator tools={message.tools} />
          <SpeakButton text={message.text} />
        </div>
      )}

      {!isUser && message.structured && (
        <div className="w-full max-w-[92%]">
          <ResultRenderer structured={message.structured} />
        </div>
      )}

      {!isUser && message.citations && message.citations.length > 0 && (
        <div className="w-full max-w-[92%]">
          <button
            type="button"
            onClick={() => setSourcesOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", sourcesOpen && "rotate-180")}
            />
            Sources ({message.citations.length})
          </button>
          {sourcesOpen && (
            <div className="mt-1.5 space-y-1 rounded-lg border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
              {message.citations.map((c, i) => (
                <p key={c.id ?? i} className="truncate">
                  {c.title || c.id || "Citation"}
                  {c.snippet ? ` — ${c.snippet.slice(0, 96)}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
