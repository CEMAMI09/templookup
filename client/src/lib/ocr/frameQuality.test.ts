import { describe, expect, it } from "vitest";
import { fittedSize, OCR_MAX_SIDE } from "./frameQuality";

describe("fitted capture size", () => {
  it("shrinks a portrait phone frame by its long side", () => {
    expect(fittedSize(1080, 1920)).toEqual({ width: 540, height: 960 });
  });

  it("shrinks a landscape webcam frame the same way", () => {
    expect(fittedSize(1920, 1080)).toEqual({ width: 960, height: 540 });
  });

  it("leaves a frame that is already small enough", () => {
    expect(fittedSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(OCR_MAX_SIDE).toBe(960);
  });
});
