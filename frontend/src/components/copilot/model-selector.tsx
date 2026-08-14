import { useState } from "react";
import { Check, ChevronDown, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCopilot } from "@/lib/copilot-state";
import { cn } from "@/lib/utils";

export function ModelSelector() {
  const { models, selectedModelId, setSelectedModelId } = useCopilot();
  const [open, setOpen] = useState(false);

  const current = models.find((m) => m.id === selectedModelId) ?? models[0];

  if (models.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
          aria-label="Choose AI model"
        >
          <Cpu className="h-3.5 w-3.5" />
          <span className="max-w-[100px] truncate">{current?.label ?? "Model"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandList>
            <CommandEmpty>No models available.</CommandEmpty>
            <CommandGroup>
              {models.map((model) => (
                <CommandItem
                  key={model.id}
                  value={model.id}
                  onSelect={() => {
                    setSelectedModelId(model.id);
                    setOpen(false);
                  }}
                  className="flex flex-col items-start gap-0.5"
                >
                  <div className="flex w-full items-center gap-2">
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        model.id === selectedModelId ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-medium">{model.label}</span>
                    {model.is_default && (
                      <span className="ml-auto rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-secondary-foreground">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="pl-6 text-[11px] text-muted-foreground">{model.description}</p>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
