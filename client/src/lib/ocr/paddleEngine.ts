import { PaddleOCR } from "@paddleocr/paddleocr-js";
import type { OcrBox, OcrEngine, OcrLine } from "./types";

type PaddleHandle = Awaited<ReturnType<typeof PaddleOCR.create>>;

let enginePromise: Promise<PaddleHandle> | null = null;
let initMs = 0;

const OCR_ASSETS = [
  "/ocr-models/PP-OCRv5_mobile_det_onnx_infer.tar",
  "/ocr-models/PP-OCRv5_mobile_rec_onnx_infer.tar",
  "/ort/ort-wasm-simd-threaded.jsep.wasm",
  "/ort/ort-wasm-simd-threaded.jsep.mjs",
];

async function assertOcrAssets(): Promise<void> {
  const failures: string[] = [];
  await Promise.all(
    OCR_ASSETS.map(async (url) => {
      try {
        const response = await fetch(url, { method: "HEAD" });
        if (!response.ok) failures.push(`${url} returned ${response.status}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "request failed";
        failures.push(`${url} (${detail})`);
      }
    }),
  );
  if (failures.length > 0) {
    throw new Error(`PaddleOCR files failed to load. ${failures.join("; ")}`);
  }
}

function createHandle(): Promise<PaddleHandle> {
  return assertOcrAssets().then(() => PaddleOCR.create({
    lang: "en",
    ocrVersion: "PP-OCRv5",
    worker: true,
    textDetectionModelName: "PP-OCRv5_mobile_det",
    textRecognitionModelName: "PP-OCRv5_mobile_rec",
    textDetectionModelAsset: { url: "/ocr-models/PP-OCRv5_mobile_det_onnx_infer.tar" },
    textRecognitionModelAsset: { url: "/ocr-models/PP-OCRv5_mobile_rec_onnx_infer.tar" },
    textDetLimitSideLen: 960,
    textDetLimitType: "max",
    textRecognitionBatchSize: 6,
    ortOptions: {
      backend: "wasm",
      wasmPaths: "/ort/",
      simd: true,
      numThreads: 1,
    },
    }),
  );
}

export function createPaddleEngine(): OcrEngine {
  return {
    id: "paddle",
    async initialize() {
      if (!enginePromise) {
        const started = performance.now();
        enginePromise = createHandle().catch((error: unknown) => {
          enginePromise = null;
          throw error;
        });
        await enginePromise;
        initMs = performance.now() - started;
      }
      return { elapsedMs: initMs };
    },
    async recognize(image) {
      const started = performance.now();
      await this.initialize();
      const engine = await enginePromise;
      if (!engine) throw new Error("PaddleOCR did not initialize.");
      const bitmap = await createImageBitmap(image);
      try {
        const [result] = await engine.predict(bitmap, {
          textDetLimitSideLen: 960,
          textDetLimitType: "max",
        });
        const lines: OcrLine[] = (result?.items ?? []).map((item) => {
          const rawText = item.text ?? "";
          return {
            text: rawText.replace(/\s+/g, " ").trim(),
            rawText,
            confidence: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : null,
            boundingBox: boxFromPoly(item.poly),
          };
        }).filter((line) => line.text.length > 0);
        return {
          lines,
          processingTimeMs: result?.metrics.totalMs ?? performance.now() - started,
          imageWidth: result?.image.width ?? bitmap.width,
          imageHeight: result?.image.height ?? bitmap.height,
        };
      } finally {
        bitmap.close();
      }
    },
    async dispose() {
      const pending = enginePromise;
      enginePromise = null;
      initMs = 0;
      if (pending) {
        const engine = await pending;
        await engine.dispose();
      }
    },
  };
}

function boxFromPoly(poly: [number, number][] | undefined): OcrBox | null {
  if (!poly?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of poly) {
    const x = point[0];
    const y = point[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return null;
  return { x: minX, y: minY, width, height };
}
