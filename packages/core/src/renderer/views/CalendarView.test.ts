/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultCampusAdapterContext,
  loadCampusWorkspace
} from "../lib/campusWorkspace";
import { CalendarView } from "./CalendarView";

afterEach(cleanup);

describe("CalendarView", () => {
  it("shows the selected week's seven date columns and navigates by week", async () => {
    const snapshot = await loadCampusWorkspace(
      createDefaultCampusAdapterContext(new Date(2026, 6, 18, 12, 0))
    );

    render(createElement(CalendarView, { loading: false, snapshot }));
    fireEvent.click(screen.getByRole("button", { name: "周视图" }));

    expect(screen.getByRole("region", { name: /周视图$/ })).toBeDefined();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(7);

    const currentPeriod = screen.getByLabelText("周导航").textContent;
    fireEvent.click(screen.getByRole("button", { name: "下一个周" }));

    expect(screen.getByLabelText("周导航").textContent).not.toBe(currentPeriod);
  });

  it("ends the day timeline at the 23:00 event container", async () => {
    const snapshot = await loadCampusWorkspace(
      createDefaultCampusAdapterContext(new Date(2026, 6, 18, 12, 0))
    );

    render(createElement(CalendarView, { loading: false, snapshot }));
    fireEvent.click(screen.getByRole("button", { name: "日视图" }));

    expect(screen.getByText("23:00")).toBeDefined();
    expect(screen.queryByText("24:00")).toBeNull();
  });
});
