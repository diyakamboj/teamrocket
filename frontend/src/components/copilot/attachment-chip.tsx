import { AlertCircle, FileText, Loader2, X } from "lucide-react";
import type { ChatAttachmentInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachmentInfo;
  onRemove?: (id: string) => void;
}) {
  const processing = attachment.status === "queued" || attachment.status === "processing";
  const failed = attachment.status === "failed";

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium",
        failed ? "border-destructive/40 text-destructive" : "text-foreground",
      )}
      title={attachment.error ?? attachment.extracted_summary ?? attachment.filename}
    >
      {processing ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      ) : failed ? (
        <AlertCircle className="h-3 w-3 shrink-0" />
      ) : (
        <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{attachment.filename}</span>
      <span className="shrink-0 text-muted-foreground">
        {processing ? "processing…" : failed ? "failed" : formatSize(attachment.size_bytes)}
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${attachment.filename}`}
          onClick={() => onRemove(attachment.id)}
          className="ml-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
