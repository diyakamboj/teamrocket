import { useRef, useState } from "react";
import { MessageSquarePlus, Paperclip, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAppState } from "@/lib/app-state";
import { useCopilot } from "@/lib/copilot-state";
import { HistoryDrawer } from "./history-drawer";
import { InputBar } from "./input-bar";
import { MessageList } from "./message-list";

const GENERIC_SUGGESTIONS = [
  "Show me the top ranked candidates",
  "Which candidates have the fewest gaps?",
  "Give me a must-have coverage report",
];

const CANDIDATE_SUGGESTIONS = [
  "Why did this candidate rank where they did?",
  "What are their biggest gaps?",
  "Draft interview questions for them",
];

const COMPARE_SUGGESTIONS = [
  "Compare these candidates side by side",
  "Who has the strongest ATS score?",
  "What trade-offs should I weigh between them?",
];

/**
 * Context-aware: candidate-in-view takes priority (most specific), then an
 * active compare shortlist, else the generic starter prompts.
 */
function suggestionsFor(viewingCandidateName: string | null, compareCount: number): string[] {
  if (viewingCandidateName) return CANDIDATE_SUGGESTIONS;
  if (compareCount >= 2) return COMPARE_SUGGESTIONS;
  return GENERIC_SUGGESTIONS;
}

export function CopilotPanel() {
  const { open, setOpen, newSession, viewingCandidateName, attachFile, messages } = useCopilot();
  const { backendReady, compareIds } = useAppState();
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const suggestions = suggestionsFor(viewingCandidateName, compareIds.length);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex w-[92vw] max-w-md flex-col gap-0 p-0 sm:max-w-md"
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          for (const file of Array.from(e.dataTransfer.files)) void attachFile(file);
        }}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
            <Paperclip className="h-6 w-6 text-primary" />
            <p className="text-sm font-semibold text-primary">Drop anywhere to attach</p>
          </div>
        )}
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">AI assistant</p>
            <p className="truncate text-xs text-muted-foreground">
              {backendReady ? "Connected" : "Offline"}
            </p>
          </div>
          <HistoryDrawer />
          <Button
            variant="ghost"
            size="icon"
            aria-label="New chat"
            title="New chat"
            className="h-8 w-8 rounded-lg"
            onClick={newSession}
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close AI assistant"
            className="h-8 w-8 rounded-lg"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        {viewingCandidateName && (
          <div className="border-b bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
            Viewing: <span className="font-semibold text-foreground">{viewingCandidateName}</span>
          </div>
        )}

        <MessageList />
        <InputBar suggestions={messages.length === 0 ? suggestions : undefined} />
      </SheetContent>
    </Sheet>
  );
}
