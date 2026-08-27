import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpgradeScreen } from "@/popup/UpgradeScreen";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

const CHECKOUT_URL =
  "https://buy.stripe.com/test?client_reference_id=11111111-2222-3333-4444-555555555555";

let mock: ChromeMock;

beforeEach(() => {
  mock = createChromeMock();
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
});

function stubUpgradeInfo(info: { paymentsEnabled: boolean; checkoutUrl: string }) {
  mock.chrome.runtime.sendMessage.mockImplementation(async (rawMessage: unknown) => {
    const message = rawMessage as { type?: string };
    if (message?.type === "getUpgradeInfo") return info;
    return {};
  });
}

describe("UpgradeScreen", () => {
  it("renders both paths with the free key path first and most prominent", async () => {
    stubUpgradeInfo({ paymentsEnabled: true, checkoutUrl: CHECKOUT_URL });
    render(<UpgradeScreen onDismiss={() => undefined} />);

    const freePath = screen.getByRole("button", { name: /Add your own API key — free/ });
    const paidPath = await screen.findByRole("link", { name: /Shelve Hosted — \$5\/mo/ });
    expect(paidPath).toHaveAttribute("href", CHECKOUT_URL);
    expect(paidPath.getAttribute("href")).toContain("client_reference_id=");
    // The free path must precede the paid path in the DOM.
    expect(freePath.compareDocumentPosition(paidPath) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the paid path while payments are disabled, keeping the free path", async () => {
    stubUpgradeInfo({ paymentsEnabled: false, checkoutUrl: "" });
    render(<UpgradeScreen onDismiss={() => undefined} />);

    expect(await screen.findByRole("button", { name: /Add your own API key — free/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Shelve Hosted/ })).not.toBeInTheDocument();
  });

  it("opens the options page from the free path and supports dismissal", async () => {
    stubUpgradeInfo({ paymentsEnabled: false, checkoutUrl: "" });
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<UpgradeScreen dailyLimit onDismiss={onDismiss} />);

    expect(screen.getByText(/out of free actions for today/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add your own API key — free/ }));
    expect(mock.chrome.runtime.openOptionsPage).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
