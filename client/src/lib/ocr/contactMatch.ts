import type { NameCandidate, NameDecision } from "./types";

export interface ContactName {
  firstName: string;
  lastName: string;
  fullName: string;
}

export interface ContactCheck {
  query: string;
  quality: "exact" | "fuzzy" | "none";
  matchedName: string | null;
}

export function verificationQueries(candidates: NameCandidate[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of candidates) {
    const words = candidate.text.split(" ").filter(Boolean);
    if (words.length < 2 || (isAllCaps(candidate.text) && words.length >= 3)) continue;
    const key = normalizePersonName(candidate.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    queries.push(candidate.text);
    if (queries.length >= 3) break;
  }
  return queries;
}

export function checkCandidate(query: string, contacts: ContactName[]): ContactCheck {
  const candidate = normalizePersonName(query);
  const words = candidate.split(" ").filter(Boolean);
  const first = words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  let fuzzyName: string | null = null;
  let fuzzyConflict = false;

  for (const contact of contacts) {
    const full = normalizePersonName(contact.fullName);
    const contactFirst = normalizePersonName(contact.firstName) || full.split(" ")[0] || "";
    const contactLast = normalizePersonName(contact.lastName) || full.split(" ").at(-1) || "";
    const joined = [contactFirst, contactLast].filter(Boolean).join(" ");
    if (full === candidate || joined === candidate) {
      return { query, quality: "exact", matchedName: contact.fullName || query };
    }
    if (!first || !last || !contactFirst || !contactLast) continue;
    const firstDistance = editDistance(first, contactFirst);
    const lastDistance = editDistance(last, contactLast);
    const firstOk = first === contactFirst || (first.length >= 4 && firstDistance <= 1);
    const lastLimit = Math.max(contactLast.length, last.length) >= 8 ? 2 : 1;
    const lastOk = last.length >= 4 && contactLast.length >= 4 && lastDistance > 0 && lastDistance <= lastLimit;
    if (!firstOk || !lastOk || firstDistance + lastDistance === 0) continue;
    if (fuzzyName && normalizePersonName(fuzzyName) !== full) fuzzyConflict = true;
    else fuzzyName = contact.fullName || query;
  }

  if (fuzzyName && !fuzzyConflict) return { query, quality: "fuzzy", matchedName: fuzzyName };
  return { query, quality: "none", matchedName: null };
}

export function applyContactChecks(decision: NameDecision, checks: ContactCheck[]): NameDecision {
  const exactNames = uniqueMatched(checks, "exact");
  if (exactNames.length === 1) {
    const matchedName = checks.find((check) => check.quality === "exact")?.matchedName ?? exactNames[0] ?? decision.selected;
    return {
      ...decision,
      selected: matchedName,
      reliable: true,
      selectionReason: `COTO returned an exact full-name match for ${matchedName}.`,
    };
  }
  if (exactNames.length > 1) {
    return {
      ...decision,
      reliable: false,
      selectionReason: "COTO matched more than one different full name. Choose the attendee name before searching.",
    };
  }
  if (decision.reliable && decision.selected) {
    return {
      ...decision,
      selectionReason: `${decision.selectionReason} COTO did not need to change this name.`,
    };
  }
  const fuzzyNames = uniqueMatched(checks, "fuzzy");
  if (fuzzyNames.length === 1) {
    const check = checks.find((item) => item.quality === "fuzzy");
    return {
      ...decision,
      selected: check?.matchedName ?? decision.selected,
      reliable: true,
      selectionReason: `COTO full name ${check?.matchedName} closely matches the OCR candidate ${check?.query}.`,
    };
  }
  return decision;
}

export function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}'. -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function uniqueMatched(checks: ContactCheck[], quality: ContactCheck["quality"]): string[] {
  const names = new Set<string>();
  for (const check of checks) {
    if (check.quality === quality && check.matchedName) names.add(normalizePersonName(check.matchedName));
  }
  return [...names];
}

function isAllCaps(value: string): boolean {
  const letters = value.replace(/[^\p{L}]/gu, "");
  return letters.length > 0 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
}

function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const grid = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) grid[row]![0] = row;
  for (let column = 0; column < columns; column += 1) grid[0]![column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      grid[row]![column] = Math.min((grid[row - 1]![column] ?? 0) + 1, (grid[row]![column - 1] ?? 0) + 1, (grid[row - 1]![column - 1] ?? 0) + cost);
    }
  }
  return grid[left.length]![right.length] ?? 0;
}
