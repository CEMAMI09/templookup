export type QuestionType =
  | "short-text"
  | "long-text"
  | "single-select"
  | "multi-select"
  | "yes-no";

export type VisibleWhen = {
  questionId: string;
  equals?: string | boolean;
  includes?: string;
};

export type QuestionDefinition = {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  placeholder?: string;
  /** Show this question only after another answer matches. */
  visibleWhen?: VisibleWhen;
  /** Render this answer under a parent option instead of as its own block. */
  attachTo?: { questionId: string; option: string };
};

export type QuestionnaireSection = {
  id: string;
  title: string;
  description?: string;
  questions: QuestionDefinition[];
};

export type AnswerValue = string | string[] | boolean;

export type InquiryAnswer = {
  questionId: string;
  label: string;
  value: AnswerValue;
  display: string;
};

export type InquiryRecord = {
  inquiryId: string;
  contactId: string;
  noteId: string | null;
  submittedAt: string;
  staffName: string;
  answers: InquiryAnswer[];
  notes: string | null;
  verified?: boolean;
};

export type CrmNote = {
  id: string;
  body: string;
  createdAt: string | null;
};

export type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  npi: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  address: string | null;
  website: string | null;
  tags: string[];
  extraFields: { id: string; label: string; value: string }[];
  titleAvailable: boolean;
  npiAvailable: boolean;
  extraFieldsAvailable: boolean;
  dateAdded: string | null;
  dateUpdated: string | null;
  source: string | null;
};

export type ContactSearchResponse = {
  contacts: Contact[];
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
};

export type ContactHistory = {
  available: boolean;
  inquiries: InquiryRecord[];
  notes: CrmNote[];
  message: string | null;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    matches?: Contact[];
  };
};

export const INQUIRY_HEADER = "AAOPTOM 2026 INQUIRY";
