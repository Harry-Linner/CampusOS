import { describe, expect, it } from "vitest";
import {
  BRIEF_PROMPT_VERSION,
  BRIEF_SCHEMA,
  BRIEF_SYSTEM_PROMPT
} from "../../../../plugins/official/daily-brief/src/prompt";

describe("daily brief prompt contract", () => {
  it("exposes a versioned prompt", () => {
    expect(BRIEF_PROMPT_VERSION).toMatch(/^2026-08-22\.v1$/);
    expect(BRIEF_SYSTEM_PROMPT).toContain("fingerprint");
    expect(BRIEF_SYSTEM_PROMPT).toContain("原样透传");
  });

  it("declares the strict structured-output schema", () => {
    const schema = BRIEF_SCHEMA as Record<string, unknown>;
    expect(schema.type).toBe("object");
    const sections = (schema.properties as Record<string, unknown>).sections as Record<string, unknown>;
    expect((sections as { maxItems?: number }).maxItems).toBe(12);
    const section = (sections as { items?: Record<string, unknown> }).items as Record<string, unknown>;
    const itemArray = ((section.properties as Record<string, unknown>).items) as Record<string, unknown>;
    expect((itemArray as { maxItems?: number }).maxItems).toBe(3);
    const entry = (itemArray as { items?: Record<string, unknown> }).items as Record<string, unknown>;
    const required = (entry as { required?: string[] }).required ?? [];
    expect(required).toEqual(
      expect.arrayContaining(["fingerprint", "titleZh", "summary", "originalTitle", "url"])
    );
  });
});
