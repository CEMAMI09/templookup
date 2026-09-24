import { describe, expect, it } from "vitest";
import { diagnoseScan, scanStatus } from "./scanDiagnostics";
import { voiceErrorMessage } from "../localRecognition";

describe("scan diagnosis", () => {
  it("separates capture, engine, empty text, rejection, and an unreliable name", () => {
    expect(diagnoseScan({ captured: false, engineError: null, lineCount: 0, selected: null, reliable: false })).toBe("capture");
    expect(diagnoseScan({ captured: true, engineError: "worker failed", lineCount: 0, selected: null, reliable: false })).toBe("engine");
    expect(diagnoseScan({ captured: true, engineError: null, lineCount: 0, selected: null, reliable: false })).toBe("empty-ocr");
    expect(diagnoseScan({ captured: true, engineError: null, lineCount: 2, selected: null, reliable: false })).toBe("name-rejected");
    expect(diagnoseScan({ captured: true, engineError: null, lineCount: 2, selected: "Ana", reliable: false })).toBe("name-unreliable");
    expect(diagnoseScan({ captured: true, engineError: null, lineCount: 2, selected: "Ana Lopez", reliable: true })).toBe("ready");
  });

  it("does not describe rejected text as an empty read", () => {
    expect(scanStatus("name-rejected")).not.toMatch(/no text/i);
    expect(scanStatus("empty-ocr")).toMatch(/No text was recognized/);
    expect(scanStatus("engine", "Worker failed")).toMatch(/Worker failed/);
  });
});

describe("voice errors", () => {
  it("shows the underlying transcription error", () => {
    const message = voiceErrorMessage(new Error("Failed to fetch /models/Xenova/whisper-tiny.en/onnx/encoder_model_quantized.onnx"));
    expect(message).toContain("encoder_model_quantized.onnx");
    expect(message).not.toMatch(/Wait for the model/);
  });
});