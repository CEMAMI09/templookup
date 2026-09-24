import { createWorker, PSM, type Worker } from "tesseract.js";
import type { OcrBox, OcrEngine, OcrLine, OcrResult } from "./types";

let workerPromise: Promise<Worker> | null = null;

async function worker(): Promise<Worker> {
  workerPromise ??= createWorker("eng");
  return workerPromise;
}

export function createTesseractEngine(): OcrEngine {
  return {
    id: "tesseract",
    async initialize() {
      const started = performance.now();
      const engine = await worker();
      await engine.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        user_defined_dpi: "300",
      });
      return { elapsedMs: performance.now() - started };
    },
    async recognize(image) {
      const started = performance.now();
      const engine = await worker();
      const bitmap = await createImageBitmap(image);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The scan image could not be prepared.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const result = await engine.recognize(canvas, {}, { text: true, blocks: true });
      const imageWidth = canvas.width;
      const imageHeight = canvas.height;
      const lines = linesFromTesseract(result.data.blocks);
      if (!lines.length) {
        for (const rawText of result.data.text.split("\n")) {
          const text = rawText.replace(/\s+/g, " ").trim();
          if (text) lines.push({ text, rawText, confidence: null, boundingBox: null });
        }
      }
      return {
        lines,
        processingTimeMs: performance.now() - started,
        imageWidth,
        imageHeight,
      };
    },
    async dispose() {
      const pending = workerPromise;
      workerPromise = null;
      if (pending) {
        const engine = await pending;
        await engine.terminate();
      }
    },
  };
}

type TessBlocks = {
  paragraphs: {
    lines: {
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }[];
  }[];
}[] | null;

function linesFromTesseract(blocks: TessBlocks): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const rawText = line.text ?? "";
        const text = rawText.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const box = toBox(line.bbox);
        const confidence = Number.isFinite(line.confidence) && line.confidence >= 0 ? line.confidence / 100 : null;
        lines.push({ text, rawText, confidence, boundingBox: box });
      }
    }
  }
  return lines;
}

function toBox(bbox: { x0: number; y0: number; x1: number; y1: number } | undefined): OcrBox | null {
  if (!bbox) return null;
  const width = bbox.x1 - bbox.x0;
  const height = bbox.y1 - bbox.y0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { x: bbox.x0, y: bbox.y0, width, height };
}

export function emptyResult(processingTimeMs: number): OcrResult {
  return { lines: [], processingTimeMs, imageWidth: 0, imageHeight: 0 };
}
