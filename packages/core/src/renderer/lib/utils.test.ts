import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges conditional class names", () => {
    const skip = "";
    expect(cn("a", "b")).toBe("a b");
    expect(cn("a", skip && "b", null, undefined, "c")).toBe("a c");
  });

  it("resolves Tailwind conflicts in favor of the last value", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });
});
