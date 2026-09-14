/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppIcon, type AppIconName } from "./AppIcon";

afterEach(cleanup);

const ALL_ICONS: AppIconName[] = [
  "calendar",
  "assistant",
  "brief",
  "feed",
  "chevron-left",
  "chevron-right",
  "extensions",
  "grades",
  "materials",
  "overview",
  "search",
  "settings"
];

describe("AppIcon", () => {
  it("renders an svg with aria-hidden and the default size", () => {
    const { container } = render(createElement(AppIcon, { name: "overview" }));
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.getAttribute("width")).toBe("20");
    expect(svg!.getAttribute("height")).toBe("20");
  });

  it.each(ALL_ICONS)("renders the %s icon with a path", (name) => {
    const { container } = render(createElement(AppIcon, { name }));
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelector("path")).not.toBeNull();
  });

  it("honors a custom size", () => {
    const { container } = render(createElement(AppIcon, { name: "search", size: 18 }));
    const svg = container.querySelector("svg");
    expect(svg!.getAttribute("width")).toBe("18");
    expect(svg!.getAttribute("height")).toBe("18");
  });

  it("renders distinct chevron directions", () => {
    const left = render(createElement(AppIcon, { name: "chevron-left" }));
    const right = render(createElement(AppIcon, { name: "chevron-right" }));
    const leftPath = left.container.querySelector("path")!.getAttribute("d");
    const rightPath = right.container.querySelector("path")!.getAttribute("d");
    expect(leftPath).not.toBe(rightPath);
  });
});
