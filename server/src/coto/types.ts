import type { Contact, CrmNote } from "../../../shared/types.ts";

export type FieldCatalog = {
  status: "ready" | "unavailable";
  titleFieldId: string | null;
  npiFieldId: string | null;
  labels: Map<string, string>;
};

export type ContactWrite = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  city: string | null;
  state: string | null;
  address?: string | null;
  postalCode?: string | null;
  title?: string | null;
  npi?: string | null;
};

export type RawNote = {
  id: string;
  body: string;
  contactId: string | null;
  createdAt: string | null;
};

export interface Crm {
  mode: "live" | "mock";
  searchContacts(
    query: string,
    page: number,
    pageSize: number,
    signal?: AbortSignal,
  ): Promise<{ contacts: Contact[]; total: number | null }>;
  getContact(id: string, signal?: AbortSignal): Promise<Contact>;
  createContact(input: ContactWrite): Promise<Contact>;
  updateContact(id: string, input: Partial<ContactWrite>): Promise<Contact>;
  listNotes(contactId: string): Promise<RawNote[]>;
  createNote(contactId: string, body: string): Promise<RawNote>;
  getFieldCatalog(): Promise<FieldCatalog>;
}

export function emptyCatalog(): FieldCatalog {
  return {
    status: "unavailable",
    titleFieldId: null,
    npiFieldId: null,
    labels: new Map(),
  };
}

export function toCrmNote(note: RawNote): CrmNote {
  return { id: note.id, body: note.body, createdAt: note.createdAt };
}
