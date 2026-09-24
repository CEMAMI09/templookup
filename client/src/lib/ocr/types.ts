export type OcrEngineId = "paddle" | "tesseract";

export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrLine {
  /** Text after whitespace cleanup. The original model string is `rawText`. */
  text: string;
  rawText: string;
  /** 0–1 when the engine provides a score. Null when it does not. */
  confidence: number | null;
  /** Axis-aligned box in source-image pixels. Null when the engine does not provide geometry. */
  boundingBox: OcrBox | null;
}

export interface OcrResult {
  lines: OcrLine[];
  processingTimeMs: number;
  imageWidth: number;
  imageHeight: number;
}

export interface OcrEngine {
  readonly id: OcrEngineId;
  initialize(): Promise<{ elapsedMs: number }>;
  recognize(image: Blob): Promise<OcrResult>;
  dispose(): Promise<void>;
}

export interface NameCandidate {
  text: string;
  score: number;
  /** A line the OCR engine returned, or a name built from separate lines. */
  source: "recognized" | "constructed";
  reasons: string[];
}

export interface NameDecision {
  selected: string | null;
  reliable: boolean;
  selectionReason: string;
  candidates: NameCandidate[];
  rejected: { text: string; reasons: string[] }[];
}
