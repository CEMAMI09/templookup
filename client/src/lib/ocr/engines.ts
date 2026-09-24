import type { OcrEngine, OcrEngineId } from "./types";

const engines = new Map<OcrEngineId, OcrEngine>();

export async function getOcrEngine(id: OcrEngineId): Promise<OcrEngine> {
  const existing = engines.get(id);
  if (existing) return existing;
  const created =
    id === "paddle"
      ? (await import("./paddleEngine")).createPaddleEngine()
      : (await import("./tesseractEngine")).createTesseractEngine();
  engines.set(id, created);
  return created;
}
