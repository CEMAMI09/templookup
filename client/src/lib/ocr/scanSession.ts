import type { NameDecision } from "./types";

export interface ScanPayload {
  selected: string;
  fieldValue: string;
  searchQuery: string;
}

/** One line of a person's name. Newlines must not glue neighboring OCR text together. */
export function singleLineName(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function scanPayload(decision: Pick<NameDecision, "selected">): ScanPayload {
  const selected = singleLineName(decision.selected ?? "");
  return { selected, fieldValue: selected, searchQuery: selected };
}

export class ScanSession {
  private generation = 0;
  private frozen = false;
  private edited = false;
  private current = "";

  start(): number {
    this.generation += 1;
    this.frozen = false;
    this.edited = false;
    this.current = "";
    return this.generation;
  }

  noteEdit(value: string): void {
    this.edited = true;
    this.current = value;
  }

  complete(generation: number, decision: Pick<NameDecision, "selected" | "reliable">): ScanPayload | null {
    if (generation !== this.generation || this.frozen || this.edited) return null;
    const payload = scanPayload(decision);
    this.current = payload.fieldValue;
    if (decision.reliable && payload.fieldValue) this.frozen = true;
    return payload;
  }

  get name(): string {
    return this.current;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  get userEdited(): boolean {
    return this.edited;
  }
}
