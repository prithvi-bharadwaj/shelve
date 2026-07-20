import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popup } from "@/popup/Popup";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

let mock: ChromeMock;
let undoResult: Record<string, unknown>;
let hasUndoNow: boolean;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mock = createChromeMock();
  mock.seedLocal({ dataNoticeAck: true, pinPromptDismissed: true });
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
  hasUndoNow = true;
  mock.chrome.runtime.sendMessage.mockImplementation(async (rawMessage: unknown) => {
    const message = rawMessage as { type?: string };
    switch (message?.type) {
      case "hasUndo":
        return { hasUndo: hasUndoNow };
      case "undo":
        return undoResult;
      case "listGroups":
        return { groups: [] };
      case "listStashes":
        return { stashes: [] };
      default:
        return {};
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function clickUndo() {
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const view = render(<Popup />);
  const undoButton = await screen.findByRole("button", { name: "Undo" });
  await vi.waitFor(() => expect(undoButton).toBeEnabled());
  await user.click(undoButton);
  return view;
}

describe("Popup undo outcomes", () => {
  it("shows retry copy and keeps Undo enabled after a partial result", async () => {
    undoResult = { error: "Undo partially restored. Retry Undo to finish.", partial: true, failedCount: 1 };
    const { unmount } = await clickUndo();
    expect(await screen.findByText("Undo partially restored. Retry Undo to finish.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    unmount();
  });

  it("reports skipped tabs honestly on complete success", async () => {
    undoResult = { done: true, tabCount: 1, reopenedCount: 0, skippedCount: 2 };
    hasUndoNow = true;
    const { unmount } = await clickUndo();
    expect(
      await screen.findByText("Restored the available layout — 2 tabs closed since couldn't be brought back")
    ).toBeInTheDocument();
    unmount();
  });

  it("uses the ordinary success copy when nothing was skipped", async () => {
    undoResult = { done: true, tabCount: 3, reopenedCount: 1, skippedCount: 0 };
    const { unmount } = await clickUndo();
    expect(await screen.findByText("Previous tab layout restored")).toBeInTheDocument();
    unmount();
  });
});
