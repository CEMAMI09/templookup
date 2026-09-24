import { isQuestionVisible, questionnaire } from "../../../shared/questionnaire.ts";
import { formatInquiryNote, inquiryIdFromNote, parseInquiryNote } from "../../../shared/inquiry-note.ts";
import type { AnswerValue, ContactHistory, InquiryAnswer, InquiryRecord } from "../../../shared/types.ts";
import { AppError } from "../errors.ts";
import type { Crm } from "../coto/types.ts";

export type InquiryInput = {
  contactId: string;
  inquiryId: string;
  answers: { questionId: string; value: AnswerValue }[];
  notes: string | null;
  staffName: string;
};

const settled = new Map<string, InquiryRecord>();
const inflight = new Map<string, Promise<InquiryRecord>>();

export async function createInquiry(crm: Crm, input: InquiryInput): Promise<InquiryRecord> {
  const key = `${input.contactId}:${input.inquiryId}`;
  const done = settled.get(key);
  if (done) return done;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = writeInquiry(crm, input);
  inflight.set(key, promise);
  try {
    const result = await promise;
    settled.set(key, result);
    if (settled.size > 500) {
      const oldest = settled.keys().next().value;
      if (oldest) settled.delete(oldest);
    }
    return result;
  } finally {
    inflight.delete(key);
  }
}

async function writeInquiry(crm: Crm, input: InquiryInput): Promise<InquiryRecord> {
  const existing = await findExisting(crm, input.contactId, input.inquiryId);
  if (existing) return { ...existing, verified: true };

  const answers = normalizeAnswers(input.answers);
  const submittedAt = new Date().toISOString();
  let body: string;
  try {
    body = formatInquiryNote({
      inquiryId: input.inquiryId,
      contactId: input.contactId,
      submittedAt,
      staffName: input.staffName,
      answers,
      notes: input.notes,
    });
  } catch {
    throw new AppError(400, "VALIDATION", "This inquiry is too long to save. Shorten the notes and try again.");
  }

  const note = await crm.createNote(input.contactId, body);
  if (note.contactId && note.contactId !== input.contactId) {
    throw new AppError(502, "CRM_WRITE_FAILED", "The inquiry was not saved to the selected contact.");
  }

  let verified = false;
  try {
    const notes = await crm.listNotes(input.contactId);
    verified = notes.some((item) => item.id === note.id || inquiryIdFromNote(item.body) === input.inquiryId);
  } catch {
    verified = false;
  }

  return {
    inquiryId: input.inquiryId,
    contactId: input.contactId,
    noteId: note.id || null,
    submittedAt,
    staffName: input.staffName,
    answers,
    notes: input.notes,
    verified,
  };
}

export async function getContactHistory(crm: Crm, contactId: string): Promise<ContactHistory> {
  try {
    const notes = await crm.listNotes(contactId);
    const inquiries: InquiryRecord[] = [];
    const plain = [];
    for (const note of notes) {
      const inquiry = parseInquiryNote(note.body, note.id);
      if (inquiry && inquiry.contactId === contactId) {
        inquiries.push(inquiry);
      } else {
        plain.push({ id: note.id, body: note.body, createdAt: note.createdAt });
      }
    }
    const byDate = (value: string | null) => (value ? Date.parse(value) : 0);
    inquiries.sort((a, b) => byDate(b.submittedAt) - byDate(a.submittedAt));
    plain.sort((a, b) => byDate(b.createdAt) - byDate(a.createdAt));
    return { available: true, inquiries, notes: plain, message: null };
  } catch (error) {
    if (error instanceof AppError && (error.code === "CRM_FORBIDDEN" || error.code === "CRM_AUTH")) {
      return {
        available: false,
        inquiries: [],
        notes: [],
        message: "Previous records could not be loaded with the current CRM permissions.",
      };
    }
    if (error instanceof AppError && error.code === "NOT_FOUND") throw error;
    return {
      available: false,
      inquiries: [],
      notes: [],
      message: "Previous records are temporarily unavailable.",
    };
  }
}

export async function getInquiry(crm: Crm, contactId: string, inquiryId: string): Promise<InquiryRecord | null> {
  const history = await getContactHistory(crm, contactId);
  if (!history.available) {
    throw new AppError(503, "CRM_UNAVAILABLE", history.message ?? "Inquiry history is unavailable.");
  }
  return history.inquiries.find((inquiry) => inquiry.inquiryId === inquiryId) ?? null;
}

async function findExisting(crm: Crm, contactId: string, inquiryId: string): Promise<InquiryRecord | null> {
  const notes = await crm.listNotes(contactId);
  for (const note of notes) {
    if (inquiryIdFromNote(note.body) !== inquiryId) continue;
    const parsed = parseInquiryNote(note.body, note.id);
    if (parsed?.contactId === contactId) return parsed;
  }
  return null;
}

function normalizeAnswers(answers: { questionId: string; value: AnswerValue }[]): InquiryAnswer[] {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  return questionnaire.filter((question) => isQuestionVisible(question, byId)).map((question) => {
    const value = byId.get(question.id);
    return {
      questionId: question.id,
      label: question.label,
      value: value ?? "",
      display: displayAnswer(value),
    };
  });
}

function displayAnswer(value: AnswerValue | undefined): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") return value.trim();
  return "";
}
