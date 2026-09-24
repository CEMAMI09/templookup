import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { createWorker, PSM } from "tesseract.js";

// Same-origin copies of the quantized Whisper files. Remote Hub downloads redirect to
// us.aws.cdn.hf.co, which production CSP does not allow.
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = "/models/";

let speechModel: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let textWorker: ReturnType<typeof createWorker> | null = null;

function whisper() {
  speechModel ??= pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", { dtype: "q8" });
  return speechModel;
}

export function voiceErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  if (!detail) return "Voice transcription failed. You can still type the name.";
  return `Voice transcription failed. ${detail}`;
}

function nameReader() {
  textWorker ??= createWorker("eng");
  return textWorker;
}

export type BadgeOcrLine = { text: string; confidence: number };
export type BadgeOcrAttempt = { label: string; text: string; confidence: number };
export type BadgeOcrResult = {
  text: string;
  confidence: number;
  lines: BadgeOcrLine[];
  attempts: BadgeOcrAttempt[];
};

export async function transcribeAudio(blob: Blob, onStatus: (message: string) => void): Promise<string> {
  if (blob.size < 1000) return "";
  onStatus("Loading the speech model. The first time can take a minute.");
  const model = await whisper();
  onStatus("Transcribing…");
  const url = URL.createObjectURL(blob);
  try {
    const result = await model(url);
    const text = result && typeof result === "object" && "text" in result ? String(result.text) : "";
    return cleanName(text);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readBadgeText(
  images: { label: string; blob: Blob }[],
  onStatus: (message: string) => void,
): Promise<BadgeOcrResult> {
  onStatus("Loading the badge reader. The first time can take a minute.");
  const worker = await nameReader();
  const attempts: BadgeOcrAttempt[] = [];
  for (const image of images) {
    const mode = image.label === "original" ? PSM.SINGLE_LINE : PSM.SINGLE_LINE;
    onStatus(`Reading the badge (${image.label})…`);
    const attempt = await recognizeBlob(worker, image.blob, image.label, mode);
    attempts.push(attempt);
  }
  const original = images.find((image) => image.label === "original");
  if (original && !attempts.some((attempt) => hasLetters(attempt.text))) {
    onStatus("Reading the badge as multiple lines…");
    attempts.push(await recognizeBlob(worker, original.blob, "original-block", PSM.SINGLE_BLOCK));
  }
  const chosen = attempts.find((attempt) => looksLikeName(attempt.text) && attempt.confidence >= 55);
  const text = chosen?.text ?? "";
  const lines = text
    .split("\n")
    .map((line) => ({ text: line, confidence: chosen?.confidence ?? 0 }))
    .filter((line) => line.text.length > 0);
  return { text, confidence: chosen?.confidence ?? 0, lines, attempts };
}

async function recognizeBlob(
  worker: Awaited<ReturnType<typeof nameReader>>,
  blob: Blob,
  label: string,
  mode: PSM,
): Promise<BadgeOcrAttempt> {
  await worker.setParameters({
    tessedit_pageseg_mode: mode,
    user_defined_dpi: "300",
  });
  const result = await worker.recognize(blob);
  const text = result.data.text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { label: `${label} psm ${mode}`, text, confidence: result.data.confidence };
}

export async function diagnoseBadgeFile(file: Blob): Promise<string> {
  const worker = await nameReader();
  const modes = [PSM.SINGLE_LINE, PSM.RAW_LINE, PSM.SINGLE_BLOCK, PSM.AUTO];
  const reports: string[] = [];
  for (const mode of modes) {
    await worker.setParameters({ tessedit_pageseg_mode: mode, user_defined_dpi: "300" });
    const result = await worker.recognize(file);
    const words = wordList(result.data.blocks);
    reports.push(
      `PSM ${mode}: ${result.data.confidence.toFixed(0)}% ${JSON.stringify(result.data.text.trim())} | ${words || "no words"}`,
    );
  }
  return reports.join("\n");
}

function wordList(blocks: { paragraphs: { lines: { words: { text: string; confidence: number }[] }[] }[] }[] | null): string {
  const words: string[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const token = word.text.trim();
          if (token) words.push(`${token} ${Math.round(word.confidence)}%`);
        }
      }
    }
  }
  return words.join(", ");
}

function hasLetters(value: string): boolean {
  return /\p{L}/u.test(value);
}

function looksLikeName(value: string): boolean {
  if (!hasLetters(value)) return false;
  const letters = value.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3) return false;
  const vowels = letters.match(/[aeiouyáéíóúüàèìòùäëïöâêîôûAEIOUYÁÉÍÓÚÜ]/g)?.length ?? 0;
  if (vowels / letters.length < 0.2) return false;
  const words = value.split(/\s+/).filter((word) => word.replace(/[^\p{L}]/gu, "").length > 1);
  return words.length > 0 && words.length <= 6;
}

export function cropToDarkText(source: HTMLCanvasElement): HTMLCanvasElement {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  const { width, height } = source;
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const luma = ((pixels[index] ?? 0) + (pixels[index + 1] ?? 0) + (pixels[index + 2] ?? 0)) / 3;
      if (luma >= 90) continue;
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (count < 30 || maxX <= minX || maxY <= minY) return source;
  const pad = 12;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(width - sx, maxX - minX + pad * 2);
  const sh = Math.min(height - sy, maxY - minY + pad * 2);
  const output = document.createElement("canvas");
  output.width = Math.max(1, sw);
  output.height = Math.max(1, sh);
  output.getContext("2d")?.drawImage(source, sx, sy, sw, sh, 0, 0, output.width, output.height);
  return output;
}

function cleanName(value: string): string {
  return value
    .replace(/[^A-Za-z .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

