import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Options } from "@/options/Options";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

let mock: ChromeMock;

beforeEach(() => {
  mock = createChromeMock();
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
  mock.chrome.permissions.request.mockResolvedValue(true);
});

async function selectTypeSafe(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Using the built-in model list.");
  await user.click(screen.getByRole("combobox", { name: "Command routing" }));
  await user.click(await screen.findByRole("option", { name: "TypeSafe Jev — fast typed decisions" }));
}

describe("Options command routing", () => {
  it("requests permission and saves the trimmed key locally and routing in sync", async () => {
    const user = userEvent.setup();
    render(<Options />);
    await selectTypeSafe(user);
    await user.type(screen.getByLabelText("TypeSafe API key"), "  ts-test-key  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mock.localData.typesafeKey).toBe("ts-test-key"));
    expect(mock.syncData.decisionProvider).toBe("typesafe");
    expect(mock.syncData).not.toHaveProperty("typesafeKey");
    expect(mock.chrome.permissions.request).toHaveBeenCalledWith({ origins: ["https://api.typesafe.ai/*"] });
    expect(mock.chrome.permissions.request.mock.invocationCallOrder[0]).toBeLessThan(
      mock.chrome.storage.sync.set.mock.invocationCallOrder[0]
    );
  });

  it.each(["declined", "rejected"])("keeps saving when permission is %s", async (outcome) => {
    const user = userEvent.setup();
    if (outcome === "declined") mock.chrome.permissions.request.mockResolvedValue(false);
    else mock.chrome.permissions.request.mockRejectedValue(new Error("Permission rejected"));
    render(<Options />);
    await selectTypeSafe(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Permission for api.typesafe.ai was declined — commands will keep using your AI provider.")).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(mock.syncData.decisionProvider).toBe("typesafe"));
  });

  it("loads the TypeSafe key from local storage", async () => {
    mock.seedSync({ decisionProvider: "typesafe" });
    mock.seedLocal({ typesafeKey: "ts-saved" });
    render(<Options />);

    expect(await screen.findByLabelText("TypeSafe API key")).toHaveValue("ts-saved");
    expect(screen.getByRole("combobox", { name: "Command routing" })).toHaveTextContent("TypeSafe Jev — fast typed decisions");
  });

  it("falls back to AI routing for an invalid saved decision provider", async () => {
    mock.seedSync({ decisionProvider: "unknown" });
    render(<Options />);
    await screen.findByText("Using the built-in model list.");

    expect(screen.getByRole("combobox", { name: "Command routing" })).toHaveTextContent("AI provider (default)");
    expect(screen.queryByLabelText("TypeSafe API key")).not.toBeInTheDocument();
  });
});
