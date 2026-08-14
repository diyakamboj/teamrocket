import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "./use-voice-input";

export function MicButton({
  onTranscript,
  className,
}: {
  onTranscript: (text: string) => void;
  className?: string;
}) {
  const { supported, recording, toggle } = useVoiceInput(onTranscript);

  if (!supported) return null;

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={recording ? "Stop dictation" : "Dictate with your microphone"}
      title={recording ? "Stop dictation" : "Dictate with your microphone"}
      onClick={toggle}
      className={cn(
        "h-8 w-8 rounded-lg text-muted-foreground",
        recording && "bg-destructive/10 text-destructive",
        className,
      )}
    >
      {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}
