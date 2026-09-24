import { describe, expect, it } from "vitest";
import { extractAttendeeName } from "./nameExtraction";
import { NameStabilizer } from "./stability";
import type { OcrLine } from "./types";

function line(text: string, box: { x: number; y: number; width: number; height: number }, confidence: number | null = 0.9): OcrLine {
  return { text, rawText: text, confidence, boundingBox: box };
}

describe("extractAttendeeName", () => {
  it("prefers the full name over a repeated first name and a role label", () => {
    const decision = extractAttendeeName([
      line("ACADEMY", { x: 40, y: 20, width: 400, height: 80 }),
      line("OCT 8-11 2025", { x: 80, y: 110, width: 320, height: 40 }),
      line("Anaheim", { x: 70, y: 160, width: 340, height: 70 }),
      line("Daniel", { x: 160, y: 280, width: 180, height: 48 }),
      line("Daniel Lindgren", { x: 120, y: 340, width: 260, height: 36 }),
      line("ATTENDEE", { x: 180, y: 390, width: 140, height: 24 }),
      line("074521986621", { x: 150, y: 620, width: 200, height: 20 }),
    ]);
    expect(decision.selected).toBe("Daniel Lindgren");
    expect(decision.reliable).toBe(true);
    expect(decision.candidates.map((candidate) => candidate.text)).not.toContain("Daniel");
    expect(decision.rejected.some((item) => item.text === "ATTENDEE")).toBe(true);
  });

  it("reads a simple two-word printed name", () => {
    const decision = extractAttendeeName([line("Joseph Allen", { x: 20, y: 40, width: 220, height: 36 }, 0.96)]);
    expect(decision.selected).toBe("Joseph Allen");
    expect(decision.reliable).toBe(true);
  });

  it("keeps hyphenated, apostrophe, initial, and accented names", () => {
    expect(extractAttendeeName([line("Mary-Jane O'Neil", { x: 0, y: 0, width: 200, height: 30 })]).selected).toBe("Mary-Jane O'Neil");
    expect(extractAttendeeName([line("J. R. R. Tolkien", { x: 0, y: 0, width: 200, height: 30 })]).selected).toBe("J. R. R. Tolkien");
    expect(extractAttendeeName([line("José Núñez", { x: 0, y: 0, width: 180, height: 30 })]).selected).toBe("José Núñez");
    expect(extractAttendeeName([line("ANA GARCÍA-LÓPEZ", { x: 0, y: 0, width: 220, height: 30 })]).selected).toBe("Ana García-López");
  });

  it("does not pick a larger organization over a smaller personal name", () => {
    const decision = extractAttendeeName([
      line("PACIFIC VISION GROUP", { x: 10, y: 10, width: 400, height: 70 }, 0.95),
      line("Priya Shah", { x: 80, y: 120, width: 180, height: 28 }, 0.9),
    ]);
    expect(decision.selected).toBe("Priya Shah");
  });

  it("rejects gibberish and does not invent a name", () => {
    const decision = extractAttendeeName([line("###", { x: 0, y: 0, width: 40, height: 20 }, 0.2), line("123456789", { x: 0, y: 30, width: 80, height: 16 })]);
    expect(decision.selected).toBeNull();
    expect(decision.reliable).toBe(false);
  });

  it("joins a first name stacked above a surname", () => {
    const decision = extractAttendeeName([
      line("Daniel", { x: 80, y: 200, width: 140, height: 48 }),
      line("Lindgren", { x: 70, y: 258, width: 160, height: 32 }),
      line("DanielL", { x: 78, y: 292, width: 90, height: 18 }),
      line("ATTENDEE", { x: 90, y: 320, width: 120, height: 22 }),
    ]);
    expect(decision.selected).toBe("Daniel Lindgren");
    expect(decision.reliable).toBe(true);
  });

  it("does not join branding to a first name when a complete name was already read", () => {
    const decision = extractAttendeeName([
      line("Ananel", { x: 131, y: 0, width: 696, height: 136 }, 0.96),
      line("Daniel", { x: 396, y: 152, width: 356, height: 129 }, 1),
      line("Daniel Lindgren", { x: 301, y: 268, width: 561, height: 91 }, 0.99),
      line("ATTENDEE", { x: 462, y: 357, width: 233, height: 51 }, 1),
    ]);
    expect(decision.selected).toBe("Daniel Lindgren");
    expect(decision.reliable).toBe(true);
    expect(decision.candidates.map((candidate) => candidate.text)).not.toContain("Ananel Daniel");
    expect(decision.candidates.find((candidate) => candidate.text === "Daniel Lindgren")?.source).toBe("recognized");
  });

  it("prefers John Smith over a repeated first name", () => {
    const decision = extractAttendeeName([
      line("John", { x: 40, y: 20, width: 80, height: 28 }),
      line("John Smith", { x: 30, y: 60, width: 160, height: 24 }),
    ]);
    expect(decision.selected).toBe("John Smith");
    expect(decision.reliable).toBe(true);
  });

  it("keeps Mary-Jane O'Brien when a shorter Mary line is also present", () => {
    const decision = extractAttendeeName([
      line("Mary", { x: 40, y: 20, width: 70, height: 28 }),
      line("Mary-Jane O'Brien", { x: 20, y: 60, width: 220, height: 24 }),
    ]);
    expect(decision.selected).toBe("Mary-Jane O'Brien");
  });
});

describe("NameStabilizer", () => {
  it("accepts one clear result without waiting for a second frame", () => {
    const stabilizer = new NameStabilizer();
    const decision = extractAttendeeName([line("Joseph Allen", { x: 0, y: 0, width: 100, height: 20 })]);
    expect(stabilizer.observe(decision).ready).toBe(true);
  });

  it("waits for agreement when the result is not reliable", () => {
    const stabilizer = new NameStabilizer();
    const uncertain = extractAttendeeName([
      line("Daniel", { x: 0, y: 0, width: 80, height: 40 }),
      line("Lindgren", { x: 220, y: 4, width: 90, height: 24 }),
    ]);
    expect(uncertain.reliable).toBe(false);
    expect(stabilizer.observe(uncertain).ready).toBe(false);
    expect(stabilizer.observe(uncertain).ready).toBe(true);
  });
});
