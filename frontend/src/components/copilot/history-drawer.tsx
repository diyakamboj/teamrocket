import { History, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCopilot } from "@/lib/copilot-state";
import type { AgentSessionSummary } from "@/lib/api";

function lastMessagePreview(session: AgentSessionSummary): string {
  const rows = session.messages ?? [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i] as { role?: string; content?: string } | undefined;
    if (row?.content) return row.content;
  }
  return "No messages yet";
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function HistoryDrawer() {
  const { sessions, sessionId, resumeSession, refreshSessions } = useCopilot();

  return (
    <Sheet onOpenChange={(open) => open && void refreshSessions()}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Conversation history"
          title="Conversation history"
          className="h-8 w-8 rounded-lg"
        >
          <History className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[85vw] max-w-sm p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">Conversation history</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-64px)]">
          <div className="space-y-1 p-3">
            {sessions.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No past sessions yet.
              </p>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => resumeSession(session)}
                className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                  session.id === sessionId
                    ? "border-primary/40 bg-primary-soft text-primary-soft-foreground"
                    : "border-transparent hover:bg-secondary"
                }`}
              >
                <span className="flex items-center gap-1.5 truncate font-semibold">
                  <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
                  {session.title || session.candidate_name || "Untitled conversation"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {lastMessagePreview(session)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatTime(session.updated_at)}
                  {session.candidate_name ? ` · ${session.candidate_name}` : ""}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
