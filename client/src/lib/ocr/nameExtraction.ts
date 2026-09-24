import type { NameCandidate, NameDecision, OcrLine } from "./types";

const ROLE_LABELS = new Set([
  "attendee",
  "exhibitor",
  "speaker",
  "sponsor",
  "staff",
  "vendor",
  "guest",
  "member",
  "faculty",
  "student",
  "resident",
  "presenter",
  "volunteer",
  "press",
  "media",
  "vip",
]);

const BRANDING = new Set([
  "academy",
  "anaheim",
  "conference",
  "optometry",
  "optometrist",
  "registration",
  "welcome",
  "aaoptom",
  "aaoptometry",
]);

const CREDENTIALS = new Set([
  "od",
  "md",
  "do",
  "phd",
  "faao",
  "abo",
  "ms",
  "mba",
  "rn",
  "pa",
  "np",
  "dds",
  "mph",
  "odfaao",
]);

const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)$/i;

const NAME_WORD = /^[\p{L}][\p{L}'’.-]*[\p{L}.]?$|^[\p{L}]\.$/u;

export function extractAttendeeName(lines: OcrLine[]): NameDecision {
  const prepared = withStackedNames(lines, hasCredibleFullName(lines))
    .map((line) => ({ line, text: cleanLine(line.text) }))
    .filter((item) => item.text.length > 0);

  const rejected: NameDecision["rejected"] = [];
  const pool: { text: string; line: OcrLine; words: string[] }[] = [];

  for (const item of prepared) {
    const reason = rejectReason(item.text);
    if (reason) {
      rejected.push({ text: item.text, reasons: [reason] });
      continue;
    }
    const words = item.text.split(" ").filter((word) => !CREDENTIALS.has(normalizeKey(word)));
    const name = words.join(" ").trim();
    if (!name) {
      rejected.push({ text: item.text, reasons: ["Only credentials remained."] });
      continue;
    }
    if (words.length > 5) {
      rejected.push({ text: name, reasons: ["Too many words for a personal name."] });
      continue;
    }
    if (!words.every(isNameWord)) {
      rejected.push({ text: name, reasons: ["Contains tokens that do not look like a name."] });
      continue;
    }
    pool.push({ text: name, line: item.line, words });
  }

  const heights = pool.map((item) => item.line.boundingBox?.height ?? 0).filter((height) => height > 0);
  const medianHeight = median(heights);

  const constructed = new Set(prepared.filter((item) => item.line.rawText.startsWith("constructed:")).map((item) => normalizeNameKey(item.text)));
  const context = lines.map((line) => ({ text: cleanLine(line.text), line, words: cleanLine(line.text).split(" ") }));
  const scored: NameCandidate[] = pool.map((item) => scoreCandidate(item, context, medianHeight, constructed.has(normalizeNameKey(item.text))));
  const withoutPrefixes = dropContainedNames(dropNamePrefixes(scored));
  for (const dropped of scored) {
    if (!withoutPrefixes.some((kept) => kept.text === dropped.text)) {
      rejected.push({
        text: dropped.text,
        reasons: ["Shorter line is already contained in a fuller name."],
      });
    }
  }

  withoutPrefixes.sort((a, b) => b.score - a.score || (a.source === "recognized" ? -1 : 1));
  const selected = withoutPrefixes[0] ?? null;
  const reliable = isReliable(selected, withoutPrefixes);

  return {
    selected: selected?.text ?? null,
    reliable,
    selectionReason: selectionReason(selected, reliable),
    candidates: withoutPrefixes,
    rejected,
  };
}

export function normalizeNameKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function scoreCandidate(
  item: { text: string; line: OcrLine; words: string[] },
  pool: { text: string; line: OcrLine; words: string[] }[],
  medianHeight: number,
  constructed: boolean,
): NameCandidate {
  const reasons: string[] = [];
  let score = 0;
  const source = constructed ? "constructed" : "recognized";
  if (item.words.length >= 2 && !constructed) {
    score += 5;
    reasons.push("Complete name read on one line.");
  } else if (item.words.length >= 2) {
    score += 3;
    reasons.push("Joined from separate lines because no complete name was already read.");
  } else {
    score += 1;
    reasons.push("Single name token, so it may be only a first name.");
  }
  if (item.words.length >= 3) {
    score += 0.5;
    reasons.push("Multiple surname or middle-name tokens.");
  }

  const box = item.line.boundingBox;
  if (box && medianHeight > 0) {
    const ratio = box.height / medianHeight;
    if (ratio >= 1.15 && ratio < 1.8) {
      score += 0.25;
      reasons.push("Slightly larger than nearby text.");
    } else if (ratio >= 1.8 && item.words.length === 1) {
      score -= 0.5;
      reasons.push("Very large single line, often branding or a first name only.");
    }
  }

  if (item.line.confidence != null) {
    score += item.line.confidence;
    reasons.push(`Recognition score ${item.line.confidence.toFixed(2)}.`);
  }

  if (extendsNearbyFirstName(item, pool)) {
    score += 2;
    reasons.push("Extends a nearby first-name line.");
  }
  if (hasRoleBelow(item, pool)) {
    score += 1;
    reasons.push("A role label is printed just below this line.");
  }
  if (hasCredentialNearby(item, pool)) {
    score += 0.75;
    reasons.push("A credential is printed beside this line.");
  }
  if (isShouted(item.text) && item.words.length >= 3) {
    score -= 3;
    reasons.push("An all-capital multi-word line is more often an organization than a personal name.");
  } else if (item.words.length === 1 && isShouted(item.text) && item.text.length > 6) {
    score -= 2;
    reasons.push("A long single shouted word is more often branding than a surname.");
  }

  return { text: displayName(item.text), score, source, reasons };
}

function dropNamePrefixes(candidates: NameCandidate[]): NameCandidate[] {
  return candidates.filter((candidate) => {
    const key = normalizeNameKey(candidate.text);
    return !candidates.some((other) => {
      if (other === candidate) return false;
      const otherKey = normalizeNameKey(other.text);
      if (otherKey === key) return other.score > candidate.score;
      return otherKey.startsWith(`${key} `) && otherKey.split(" ").length > key.split(" ").length;
    });
  });
}

function dropContainedNames(candidates: NameCandidate[]): NameCandidate[] {
  return candidates.filter((candidate) => {
    const words = normalizeNameKey(candidate.text).split(" ");
    return !candidates.some((other) => {
      if (other === candidate) return false;
      const otherWords = normalizeNameKey(other.text).split(" ");
      return otherWords.length > words.length && words.every((word) => otherWords.includes(word));
    });
  });
}

function isPersonalFullName(candidate: NameCandidate): boolean {
  const words = candidate.text.split(" ").filter(Boolean);
  if (words.length < 2) return false;
  return !(isShouted(candidate.text) && words.length >= 3);
}

function isReliable(selected: NameCandidate | null, candidates: NameCandidate[]): boolean {
  if (!selected || !isPersonalFullName(selected)) return false;
  const rivals = candidates.filter((candidate) => candidate !== selected && isPersonalFullName(candidate));
  const extendsFirst = selected.reasons.some((reason) => reason.startsWith("Extends a nearby"));
  const roleBelow = selected.reasons.some((reason) => reason.startsWith("A role label"));
  if (selected.source === "recognized" && extendsFirst) return true;
  if (rivals.length > 0) return false;
  if (selected.source === "recognized") return true;
  return roleBelow;
}

function selectionReason(selected: NameCandidate | null, reliable: boolean): string {
  if (!selected) return "No plausible attendee name.";
  const evidence = selected.reasons.join(" ");
  if (!reliable) return `Highest local candidate is ${selected.text}, but the evidence is not enough to search automatically. ${evidence}`;
  return `${selected.text} is a credible attendee name. ${evidence}`;
}

function extendsNearbyFirstName(
  item: { text: string; line: OcrLine; words: string[] },
  pool: { text: string; line: OcrLine; words: string[] }[],
): boolean {
  if (item.words.length < 2) return false;
  const first = normalizeKey(item.words[0] ?? "");
  const box = item.line.boundingBox;
  return pool.some((other) => {
    if (other.words.length !== 1 || normalizeKey(other.text) !== first) return false;
    const otherBox = other.line.boundingBox;
    if (!box || !otherBox) return true;
    const gap = box.y - (otherBox.y + otherBox.height);
    return gap > -otherBox.height && gap < otherBox.height * 2.2;
  });
}

function hasRoleBelow(
  item: { line: OcrLine },
  pool: { text: string; line: OcrLine }[],
): boolean {
  const box = item.line.boundingBox;
  if (!box) return false;
  return pool.some((other) => {
    if (!ROLE_LABELS.has(normalizeKey(other.text))) return false;
    const otherBox = other.line.boundingBox;
    if (!otherBox) return false;
    const vertical = otherBox.y - (box.y + box.height);
    const aligned = Math.abs(otherBox.x + otherBox.width / 2 - (box.x + box.width / 2)) < Math.max(box.width, otherBox.width);
    return vertical >= -4 && vertical < box.height * 1.8 && aligned;
  });
}

function hasCredentialNearby(
  item: { line: OcrLine },
  pool: { text: string; line: OcrLine }[],
): boolean {
  const box = item.line.boundingBox;
  if (!box) return false;
  return pool.some((other) => {
    const token = normalizeKey(other.text);
    if (!CREDENTIALS.has(token)) return false;
    const otherBox = other.line.boundingBox;
    if (!otherBox) return false;
    const sameBand = Math.abs(otherBox.y - box.y) < box.height;
    const beside = otherBox.x >= box.x + box.width - 8 && otherBox.x - (box.x + box.width) < box.height * 3;
    return sameBand && beside;
  });
}

function rejectReason(text: string): string | null {
  const key = normalizeKey(text);
  if (ROLE_LABELS.has(key)) return "Attendee category label.";
  if (BRANDING.has(key)) return "Conference branding.";
  if (/^\d[\d\s-]{5,}$/.test(text)) return "Registration or numeric code.";
  const letters = text.replace(/[^\p{L}]/gu, "");
  const digits = text.replace(/\D/gu, "");
  if (digits.length > letters.length) return "Mostly digits.";
  if (!letters) return "No letters.";
  const tokens = text.split(" ");
  if (tokens.every((token) => MONTHS.test(token) || /^\d{1,4}$/.test(token) || token === "-" || token === "–")) {
    return "Date line.";
  }
  if (tokens.some((token) => MONTHS.test(token)) && tokens.some((token) => /^\d{4}$/.test(token))) {
    return "Event date.";
  }
  return null;
}

function isNameWord(word: string): boolean {
  return NAME_WORD.test(word) && word.replace(/[^\p{L}]/gu, "").length > 0;
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[.’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function isShouted(value: string): boolean {
  const letters = value.replace(/[^\p{L}]/gu, "");
  return letters.length > 0 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
}

function displayName(value: string): string {
  const letters = value.replace(/[^\p{L}]/gu, "");
  const shouted = letters.length > 0 && letters === letters.toLocaleUpperCase();
  const whispered = letters.length > 0 && letters === letters.toLocaleLowerCase();
  if (!shouted && !whispered) return value;
  return value
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) => (part ? part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase() : part))
        .join("-"),
    )
    .join(" ");
}

