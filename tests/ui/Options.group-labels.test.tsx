import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Options } from "@/options/Options";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

let mock: ChromeMock;

beforeEach(() => {
  mock = createChromeMock();
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
});

describe("Options group label preferences", () => {
  it("restores the saved style, keeps the switches mutually exclusive, and persists on save", async () => {
    mock.seedSync({ groupNameStyle: "emoji" });
    const user = userEvent.setup();
    const { unmount } = render(<Options />);
    const monochrome = await screen.findByRole("switch", { name: /Monochrome group labels/ });
    const emoji = screen.getByRole("switch", { name: /Emoji group labels/ });

    await waitFor(() => expect(emoji).toBeChecked());
    expect(monochrome).not.toBeChecked();

    await user.click(monochrome);
    expect(monochrome).toBeChecked();
    expect(emoji).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mock.syncData.groupNameStyle).toBe("monochrome"));

    await user.click(monochrome);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mock.syncData.groupNameStyle).toBe("text"));
    unmount();
  });
});
