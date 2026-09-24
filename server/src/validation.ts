import { z } from "zod";
import { isQuestionVisible, questionnaire } from "../../shared/questionnaire.ts";
import type { AnswerValue } from "../../shared/types.ts";
import { AppError } from "./errors.ts";

const contactIdSchema = z.string().regex(/^[A-Za-z0-9]{8,40}$/);
const personName = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(80)
  .refine((value) => !/[<>]/.test(value), "Remove special characters from this name.");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/[<>]/.test(value), "Remove unsupported characters.")
    .nullable()
    .optional();
const emailSchema = z.string().trim().email("Enter a valid email address.").max(160).nullable().optional();
const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .refine((value) => value === "" || isPhone(value), "Enter a valid phone number.")
  .nullable()
  .optional();
const npiSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{10}$/.test(value), "NPI must be 10 digits.")
  .nullable()
  .optional();

const contactFields = {
  firstName: personName,
  lastName: personName,
  email: emailSchema,
  phone: phoneSchema,
  company: optionalText(160),
  city: optionalText(80),
  state: optionalText(80),
  address: optionalText(160),
  postalCode: optionalText(20),
  title: optionalText(120),
  npi: npiSchema,
};

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Enter at least 2 characters.").max(75, "Use 75 characters or fewer."),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const contactParamsSchema = z.object({ id: contactIdSchema });

export const createContactSchema = z.object({
  ...contactFields,
  acknowledgeDuplicates: z.boolean().optional().default(false),
});

export const updateContactSchema = z
  .object(contactFields)
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Nothing to update.",
  });

const uuidSchema = z.string().uuid();

export const inquirySchema = z.object({
  inquiryId: uuidSchema,
  notes: z.string().trim().max(4000).optional().nullable(),
  answers: z.array(
    z.object({
      questionId: z.string().trim().min(1).max(80),
      value: z.union([z.string().max(2000), z.array(z.string().max(200)).max(20), z.boolean()]),
    }),
  ),
});

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new AppError(400, "VALIDATION", "Check the highlighted fields and try again.", { fields });
}

export function validateInquiryAnswers(answers: { questionId: string; value: AnswerValue }[]) {
  const fields: Record<string, string> = {};
  const byId = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  for (const question of questionnaire) {
    if (!isQuestionVisible(question, byId)) continue;
    const value = byId.get(question.id);
    if (question.required && isEmptyAnswer(value)) {
      fields[question.id] = "This question is required.";
      continue;
    }
    if (value === undefined || isEmptyAnswer(value)) continue;
    if (question.type === "yes-no" && typeof value !== "boolean") {
      fields[question.id] = "Choose yes or no.";
    }
    if (question.type === "single-select") {
      if (typeof value !== "string" || !question.options?.includes(value)) {
        fields[question.id] = "Choose one of the listed options.";
      }
    }
    if (question.type === "multi-select") {
      if (!Array.isArray(value) || value.some((item) => !question.options?.includes(item))) {
        fields[question.id] = "Choose only the listed options.";
      }
    }
    if ((question.type === "short-text" || question.type === "long-text") && typeof value !== "string") {
      fields[question.id] = "Enter a text answer.";
    }
  }
  const known = new Set(questionnaire.map((question) => question.id));
  if (answers.some((answer) => !known.has(answer.questionId))) {
    fields.form = "The questionnaire is out of date. Reload the page.";
  }
  if (Object.keys(fields).length > 0) {
    throw new AppError(400, "VALIDATION", "Check the highlighted fields and try again.", { fields });
  }
}

export function blankToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isPhone(value: string): boolean {
  if (!/^[0-9+().\-\s]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function isEmptyAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
