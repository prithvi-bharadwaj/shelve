import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popup } from "@/popup/Popup";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

let mock: ChromeMock;
let statusResponse: () => unknown;
let sentMessages: Array<{ type?: string }>;

function statusCallCount() {
  return sentMessages.filter((message) => message.type === "organizeStatus").length;
}

const RUNNING_JOB = { id: "job-1", status: "running", stage: "classifying", startedAt: 1, updatedAt: 1, tabCount: 3 };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mock = createChromeMock();
  mock.seedLocal({ dataNoticeAck: true, pinPromptDismissed: true });
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
  sentMessages = [];
  statusResponse = () => ({ job: null });
  mock.chrome.runtime.sendMessage.mockImplementation(async (rawMessage: unknown) => {
    const message = rawMessage as { type?: string };
    sentMessages.push(message);
    switch (message?.type) {
      case "organizeStatus":
        return statusResponse();
      case "organize":
        return { running: true, job: RUNNING_JOB };
      case "consumeOrganizeResult":
        return { cleared: true };
      case "hasUndo":
        return { hasUndo: false };
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

async function renderIdlePopup() {
  const view = render(<Popup />);
  const organize = await screen.findByRole("button", { name: "Organize tabs" });
  await waitFor(() => expect(organize).toBeEnabled());
  return view;
}

describe("organize status polling", () => {
  it("sends one status request on an idle mount and then stops", async () => {
    const { unmount } = await renderIdlePopup();
    const initial = statusCallCount();
    expect(initial).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(statusCallCount()).toBe(initial);
    unmount();
  });

  it("polls repeatedly while a restored job is running and stops when it finishes", async () => {
    statusResponse = () => ({ job: { ...RUNNING_JOB } });
    const { unmount } = render(<Popup />);
    await screen.findByText("Safe to close — progress continues");
    await waitFor(() => expect(screen.getByTestId("window-beam")).toHaveAttribute("data-active"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(statusCallCount()).toBeGreaterThan(2);

    statusResponse = () => ({
      job: { ...RUNNING_JOB, status: "done", result: { done: true, groupCount: 1, tabCount: 2 } },
    });
    await waitFor(() => expect(screen.getByText("1 group · 2 tabs sorted")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("window-beam")).not.toHaveAttribute("data-active"));
    const settled = statusCallCount();
    await vi.advanceTimersByTimeAsync(3000);
    expect(statusCallCount()).toBe(settled);
    unmount();
  });

  it("starts polling when a local organize reports a running job", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const { unmount } = await renderIdlePopup();
    const before = statusCallCount();
    statusResponse = () => ({ job: { ...RUNNING_JOB } });
    await user.click(screen.getByRole("button", { name: "Organize tabs" }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(statusCallCount()).toBeGreaterThan(before + 1);
    unmount();
  });

  it("never overlaps status requests when one is still in flight", async () => {
    statusResponse = () => new Promise(() => {});
    const { unmount } = render(<Popup />);
    await screen.findByRole("button", { name: "Organize tabs" });
    // The mount-time fetch lands on its own async schedule; wait for it before
    // asserting that no further polls pile up behind the still-pending one.
    await waitFor(() => expect(statusCallCount()).toBe(1));
    await vi.advanceTimersByTimeAsync(3000);
    expect(statusCallCount()).toBe(1);
    unmount();
  });
});

describe("review discard", () => {
  it("consumes the job and returns to idle without applying a plan", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    statusResponse = () => ({
      job: {
        ...RUNNING_JOB,
        id: "job-review",
        status: "done",
        result: {
          review: true,
          windowId: 1,
          minSize: 2,
          groups: [{ name: "Docs", color: "blue", tabIds: [1, 2], tabTitles: ["A", "B"] }],
        },
      },
    });
    const { unmount } = render(<Popup />);
    await screen.findByRole("heading", { name: "Review groups" });

    statusResponse = () => ({ job: null });
    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(await screen.findByRole("button", { name: "Organize tabs" })).toBeInTheDocument();
    expect(screen.getByText("Suggestions discarded.")).toBeInTheDocument();
    expect(sentMessages.some((message) => message.type === "applyPlan")).toBe(false);
    expect(
      sentMessages.filter((message) => message.type === "consumeOrganizeResult")
    ).not.toHaveLength(0);
    unmount();
  });
});
