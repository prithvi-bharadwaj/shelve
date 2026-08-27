import type { ReactNode } from "react";

export function QuickAction({
  label,
  title,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  /** Full accessible name when the visible label is abbreviated. */
  title?: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title={title ?? label}
      aria-label={title ?? label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-transparent text-[10px] text-muted-foreground outline-none transition-[color,background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out-strong)] hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      <span className="px-1 text-center leading-tight">{label}</span>
    </button>
  );
}
