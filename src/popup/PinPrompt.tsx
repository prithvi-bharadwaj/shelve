import { Pin, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PinPrompt({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="mt-4 rounded-lg border border-primary/35 bg-primary/10 p-3" aria-live="polite">
      <div className="flex items-start gap-2.5">
        <Pin className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">Pin Focused to your toolbar</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            Click the <Puzzle className="inline size-3.5 align-[-2px]" aria-label="puzzle-piece" /> icon next to the
            address bar, then hit the pin beside Focused so it&rsquo;s always one click away.
          </p>
          <div className="mt-2">
            <Button onClick={onDismiss} variant="ghost" size="sm">Got it</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