function hasCredibleFullName(lines: OcrLine[]): boolean {
  return lines.some((line) => {
    const text = cleanLine(line.text);
    if (rejectReason(text)) return false;
    const words = text.split(" ").filter((word) => !CREDENTIALS.has(normalizeKey(word)));
    if (words.length < 2 || words.length > 4 || !words.every(isNameWord)) return false;
    return !(isShouted(text) && words.length >= 3);
  });
}

function withStackedNames(lines: OcrLine[], completeNameAlreadyRead: boolean): OcrLine[] {
  if (completeNameAlreadyRead) return lines;
  const singles = lines.filter((line) => line.boundingBox && isSingleNameToken(cleanLine(line.text)));
  const sorted = [...singles].sort((a, b) => (a.boundingBox?.y ?? 0) - (b.boundingBox?.y ?? 0));
  const extras: OcrLine[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const parts = [sorted[index]];
    let box = sorted[index]?.boundingBox;
    if (!box) continue;
    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const next = sorted[nextIndex];
      const nextBox = next?.boundingBox;
      if (!next || !nextBox) continue;
      const gap = nextBox.y - (box.y + box.height);
      if (gap < -nextBox.height * 0.4 || gap > box.height * 1.35) continue;
      if (horizontalOverlap(box, nextBox) < 0.35) continue;
      const nextText = normalizeKey(cleanLine(next.text));
      const partKeys = parts.map((part) => normalizeKey(cleanLine(part.text)));
      if (!nextText || partKeys.some((key) => nextText.startsWith(key) || key.startsWith(nextText))) continue;
      const gluedToAnotherToken = singles.some((other) => {
        const key = normalizeKey(cleanLine(other.text));
        return key.length >= 3 && key !== nextText && (nextText.startsWith(key) || key.startsWith(nextText));
      });
      if (gluedToAnotherToken) continue;
      parts.push(next);
      box = {
        x: Math.min(box.x, nextBox.x),
        y: Math.min(box.y, nextBox.y),
        width: Math.max(box.x + box.width, nextBox.x + nextBox.width) - Math.min(box.x, nextBox.x),
        height: Math.max(box.y + box.height, nextBox.y + nextBox.height) - Math.min(box.y, nextBox.y),
      };
      if (parts.length >= 4) break;
    }
    if (parts.length < 2 || !box) continue;
    const text = parts.map((part) => cleanLine(part.text)).join(" ");
    if (lines.some((line) => normalizeNameKey(line.text) === normalizeNameKey(text))) continue;
    const confidences = parts.map((part) => part.confidence).filter((value): value is number => value != null);
    extras.push({
      text,
      rawText: `constructed:${text}`,
      confidence: confidences.length === parts.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
      boundingBox: box,
    });
  }
  return [...lines, ...extras];
}

function isSingleNameToken(text: string): boolean {
  return Boolean(text) && !text.includes(" ") && isNameWord(text) && !ROLE_LABELS.has(normalizeKey(text)) && !BRANDING.has(normalizeKey(text));
}

function horizontalOverlap(a: { x: number; width: number }, b: { x: number; width: number }): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const overlap = Math.max(0, right - left);
  return overlap / Math.min(a.width, b.width);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
