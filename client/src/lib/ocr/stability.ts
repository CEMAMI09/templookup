import { normalizeNameKey } from "./nameExtraction";
import type { NameDecision } from "./types";

export interface StableName {
  name: string | null;
  ready: boolean;
  uncertain: boolean;
  options: string[];
}

export class NameStabilizer {
  private lastKey = "";
  private agreements = 0;

  reset(): void {
    this.lastKey = "";
    this.agreements = 0;
  }

  observe(decision: NameDecision): StableName {
    const options = unique(decision.candidates.map((candidate) => candidate.text));
    if (!decision.selected) {
      this.reset();
      return { name: null, ready: false, uncertain: false, options };
    }
    if (decision.reliable) {
      this.reset();
      return { name: decision.selected, ready: true, uncertain: false, options };
    }
    const key = normalizeNameKey(decision.selected);
    if (key === this.lastKey) this.agreements += 1;
    else {
      this.lastKey = key;
      this.agreements = 1;
    }
    if (this.agreements >= 2) {
      return { name: decision.selected, ready: true, uncertain: false, options };
    }
    return {
      name: decision.selected,
      ready: false,
      uncertain: options.length > 1,
      options,
    };
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalizeNameKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
