export type ScanDiagnosis = "ready" | "capture" | "engine" | "empty-ocr" | "name-rejected" | "name-unreliable";

export function diagnoseScan(input: {
  captured: boolean;
  engineError: string | null;
  lineCount: number;
  selected: string | null;
  reliable: boolean;
}): ScanDiagnosis {
  if (!input.captured) return "capture";
  if (input.engineError) return "engine";
  if (input.lineCount === 0) return "empty-ocr";
  if (!input.selected) return "name-rejected";
  if (!input.reliable) return "name-unreliable";
  return "ready";
}

export function scanStatus(diagnosis: ScanDiagnosis, detail = ""): string {
  const extra = detail.trim();
  switch (diagnosis) {
    case "capture":
      return "The camera frame could not be captured.";
    case "engine":
      return extra ? `Badge reader failed to start. ${extra}` : "Badge reader failed to start.";
    case "empty-ocr":
      return "No text was recognized. Move closer and hold the badge steady.";
    case "name-rejected":
      return extra
        ? `Text was recognized, but it was not accepted as a name. ${extra}`
        : "Text was recognized, but it was not accepted as a name.";
    case "name-unreliable":
      return "A name was read, but it is not reliable enough to search automatically.";
    case "ready":
      return "Looking up contact...";
  }
}
