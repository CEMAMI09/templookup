export interface FrameSample {
  width: number;
  height: number;
  brightness: number;
  sharpness: number;
  motion: number;
  pixels: Uint8ClampedArray;
}

const SAMPLE_WIDTH = 160;

export function sampleFrame(source: CanvasImageSource, width: number, height: number, previous: Uint8ClampedArray | null): FrameSample | null {
  if (width < 32 || height < 32) return null;
  const sampleHeight = Math.max(1, Math.round((SAMPLE_WIDTH * height) / width));
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_WIDTH;
  canvas.height = sampleHeight;
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

export function frameIsUsable(sample: FrameSample): boolean {
  const lit = sample.brightness > 35 && sample.brightness < 230;
  const sharp = sample.sharpness > 8;
  const still = Number.isFinite(sample.motion) && sample.motion < 12;
  return lit && sharp && still;
}

export function frameWaitReason(sample: FrameSample): string {
  if (sample.brightness <= 35) return "The image is too dark.";
  if (sample.brightness >= 230) return "The image is too bright.";
  if (sample.sharpness <= 8) return "The image is blurry.";
  if (!Number.isFinite(sample.motion) || sample.motion >= 12) return "Hold the badge steady.";
  return "Hold the badge steady.";
}

export function frameChanged(current: Uint8ClampedArray, previous: Uint8ClampedArray | null, minimum = 8): boolean {
  if (!previous || previous.length !== current.length) return true;
  let total = 0;
  for (let index = 0; index < current.length; index += 1) total += Math.abs((current[index] ?? 0) - (previous[index] ?? 0));
  return total / current.length > minimum;
}
