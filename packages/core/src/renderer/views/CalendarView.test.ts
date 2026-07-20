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
