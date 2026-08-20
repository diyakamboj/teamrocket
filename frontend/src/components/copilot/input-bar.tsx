import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Paperclip } from "lucide-react";
import { useCopilot } from "@/lib/copilot-state";
import { AttachmentChip } from "./attachment-chip";
import { MicButton } from "./voice/mic-button";

export function InputBar({ suggestions }: { suggestions?: string[] | undefined }) {
  const { send, loading, attachments, attachFile, removeAttachment } = useCopilot();
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 140)}px`;
  }, [input]);

  async function submit(text: string) {
    const value = text.trim();
    if (!value || loading) return;
    setInput("");
    await send(value);
    textareaRef.current?.focus();
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) void attachFile(file);
  }

  return (
    <div className="border-t bg-card p-3">
      {suggestions && suggestions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void submit(s)}
              disabled={loading}
              className="rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={removeAttachment} />
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
        className="rounded-2xl border bg-background shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(input);
            }
          }}
          rows={1}
          disabled={loading}
          placeholder="Ask AI anything…"
          className="max-h-36 min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm text-foreground caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-1 px-2 pb-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach a file"
              title="Attach a file"
              onClick={() => fileInputRef.current?.click()}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <MicButton onTranscript={setInput} />
          </div>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send message"
            className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </form>
      <p className="mt-1.5 px-1.5 text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for new line · drag a file to attach
      </p>
    </div>
  );
}
