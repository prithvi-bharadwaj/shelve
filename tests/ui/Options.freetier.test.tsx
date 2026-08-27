import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Options } from "@/options/Options";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

let mock: ChromeMock;

beforeEach(() => {
  mock = createChromeMock();
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
  mock.chrome.runtime.sendMessage.mockImplementation(async (rawMessage: unknown) => {
    const message = rawMessage as { type?: string };
    if (message?.type === "getInstallToken") return { token: "11111111-2222-3333-4444-555555555555" };
    return {};
  });
});

async function renderOptions() {
  render(<Options />);
  await screen.findByRole("combobox", { name: "AI provider" });
}

describe("Options free tier", () => {
  it("hides the Budget/spend section on the shelve provider", async () => {
    await renderOptions();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "AI provider" })).toHaveTextContent("Shelve Free")
    );
    expect(screen.queryByRole("heading", { name: "Budget" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Spend cap/)).not.toBeInTheDocument();
  });

  it("shows the Budget section for key-based providers", async () => {
    mock.seedSync({ provider: "gemini" });
    await renderOptions();
    expect(await screen.findByRole("heading", { name: "Budget" })).toBeInTheDocument();
    expect(screen.getByLabelText("Spend cap ($)")).toBeInTheDocument();
  });

  it("renders an unlimited free tier without a numeric countdown", async () => {
    mock.seedLocal({ freeActionsRemaining: "unlimited" });
    await renderOptions();
    expect(await screen.findByText(/unlimited actions on Shelve's hosted model/)).toBeInTheDocument();
    expect(screen.queryByText(/left\)/)).not.toBeInTheDocument();
  });

  it("shows the remaining count for a metered free tier", async () => {
    mock.seedLocal({ freeActionsRemaining: "12" });
    await renderOptions();
    expect(await screen.findByText(/\(12 left\)/)).toBeInTheDocument();
  });

  it("copies the install token from the background", async () => {
    const user = userEvent.setup();
    await renderOptions();
    await user.click(screen.getByRole("button", { name: /Copy my install code/ }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(mock.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "getInstallToken" });
    await expect(window.navigator.clipboard.readText()).resolves.toBe(
      "11111111-2222-3333-4444-555555555555"
    );
  });

  it("reports a failure when no token is available", async () => {
    mock.chrome.runtime.sendMessage.mockResolvedValue({});
    const user = userEvent.setup();
    await renderOptions();
    await user.click(screen.getByRole("button", { name: /Copy my install code/ }));
    expect(await screen.findByText(/Couldn't copy/)).toBeInTheDocument();
  });
});
