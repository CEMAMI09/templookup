import { describe, expect, it } from "vitest";
import { applyContactChecks, checkCandidate, verificationQueries } from "./contactMatch";
import { extractAttendeeName } from "./nameExtraction";
import type { OcrLine } from "./types";

const daniel = { firstName: "Daniel", lastName: "Lindgren", fullName: "Daniel Lindgren" };
const duplicate = { firstName: "Daniel", lastName: "Lindgren", fullName: "Daniel Lindgren" };

function line(text: string, box: { x: number; y: number; width: number; height: number }, confidence = 0.95): OcrLine {
  return { text, rawText: text, confidence, boundingBox: box };
}

describe("COTO name validation", () => {
  it("prefers the candidate with an exact full-name match", () => {
    const decision = extractAttendeeName([
      line("Ananel", { x: 131, y: 0, width: 696, height: 136 }, 0.96),
      line("Daniel", { x: 396, y: 152, width: 356, height: 129 }, 1),
      line("Daniel Lindgren", { x: 301, y: 268, width: 561, height: 91 }, 0.99),
      line("ATTENDEE", { x: 462, y: 357, width: 233, height: 51 }, 1),
    ]);
    const queries = verificationQueries(decision.candidates);
    expect(queries).toContain("Daniel Lindgren");
    expect(queries).not.toContain("ATTENDEE");
    const refined = applyContactChecks(decision, [
      checkCandidate("Daniel Lindgren", [daniel, duplicate]),
      checkCandidate("Ananel Daniel", []),
    ]);
    expect(refined.selected).toBe("Daniel Lindgren");
    expect(refined.reliable).toBe(true);
  });

  it("corrects a one-character surname error without adopting an unrelated contact", () => {
    const close = checkCandidate("Daniel Lindqren", [daniel]);
    expect(close.quality).toBe("fuzzy");
    expect(close.matchedName).toBe("Daniel Lindgren");
    const unrelated = checkCandidate("Ananel Daniel", [daniel]);
    expect(unrelated.quality).toBe("none");
  });

  it("keeps a credible new attendee when COTO has no matching contact", () => {
    const decision = extractAttendeeName([line("Joseph Allen", { x: 10, y: 10, width: 180, height: 30 }, 0.96)]);
    const refined = applyContactChecks(decision, [checkCandidate("Joseph Allen", [])]);
    expect(refined.selected).toBe("Joseph Allen");
    expect(refined.reliable).toBe(true);
  });

  it("does not choose between two different exact COTO names", () => {
    const decision = extractAttendeeName([
      line("Amy Nguyen", { x: 10, y: 10, width: 140, height: 24 }),
      line("Amy Nunez", { x: 10, y: 50, width: 140, height: 24 }),
    ]);
    const refined = applyContactChecks(decision, [
      checkCandidate("Amy Nguyen", [{ firstName: "Amy", lastName: "Nguyen", fullName: "Amy Nguyen" }]),
      checkCandidate("Amy Nunez", [{ firstName: "Amy", lastName: "Nunez", fullName: "Amy Nunez" }]),
    ]);
    expect(refined.reliable).toBe(false);
  });
});
