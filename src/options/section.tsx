export function SectionHeading({ id, children }: { id: string; children: string }) {
  return <h2 id={id} className="text-sm font-semibold tracking-tight">{children}</h2>;
}

export function Divider() {
  return <div className="h-px bg-border" />;
}
