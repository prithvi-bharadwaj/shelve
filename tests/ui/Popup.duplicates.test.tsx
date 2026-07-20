import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
            { title: "Project brief", url: "https://docs.example/project" },
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
});
