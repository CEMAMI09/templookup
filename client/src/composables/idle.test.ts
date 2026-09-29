import { describe, expect, it } from "vitest";
import { IDLE_LIMIT_MS, isIdle } from "./idle";

describe("idle timeout", () => {
  it("stays signed in during activity and expires after the idle limit", () => {
    const start = 1_000_000;
    expect(isIdle(start, start + IDLE_LIMIT_MS - 1)).toBe(false);
    expect(isIdle(start, start + IDLE_LIMIT_MS)).toBe(true);
  });
});
