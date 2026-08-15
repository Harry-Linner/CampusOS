/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityItemId } from "@campusos/shared";
import { ActivityBar } from "./ActivityBar";

afterEach(cleanup);

interface ActivityItem {
  id: ActivityItemId;
  label: string;
  icon: "overview" | "settings";
}

const createProps = (overrides: Partial<Parameters<typeof ActivityBar>[0]> = {}) => {
  const items: ActivityItem[] = [
    { id: "dashboard", label: "总览", icon: "overview" },
    { id: "settings", label: "设置", icon: "settings" }
  ];
  return {
    activeView: "dashboard" as ActivityItemId,
    items,
    onSelect: vi.fn(),
    onSearch: vi.fn(),
    ...overrides
  };
};

describe("ActivityBar", () => {
  it("renders primary items and moves settings into the utility navigation", () => {
    render(createElement(ActivityBar, createProps()));
    const primary = screen.getByRole("navigation", { name: "主导航" });
    const utility = screen.getByRole("navigation", { name: "应用设置" });
    expect(within(primary).getByRole("button", { name: "总览" })).toBeTruthy();
    expect(within(utility).getByRole("button", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /搜索/ })).toBeTruthy();
    expect(screen.getByText("CampusOS")).toBeTruthy();
  });

  it("marks the active item and sets aria-current", () => {
    render(createElement(ActivityBar, createProps()));
    const active = screen.getByRole("button", { name: "总览" });
    expect(active.className).toContain("is-active");
    expect(active.getAttribute("aria-current")).toBe("page");
    const inactive = screen.getByRole("button", { name: "设置" });
    expect(inactive.className).not.toContain("is-active");
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });

  it("calls onSelect with the item id when a nav item is clicked", () => {
    const props = createProps();
    render(createElement(ActivityBar, props));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(props.onSelect).toHaveBeenCalledWith("settings");
  });

  it("calls onSearch when the search trigger is clicked", () => {
    const props = createProps();
    render(createElement(ActivityBar, props));
    fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
    expect(props.onSearch).toHaveBeenCalledTimes(1);
  });

  it("renders without a settings item when none is provided", () => {
    const props = createProps({
      items: [{ id: "dashboard", label: "总览", icon: "overview" }]
    });
    render(createElement(ActivityBar, props));
    expect(screen.queryByRole("navigation", { name: "应用设置" })).toBeNull();
  });
});
