import { Switch } from "@/components/ui/switch";
import type { GroupNameStyle } from "@/types";

export function GroupStylePicker({
  value,
  disabled,
  onChange,
}: {
  value: GroupNameStyle;
  disabled?: boolean;
  onChange: (style: GroupNameStyle) => void;
}) {
  return (
    <fieldset className="mt-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
      <legend className="sr-only">Group label style</legend>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground">Group labels</span>
        <span className="text-[11px] text-muted-foreground">Both off uses text</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label
          htmlFor="monochrome-group-labels"
          className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background/50 px-2.5 text-xs text-foreground transition-colors duration-150 hover:bg-muted"
        >
          <span>Monochrome</span>
          <Switch
            id="monochrome-group-labels"
            checked={value === "monochrome"}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked ? "monochrome" : "text")}
          />
        </label>
        <label
          htmlFor="emoji-group-labels"
          className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background/50 px-2.5 text-xs text-foreground transition-colors duration-150 hover:bg-muted"
        >
          <span>Emoji</span>
          <Switch
            id="emoji-group-labels"
            checked={value === "emoji"}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked ? "emoji" : "text")}
          />
        </label>
      </div>
    </fieldset>
  );
}
