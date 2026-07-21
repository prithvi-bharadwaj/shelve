import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popup } from "@/popup/Popup";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

let mock: ChromeMock;

beforeEach(() => {
  mock = createChromeMock();
  mock.seedLocal({ dataNoticeAck: true, pinPromptDismissed: true });
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
  mock.chrome.runtime.sendMessage.mockImplementation(async (rawMessage: unknown) => {
    const message = rawMessage as { type?: string };
    switch (message.type) {
      case "cleanDuplicates":
        return {
          done: true,
          closedCount: 2,
          closedTabs: [
            { title: "Project brief", url: "https://docs.example/project", keptTabId: 11 },
            { title: "Issue #42", url: "https://github.example/issues/42" },
          ],
        };
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

describe("duplicate cleanup details", () => {
  it("shows the title and URL of every tab that was closed", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Popup />);
    const button = await screen.findByRole("button", { name: "Close duplicates" });
    await waitFor(() => expect(button).toBeEnabled());

    await user.click(button);

    expect(await screen.findByText("Closed 2 duplicate tabs")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Closed duplicate tabs" })).toBeInTheDocument();
    expect(screen.getByText("Project brief")).toBeInTheDocument();
    expect(screen.getByText("https://docs.example/project")).toBeInTheDocument();
    expect(screen.getByText("Issue #42")).toBeInTheDocument();
    expect(screen.getByText("https://github.example/issues/42")).toBeInTheDocument();
    unmount();
  });

  it("jumps to the surviving tab via View existing, only for entries that have one", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Popup />);
    const button = await screen.findByRole("button", { name: "Close duplicates" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    const viewButtons = await screen.findAllByRole("button", { name: "View existing" });
    expect(viewButtons).toHaveLength(1);
    await user.click(viewButtons[0]);
    expect(mock.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "focusTab", tabId: 11 });
    unmount();
  });

  it("hides the toast when the countdown bar finishes depleting", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Popup />);
    const button = await screen.findByRole("button", { name: "Close duplicates" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    expect(await screen.findByRole("list", { name: "Closed duplicate tabs" })).toBeInTheDocument();
    fireEvent.animationEnd(screen.getByTestId("closed-toast-timer"), {
      animationName: "closed-toast-deplete",
    });
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Closed duplicate tabs" })).not.toBeInTheDocument()
    );
    expect(screen.queryByText("Closed 2 duplicate tabs")).not.toBeInTheDocument();
    unmount();
  });
});
