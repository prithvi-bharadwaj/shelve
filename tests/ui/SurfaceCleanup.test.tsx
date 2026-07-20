import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Popup } from "@/popup/Popup";
import { Options } from "@/options/Options";
import { createChromeMock, type ChromeMock } from "../helpers/chromeMock";

let mock: ChromeMock;

beforeEach(() => {
  mock = createChromeMock();
  mock.seedLocal({ dataNoticeAck: true, pinPromptDismissed: true });
  (globalThis as { chrome?: unknown }).chrome = mock.chrome;
});

describe("Popup surface cleanup", () => {
  it("keeps only the three intended quick actions", async () => {
    const { unmount } = render(<Popup />);
    expect(await screen.findByRole("button", { name: "Ungroup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close duplicates" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.queryByText(/Merge windows/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Basic settings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tab monitor/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tabs open\. Do you want to organize/)).not.toBeInTheDocument();
    unmount();
  });
});

describe("Options surface cleanup", () => {
  it("drops merge and monitor controls while keeping core behavior settings", async () => {
    const { unmount } = render(<Options />);
    expect(await screen.findByText("Close duplicate tabs when organizing")).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum tabs per group")).toBeInTheDocument();
    expect(screen.getByLabelText("Review before applying")).toBeInTheDocument();
    expect(screen.queryByText(/Merge windows when organizing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tab monitor/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tab threshold/)).not.toBeInTheDocument();
    unmount();
  });
});
