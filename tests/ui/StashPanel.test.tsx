import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StashPanel } from "@/popup/StashPanel";
import { Popup } from "@/popup/Popup";
import type { Stash } from "@/types";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

function stashFixture(overrides: Partial<Stash> = {}): Stash {
  return {
    id: "stash-1",
    name: "Trip",
    color: "blue",
    createdAt: Date.now(),
    tabCount: 2,
    brief: "You were comparing hotels.",
    briefStatus: "ready",
    resumeStatus: "idle",
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof StashPanel>[0]> = {}) {
  const props = {
    groups: [],
    stashes: [stashFixture()],
    busyId: null,
    disabled: false,
    onStash: vi.fn(),
    onResume: vi.fn(),
    onDelete: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<StashPanel {...props} />);
  return props;
}

describe("StashPanel RAM estimates", () => {
  it("labels groups low/med/high from their loaded tab counts", async () => {
    const user = userEvent.setup();
    renderPanel({
      groups: [
        { id: 1, title: "Docs", color: "blue", tabCount: 4, loadedCount: 2 },
        { id: 2, title: "Research", color: "red", tabCount: 5, loadedCount: 4 },
        { id: 3, title: "Media", color: "green", tabCount: 9, loadedCount: 8 },
      ],
    });
    await user.click(screen.getByRole("button", { name: /Groups · 3/i }));
    expect(screen.getByText("low")).toBeInTheDocument();
    expect(screen.getByText("med")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByTitle("Approximate memory use: 8 of 9 tabs loaded")).toBeInTheDocument();
  });
});

describe("StashPanel delete confirmation", () => {
  it("does not delete on the first click", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(screen.getByRole("button", { name: "Delete stash" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Delete this stash?")).toBeInTheDocument();
  });

  it("cancel restores the row without deleting", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(screen.getByRole("button", { name: "Delete stash" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("Delete this stash?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("confirming calls delete exactly once", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(screen.getByRole("button", { name: "Delete stash" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledWith("stash-1");
  });

  it("disables resume and delete while a stash is resuming", () => {
    renderPanel({ stashes: [stashFixture({ resumeStatus: "resuming" })] });
    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete stash" })).toBeDisabled();
    expect(screen.getByText("Resuming this stash…")).toBeInTheDocument();
  });
});

describe("Popup stash delete errors", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mock = createChromeMock();
    mock.seedLocal({ dataNoticeAck: true, pinPromptDismissed: true });
    (globalThis as { chrome?: unknown }).chrome = mock.chrome;
    mock.chrome.runtime.sendMessage.mockImplementation(async (rawMessage: unknown) => {
      const message = rawMessage as { type?: string };
      switch (message?.type) {
        case "hasUndo":
          return { hasUndo: false };
        case "listGroups":
          return { groups: [] };
        case "listStashes":
          return { stashes: [stashFixture()] };
        case "deleteStash":
          return { error: "This stash is being resumed — try again in a moment." };
        default:
          return {};
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the worker's delete failure as an error status", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const { unmount } = render(<Popup />);
    await user.click(await screen.findByRole("button", { name: "Delete stash" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("This stash is being resumed — try again in a moment.")).toBeInTheDocument();
    unmount();
  });
});
