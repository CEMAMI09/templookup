import { INQUIRY_HEADER, type InquiryAnswer, type InquiryRecord } from "./types.ts";

const MAX_NOTE_LENGTH = 8000;

function sanitizeBlock(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(
      /^(AAOPTOM 2026 INQUIRY|Inquiry ID:|Submitted:|Staff:|Contact ID:|Question:|Answer:|General notes:)/gm,
      " $1",
    )
    .trim();
}

export function formatInquiryNote(input: {
  inquiryId: string;
  contactId: string;
  submittedAt: string;
  staffName: string;
  answers: InquiryAnswer[];
  notes: string | null;
}): string {
  const lines = [
    INQUIRY_HEADER,
    `Inquiry ID: ${input.inquiryId}`,
    `Submitted: ${input.submittedAt}`,
    `Staff: ${sanitizeBlock(input.staffName)}`,
    `Contact ID: ${input.contactId}`,
    "",
  ];

  for (const answer of input.answers) {
    lines.push(`Question: ${sanitizeBlock(answer.label)}`);
    lines.push(`Answer: ${sanitizeBlock(answer.display) || "Not answered"}`);
    lines.push("");
  }

  if (input.notes && input.notes.trim()) {
    lines.push("General notes:");
    lines.push(sanitizeBlock(input.notes));
  }

  const body = lines.join("\n").trim() + "\n";
  if (body.length > MAX_NOTE_LENGTH) {
    throw new Error("INQUIRY_TOO_LONG");
  }
  return body;
}

export function parseInquiryNote(
  body: string,
  noteId: string | null,
): InquiryRecord | null {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized.startsWith(INQUIRY_HEADER)) return null;

  const inquiryId = normalized.match(/^Inquiry ID:\s*(\S+)/m)?.[1];
  const submittedAt = normalized.match(/^Submitted:\s*(.+)$/m)?.[1]?.trim();
  const staffName = normalized.match(/^Staff:\s*(.+)$/m)?.[1]?.trim();
  const contactId = normalized.match(/^Contact ID:\s*(\S+)/m)?.[1];
  if (!inquiryId || !submittedAt || !staffName || !contactId) return null;

  const notesSplit = normalized.split(/\nGeneral notes:\n/);
  const main = notesSplit[0] ?? normalized;
  const notes = notesSplit.length > 1 ? notesSplit.slice(1).join("\nGeneral notes:\n").trim() : null;

  const answers: InquiryAnswer[] = [];
  const blocks = main.split(/\n(?=Question: )/);
  for (const block of blocks) {
    const question = block.match(/Question:\s*(.+)\nAnswer:\s*([\s\S]*)/);
    if (!question) continue;
    const label = question[1]?.trim() ?? "";
    const display = (question[2] ?? "").trim();
    if (!label) continue;
    answers.push({
      questionId: label,
      label,
      value: display,
      display,
    });
  }

  return {
    inquiryId,
    contactId,
    noteId,
    submittedAt,
    staffName,
    answers,
    notes: notes || null,
  };
}

export function inquiryIdFromNote(body: string): string | null {
  if (!body.includes(INQUIRY_HEADER)) return null;
  return body.match(/^Inquiry ID:\s*(\S+)/m)?.[1] ?? null;
}
