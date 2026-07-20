import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ProposedGroup } from "@/types";

export function ReviewGroups({
  groups,
  selected,
  applying,
  onSelectedChange,
  onApply,
  onDiscard,
}: {
  groups: ProposedGroup[];
  selected: Set<number>;
  applying: boolean;
  onSelectedChange: (selected: Set<number>) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="mt-5">
      <div className="mb-3">
        <h1 className="text-base font-semibold tracking-tight">Review groups</h1>
        <p className="mt-1 text-xs text-muted-foreground">Choose which suggestions to create.</p>
      </div>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {groups.map((group, index) => (
          <label
            key={`${group.existingGroupId ?? "new"}-${index}`}
            className="review-item flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-accent"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <Checkbox
              className="mt-0.5"
              checked={selected.has(index)}
              disabled={applying}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                checked ? next.add(index) : next.delete(index);
                onSelectedChange(next);
              }}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">
                {group.name}
                <span className="ml-1.5 font-normal text-muted-foreground">{group.tabIds.length}</span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">{group.tabTitles.join(" · ")}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={onDiscard} disabled={applying} variant="outline" className="flex-1" size="sm">
          Discard
        </Button>
        <Button onClick={onApply} disabled={!selected.size || applying} className="flex-1" size="sm">
          {applying ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {applying ? "Applying…" : "Apply selected"}
        </Button>
      </div>
    </section>
  );
}
