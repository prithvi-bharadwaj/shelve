import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Options } from "@/options/Options";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type ModelsResponse = { models?: Array<{ id: string; name: string }>; error?: string };

let mock: ChromeMock;
let modelRequests: Map<string, ReturnType<typeof createDeferred<ModelsResponse>>>;

function requestFor(provider: string) {
  if (!modelRequests.has(provider)) modelRequests.set(provider, createDeferred<ModelsResponse>());
  return modelRequests.get(provider)!;
}

beforeEach(() => {
  mock = createChromeMock();
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
  modelRequests = new Map();
  mock.chrome.runtime.sendMessage.mockImplementation(async (rawMessage: unknown) => {
    const message = rawMessage as { type?: string; provider?: string };
    if (message?.type === "listModels") return requestFor(message.provider ?? "unknown").promise;
    return {};
  });
});

async function selectProvider(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("combobox", { name: "AI provider" }));
  await user.click(await screen.findByRole("option", { name }));
}

async function openModelList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Model" }));
}

describe("Options model list races", () => {
  it("ignores a stale response from a previously selected provider", async () => {
    const user = userEvent.setup();
    render(<Options />);
    await screen.findByRole("combobox", { name: "AI provider" });

    await selectProvider(user, "Anthropic");
    await selectProvider(user, "OpenAI");

    requestFor("openai").resolve({ models: [{ id: "gpt-test", name: "GPT Test" }] });
    await waitFor(() =>
      expect(screen.getByText("Fetched live after your provider settings are saved.")).toBeInTheDocument()
    );

    requestFor("anthropic").resolve({ models: [{ id: "claude-test", name: "Claude Test" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole("combobox", { name: "AI provider" })).toHaveTextContent("OpenAI");
    await openModelList(user);
    expect(screen.getByRole("option", { name: "GPT Test" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Claude Test" })).not.toBeInTheDocument();
  });

  it("does not let a late Ollama response set the current provider's model", async () => {
    const user = userEvent.setup();
    render(<Options />);
    await screen.findByRole("combobox", { name: "AI provider" });

    await selectProvider(user, "Ollama");
    await selectProvider(user, "OpenAI");
    requestFor("openai").resolve({ models: [{ id: "gpt-test", name: "GPT Test" }] });
    requestFor("ollama").resolve({ models: [{ id: "llama3", name: "llama3" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole("combobox", { name: "AI provider" })).toHaveTextContent("OpenAI");
    expect(screen.getByRole("combobox", { name: "Model" })).not.toHaveTextContent("llama3");
    await openModelList(user);
    expect(screen.queryByRole("option", { name: "llama3" })).not.toBeInTheDocument();
  });

  it("ignores responses that arrive after unmount", async () => {
    const { unmount } = render(<Options />);
    await screen.findByRole("combobox", { name: "AI provider" });
    unmount();
    requestFor("gemini").resolve({ models: [{ id: "late", name: "Late Model" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
