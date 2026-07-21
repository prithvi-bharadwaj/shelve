import { useEffect, useState } from "react";

export const PLACEHOLDER_ROTATION_MS = 5_000;

export const COMMAND_PLACEHOLDERS = [
  'Try “group my trip-planning tabs”',
  'Try “open the tab with the pasta recipe”',
  'Try “what was the price on the laptop page?”',
  'Try “move my GitHub tabs into Work”',
  'Try “rename Research to Reading List”',
  'Try “close duplicate tabs”',
  'Try “merge my shopping groups”',
] as const;

export const CUSTOM_INSTRUCTION_PLACEHOLDERS = [
  "Example: Keep work and personal tabs in separate groups.",
  "Example: Group shopping tabs by product type.",
  "Example: Name coding groups after the project.",
  "Example: Use short group names with one emoji.",
  "Example: Put articles I want to read in a Reading List group.",
] as const;

export function useRotatingPlaceholder(
  placeholders: readonly string[],
  intervalMs = PLACEHOLDER_ROTATION_MS
) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (placeholders.length < 2) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % placeholders.length);
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs, placeholders]);

  return placeholders[index % placeholders.length] ?? "";
}
