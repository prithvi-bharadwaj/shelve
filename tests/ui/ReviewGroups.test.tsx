import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewGroups } from "@/popup/ReviewGroups";
import type { ProposedGroup } from "@/types";

const GROUPS: ProposedGroup[] = [
  { name: "O1 Visa", color: "blue", tabIds: [1, 2], tabTitles: ["USCIS", "Visa guide"], existingGroupId: null },
  { name: "Apartment Hunt", color: "green", tabIds: [3, 4, 5], tabTitles: ["Zillow", "Craigslist", "Map"], existingGroupId: null },
];

function renderReview(overrides: Partial<Parameters<typeof ReviewGroups>[0]> = {}) {
  const props = {
    groups: GROUPS,
    selected: new Set<number>(),
    applying: false,
    onSelectedChange: vi.fn(),
    onApply: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
  render(<ReviewGroups {...props} />);
  return props;
}

describe("ReviewGroups", () => {
  it("renders the heading and every proposed group name", () => {
    renderReview();
    expect(screen.getByRole("heading", { name: "Review groups" })).toBeInTheDocument();
    expect(screen.getByText("O1 Visa")).toBeInTheDocument();
    expect(screen.getByText("Apartment Hunt")).toBeInTheDocument();
  });

  it("disables Apply when nothing is selected", () => {
    renderReview();
    expect(screen.getByRole("button", { name: "Apply selected" })).toBeDisabled();
  });

  it("calls onApply exactly once when Apply is clicked with a selection", async () => {
    const user = userEvent.setup();
    const props = renderReview({ selected: new Set([0]) });
    await user.click(screen.getByRole("button", { name: "Apply selected" }));
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });

  it("keeps Discard enabled with zero selected groups", async () => {
    const user = userEvent.setup();
    const props = renderReview();
    const discard = screen.getByRole("button", { name: "Discard" });
    expect(discard).toBeEnabled();
    await user.click(discard);
    expect(props.onDiscard).toHaveBeenCalledTimes(1);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("disables both Discard and Apply while applying", () => {
    renderReview({ selected: new Set([0]), applying: true });
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
  });

  it("reports the new selection when a group is toggled", async () => {
    const user = userEvent.setup();
    const props = renderReview({ selected: new Set([0]) });
    const checkboxes = screen.getAllByRole("checkbox");

    await user.click(checkboxes[1]);
    expect(props.onSelectedChange).toHaveBeenLastCalledWith(new Set([0, 1]));

    await user.click(checkboxes[0]);
    expect(props.onSelectedChange).toHaveBeenLastCalledWith(new Set());
  });
});
