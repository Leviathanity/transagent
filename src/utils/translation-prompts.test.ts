import { describe, it, expect } from "bun:test";
import { isSkippable } from "./translation-prompts.js";

describe("isSkippable", () => {
  it("translates other blocks (running headers/footers) when they have text", () => {
    expect(
      isSkippable({
        id: "h",
        type: "other",
        level: 0,
        text: "CEER SUPPLIER QUALITY\nHANDBOOK",
      }),
    ).toBe(false);
    expect(isSkippable({ id: "h", type: "other", level: 0, text: " " })).toBe(true);
  });

  it("still skips image and code blocks", () => {
    expect(isSkippable({ id: "i", type: "image", level: 0, text: "", src: "a.png", alt: "" })).toBe(true);
    expect(isSkippable({ id: "c", type: "code", level: 0, text: "const x = 1;" })).toBe(true);
  });
});
