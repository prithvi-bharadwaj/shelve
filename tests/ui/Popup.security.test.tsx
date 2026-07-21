import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popup } from "@/popup/Popup";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let mock: ChromeMock;
let releaseInitialLocalGet: () => void;

// Holds the popup's very first storage.local.get (the dataNoticeAck read) until
// the test releases it; every later read hits the seeded storage area normally.
function deferInitialLocalGet() {
  const deferred = createDeferred<void>();
  const original = mock.chrome.storage.local.get.getMockImplementation()!;
  mock.chrome.storage.local.get.mockImplementationOnce(async (keys?: unknown) => {
    await deferred.promise;
    return original(keys as never);
  });
  releaseInitialLocalGet = deferred.resolve;
}

beforeEach(() => {
  // shouldAdvanceTime lets RTL's waitFor polling fire while the popup's own
  // 450ms organize poll stays under fake-timer control.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mock = createChromeMock();
  mock.seedLocal({ geminiKey: "test-key", pinPromptDismissed: true });
  deferInitialLocalGet();
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
});

afterEach(() => {
  vi.useRealTimers();
});

function organizeButton() {
  return screen.getByRole("button", { name: "Organize tabs" });
}

async function renderResolved() {
  const view = render(<Popup />);
  releaseInitialLocalGet();
  await waitFor(() => expect(organizeButton()).toBeEnabled());
  return view;
}

describe("Popup consent initialization", () => {
  it("keeps organize, command, and destructive actions disabled while storage is unresolved", () => {
    mock.seedLocal({ dataNoticeAck: true });
    const { unmount } = render(<Popup />);
    expect(organizeButton()).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Command" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ungroup" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close duplicates" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    unmount();
  });

  it("enters the disclosure flow instead of organizing when consent is unacknowledged", async () => {
    mock.seedLocal({ dataNoticeAck: false });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const { unmount } = await renderResolved();

    await user.click(organizeButton());
    expect(await screen.findByText(/Sends tab titles & URLs/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Organize tabs" })).toHaveTextContent("Continue organizing");
    await waitFor(() => expect(screen.getByTestId("organize-beam")).toHaveAttribute("data-active"));
    expect(mock.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "organize" })
    );
    unmount();
  });

  it("does not treat the disclosure as accepted before storage resolves", () => {
    mock.seedLocal({ dataNoticeAck: false });
    const { unmount } = render(<Popup />);
    expect(organizeButton()).toBeDisabled();
    expect(organizeButton()).toHaveTextContent("Organize tabs");
    unmount();
  });

  it("enables controls after initialization resolves with acknowledgement", async () => {
    mock.seedLocal({ dataNoticeAck: true });
    const { unmount } = await renderResolved();
    expect(screen.getByRole("textbox", { name: "Command" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ungroup" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Close duplicates" })).toBeEnabled();
    unmount();
  });

  it("offers a pre-addressed feature request email", async () => {
    mock.seedLocal({ dataNoticeAck: true });
    const { unmount } = await renderResolved();
    expect(screen.getByRole("link", { name: "Request a feature" })).toHaveAttribute(
      "href",
      "mailto:prithvi@skive.in?subject=Focused%20feature%20request&body=Hi%20Prithvi%2C%0A%0AI%27d%20like%20to%20request%3A%0A%0A"
    );
    unmount();
  });

  it("requests initial undo state with the freshly fetched window id", async () => {
    mock.currentWindow.id = 42;
    mock.seedLocal({ dataNoticeAck: true });
    const { unmount } = render(<Popup />);
    releaseInitialLocalGet();
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(mock.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "hasUndo", windowId: 42 })
    );
    unmount();
  });
});
