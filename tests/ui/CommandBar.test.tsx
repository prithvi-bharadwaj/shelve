import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandBar } from "@/popup/CommandBar";
import { Popup } from "@/popup/Popup";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let mock: ChromeMock;
let commandDeferred: ReturnType<typeof createDeferred<unknown>>;

beforeEach(() => {
  mock = createChromeMock();
  mock.seedLocal({ dataNoticeAck: true, pinPromptDismissed: true });
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
  commandDeferred = createDeferred<unknown>();
  mock.chrome.permissions.contains.mockResolvedValue(true);
  mock.chrome.runtime.sendMessage.mockImplementation(async (rawMessage: unknown) => {
    const message = rawMessage as { type?: string };
    if (message?.type === "command") return commandDeferred.promise;
    if (message?.type === "hasUndo") return { hasUndo: false };
    if (message?.type === "listGroups") return { groups: [] };
    if (message?.type === "listStashes") return { stashes: [] };
    return {};
  });
});

function renderBar(overrides: Partial<Parameters<typeof CommandBar>[0]> = {}) {
  const onRunningChange = vi.fn();
  const onAcknowledge = vi.fn(async () => undefined);
  const view = render(
    <CommandBar
      windowId={1}
      disabled={false}
      acknowledged={true}
      onAcknowledge={onAcknowledge}
      onRunningChange={onRunningChange}
      {...overrides}
    />
  );
  return { props: { onRunningChange, onAcknowledge }, view };
}

async function typeAndSubmit(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole("textbox", { name: "Command" }), text);
  await user.keyboard("{Enter}");
}

describe("CommandBar busy propagation", () => {
  it("marks the parent busy before permission and provider work", async () => {
    const user = userEvent.setup();
    const { props } = renderBar();
    await typeAndSubmit(user, "find my tab");
    expect(props.onRunningChange).toHaveBeenCalledWith(true);
    const busyOrder = props.onRunningChange.mock.invocationCallOrder[0];
    const permissionOrder = mock.chrome.permissions.contains.mock.invocationCallOrder[0];
    expect(busyOrder).toBeLessThan(permissionOrder);
    commandDeferred.resolve({ done: true, action: "not_found", reply: "Nothing." });
    await waitFor(() => expect(props.onRunningChange).toHaveBeenLastCalledWith(false));
  });

  it("sends only one command for a rapid double submit", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.type(screen.getByRole("textbox", { name: "Command" }), "find my tab");
    await user.keyboard("{Enter}{Enter}");
    const commandCalls = mock.chrome.runtime.sendMessage.mock.calls.filter(
      (call) => (call[0] as { type?: string })?.type === "command"
    );
    expect(commandCalls).toHaveLength(1);
    commandDeferred.resolve({ done: true, action: "not_found", reply: "Nothing." });
  });

  it("clears busy state when the command rejects", async () => {
    const user = userEvent.setup();
    const { props } = renderBar();
    await typeAndSubmit(user, "find my tab");
    commandDeferred.reject(new Error("port closed"));
    await waitFor(() => expect(props.onRunningChange).toHaveBeenLastCalledWith(false));
    expect(await screen.findByText("Command was interrupted. Try again.")).toBeInTheDocument();
  });

  it("notifies the parent when unmounted mid-request", async () => {
    const user = userEvent.setup();
    const { props, view } = renderBar();
    await typeAndSubmit(user, "find my tab");
    expect(props.onRunningChange).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(props.onRunningChange).toHaveBeenLastCalledWith(false);
  });

  it("disables the popup quick actions until the command settles", async () => {
    const user = userEvent.setup();
    render(<Popup />);
    const ungroup = await screen.findByRole("button", { name: "Ungroup" });
    await waitFor(() => expect(ungroup).toBeEnabled());
    await typeAndSubmit(user, "find my tab");
    expect(screen.getByRole("button", { name: "Ungroup" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close duplicates" })).toBeDisabled();
    commandDeferred.resolve({ done: true, action: "not_found", reply: "Nothing found." });
    await waitFor(() => expect(screen.getByRole("button", { name: "Ungroup" })).toBeEnabled());
  });
});
