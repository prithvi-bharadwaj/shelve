import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_PLACEHOLDERS,
  CUSTOM_INSTRUCTION_PLACEHOLDERS,
  useRotatingPlaceholder,
} from "@/lib/rotatingPlaceholders";

afterEach(() => vi.useRealTimers());

describe("rotating examples", () => {
  it("cycles through different command-bar use cases", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRotatingPlaceholder(COMMAND_PLACEHOLDERS, 1_000));

    expect(result.current).toBe(COMMAND_PLACEHOLDERS[0]);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(COMMAND_PLACEHOLDERS[1]);
  });

  it("cycles through different custom-instruction use cases", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRotatingPlaceholder(CUSTOM_INSTRUCTION_PLACEHOLDERS, 1_000));

    expect(result.current).toBe(CUSTOM_INSTRUCTION_PLACEHOLDERS[0]);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(CUSTOM_INSTRUCTION_PLACEHOLDERS[1]);
  });
});
