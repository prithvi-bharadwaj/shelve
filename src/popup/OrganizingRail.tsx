import { ShieldCheck } from "lucide-react";
import type { OrganizeJob, OrganizeStage } from "@/types";

const STAGES: Record<OrganizeStage, { label: string; progress: number }> = {
  collecting: { label: "Reading titles", progress: 18 },
  classifying: { label: "Finding themes", progress: 48 },
  reading: { label: "Reading ambiguous pages", progress: 68 },
  applying: { label: "Creating tab groups", progress: 88 },
};

export function OrganizingRail({ job }: { job: OrganizeJob | null }) {
  // A session-restored job from an older version may carry an unknown stage.
  const stage = STAGES[job?.stage || "collecting"] ?? STAGES.collecting;
  const tabCount = job?.tabCount || 0;
  return (
    <section className="mt-6" aria-live="polite" aria-label={`${stage.label}. Organizing tabs.`}>
      <h1 className="text-xl font-semibold tracking-tight">
        {tabCount ? `Organizing ${tabCount} tabs` : "Organizing tabs"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{stage.label}</p>

      <div className="tab-rail mt-6" aria-hidden="true">
        <div className="tab-rail-line" />
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className="tab-rail-item" style={{ animationDelay: `${index * -0.58}s` }}>
            <span className="tab-rail-notch" />
          </span>
        ))}
        <span className="tab-rail-arrow">→</span>
        <span className="tab-rail-groups">
          <span />
          <span />
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{stage.label}</span>
        <span className="tabular-nums text-foreground">{stage.progress}%</span>
      </div>
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-muted">
        <div
          className="organize-progress h-full origin-left bg-primary transition-transform duration-500 [transition-timing-function:var(--ease-out-strong)]"
          style={{ transform: `scaleX(${stage.progress / 100})` }}
        />
      </div>

      <div className="mt-6 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 text-primary" />
        <span>Safe to close — progress continues</span>
      </div>
    </section>
  );
}
