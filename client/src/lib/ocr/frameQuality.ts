export interface FrameSample {
  width: number;
  height: number;
  brightness: number;
  sharpness: number;
  motion: number;
  pixels: Uint8ClampedArray;
}

const SAMPLE_WIDTH = 160;

/** Longest side sent to the reader on a desktop camera. The detector resizes to this. */
export const OCR_MAX_SIDE = 960;

/** Phones and tablets spend most of the wait inside detection. A shorter side is several times faster. */
export const HANDHELD_MAX_SIDE = 480;

export function isHandheld(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export function captureLimit(): number {
  return isHandheld() ? HANDHELD_MAX_SIDE : OCR_MAX_SIDE;
}

export function fittedSize(width: number, height: number, maxSide = OCR_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const longSide = Math.max(width, height);
  const scale = longSide > maxSide ? maxSide / longSide : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

let sampleCanvas: HTMLCanvasElement | null = null;

export function sampleFrame(source: CanvasImageSource, width: number, height: number, previous: Uint8ClampedArray | null): FrameSample | null {
  if (width < 32 || height < 32 || typeof document === "undefined") return null;
  const sampleHeight = Math.max(1, Math.round((SAMPLE_WIDTH * height) / width));
  sampleCanvas ??= document.createElement("canvas");
  const canvas = sampleCanvas;
  if (canvas.width !== SAMPLE_WIDTH) canvas.width = SAMPLE_WIDTH;
  if (canvas.height !== sampleHeight) canvas.height = sampleHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, SAMPLE_WIDTH, sampleHeight);
  const pixels = context.getImageData(0, 0, SAMPLE_WIDTH, sampleHeight).data;
  const gray = new Uint8ClampedArray(SAMPLE_WIDTH * sampleHeight);
  let brightness = 0;
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const luma = ((pixels[offset] ?? 0) + (pixels[offset + 1] ?? 0) + (pixels[offset + 2] ?? 0)) / 3;
    gray[index] = luma;
    brightness += luma;
  }
  brightness /= gray.length;

  let energy = 0;
  let edges = 0;
  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 1; x < SAMPLE_WIDTH; x += 1) {
      const delta = Math.abs((gray[y * SAMPLE_WIDTH + x] ?? 0) - (gray[y * SAMPLE_WIDTH + x - 1] ?? 0));
      energy += delta;
      edges += 1;
    }
  }
  const sharpness = edges ? energy / edges : 0;

  let motion = Number.POSITIVE_INFINITY;
  if (previous && previous.length === gray.length) {
    let total = 0;
    for (let index = 0; index < gray.length; index += 1) total += Math.abs((gray[index] ?? 0) - (previous[index] ?? 0));
    motion = total / gray.length;
  }

  return { width: SAMPLE_WIDTH, height: sampleHeight, brightness, sharpness, motion, pixels: gray };
}

export function frameIsUsable(sample: FrameSample, motionLimit = 12): boolean {
  const lit = sample.brightness > 35 && sample.brightness < 230;
  const sharp = sample.sharpness > 8;
  const still = Number.isFinite(sample.motion) && sample.motion < motionLimit;
  return lit && sharp && still;
}

export function frameWaitReason(sample: FrameSample, motionLimit = 12): string {
  if (sample.brightness <= 35) return "The image is too dark.";
  if (sample.brightness >= 230) return "The image is too bright.";
  if (sample.sharpness <= 8) return "The image is blurry.";
  if (!Number.isFinite(sample.motion) || sample.motion >= motionLimit) return "Hold the badge steady.";
  return "Hold the badge steady.";
}

export function frameChanged(current: Uint8ClampedArray, previous: Uint8ClampedArray | null, minimum = 8): boolean {
  if (!previous || previous.length !== current.length) return true;
  let total = 0;
  for (let index = 0; index < current.length; index += 1) total += Math.abs((current[index] ?? 0) - (previous[index] ?? 0));
  return total / current.length > minimum;
}
