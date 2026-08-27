import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popup } from "@/popup/Popup";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

let mock: ChromeMock;

beforeEach(() => {
  mock = createChromeMock();
  mock.seedLocal({ dataNoticeAck: true, pinPromptDismissed: true });
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
});

describe("Popup group label preferences", () => {
  it("restores the saved style and keeps the two switches mutually exclusive", async () => {
    mock.seedSync({ groupNameStyle: "emoji" });
    const user = userEvent.setup();
    const { unmount } = render(<Popup />);
    const monochrome = await screen.findByRole("switch", { name: "Monochrome" });
    const emoji = screen.getByRole("switch", { name: "Emoji" });

    await waitFor(() => expect(emoji).toBeChecked());
    expect(monochrome).not.toBeChecked();

    await user.click(monochrome);
    expect(monochrome).toBeChecked();
    expect(emoji).not.toBeChecked();
    await waitFor(() => expect(mock.syncData.groupNameStyle).toBe("monochrome"));

    await user.click(monochrome);
    expect(monochrome).not.toBeChecked();
    expect(emoji).not.toBeChecked();
    await waitFor(() => expect(mock.syncData.groupNameStyle).toBe("text"));
    unmount();
  });
});
