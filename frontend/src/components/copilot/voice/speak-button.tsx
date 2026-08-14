import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpeechSynthesis } from "./use-speech-synthesis";

export function SpeakButton({ text }: { text: string }) {
  const { supported, speaking, speak, stop } = useSpeechSynthesis();

  if (!supported || !text.trim()) return null;

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={speaking ? "Stop reading aloud" : "Read this response aloud"}
      title={speaking ? "Stop reading aloud" : "Read this response aloud"}
      onClick={() => (speaking ? stop() : speak(text))}
      className="h-6 w-6 rounded-md text-muted-foreground"
    >
      {speaking ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
    </Button>
  );
}
