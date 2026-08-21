import { Sparkles } from "lucide-react";
import { useCopilot } from "@/lib/copilot-state";
import { CopilotPanel } from "./copilot-panel";

/** Floating action button, mounted globally in __root.tsx. */
export function CopilotLauncher() {
  const { open, setOpen } = useCopilot();

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-soft)] transition-transform hover:scale-105 active:scale-95"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}
      <CopilotPanel />
    </>
  );
}
