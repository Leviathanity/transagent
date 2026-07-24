import { describe, it, expect } from "bun:test";
import { stageConvert } from "./stage-convert.js";

describe("stageConvert", () => {
  it("exports stageConvert function", () => {
    expect(typeof stageConvert).toBe("function");
  });
});
