import { describe, expect, it } from "vitest";
import { extractAttendeeName } from "./nameExtraction";
import { ScanSession, scanPayload, singleLineName } from "./scanSession";
import type { OcrLine } from "./types";

function line(text: string, box: { x: number; y: number; width: number; height: number }, confidence: number): OcrLine {
  return { text, rawText: text, confidence, boundingBox: box };
}

describe("badge name field", () => {
  it("keeps Daniel Lindgren when AUADEMI and ET were also read", () => {
    const decision = extractAttendeeName([
      line("Daniel Lindgren", { x: 80, y: 180, width: 260, height: 40 }, 0.98),
      line("AUADEMI", { x: 40, y: 20, width: 300, height: 70 }, 0.68),
      line("ET", { x: 180, y: 100, width: 40, height: 24 }, 0.68),
    ]);
    const payload = scanPayload(decision);
    expect(decision.selected).toBe("Daniel Lindgren");
    expect(payload.fieldValue).toBe("Daniel Lindgren");
    expect(payload.searchQuery).toBe("Daniel Lindgren");
    expect(payload.fieldValue).not.toContain("ET");
    expect(payload.fieldValue).not.toContain("AUADEMI");
  });

  it("does not glue separate OCR lines when newlines are removed", () => {
    expect(singleLineName("Daniel Lindgren\nEt\nAuademi")).toBe("Daniel Lindgren Et Auademi");
    expect(scanPayload({ selected: "Daniel Lindgren" }).searchQuery).toBe("Daniel Lindgren");
  });

  it("ignores a stale recognition after the name is accepted", () => {
    const session = new ScanSession();
    const generation = session.start();
    const accepted = session.complete(generation, { selected: "Daniel Lindgren", reliable: true });
    expect(accepted?.fieldValue).toBe("Daniel Lindgren");
    expect(session.complete(generation, { selected: "Daniel LindgrenEtAuademi", reliable: true })).toBeNull();
    expect(session.name).toBe("Daniel Lindgren");
  });

  it("does not let a late OCR result replace a manual correction", () => {
    const session = new ScanSession();
    const generation = session.start();
    session.noteEdit("Dana Lindgren");
    expect(session.complete(generation, { selected: "Daniel Lindgren", reliable: true })).toBeNull();
    expect(session.name).toBe("Dana Lindgren");
  });

  it("drops an OCR result from an older scan session", () => {
    const session = new ScanSession();
    const first = session.start();
    const second = session.start();
    expect(session.complete(first, { selected: "Et Auademi", reliable: true })).toBeNull();
    const accepted = session.complete(second, { selected: "Daniel Lindgren", reliable: true });
    expect(accepted?.searchQuery).toBe("Daniel Lindgren");
  });
});
