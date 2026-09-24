import { randomUUID } from "node:crypto";
import type { Contact } from "../../../shared/types.ts";
import { AppError } from "../errors.ts";
import { normalizeContact } from "./normalize.ts";
import type { ContactWrite, Crm, FieldCatalog, RawNote } from "./types.ts";

const catalog: FieldCatalog = {
  status: "ready",
  titleFieldId: "field_title",
  npiFieldId: "field_npi",
  labels: new Map([
    ["field_title", "Professional title"],
    ["field_npi", "NPI"],
    ["field_specialty", "Specialty"],
  ]),
};

type Stored = { contact: Contact; notes: RawNote[] };

function contact(partial: Partial<Contact> & Pick<Contact, "id" | "firstName" | "lastName">): Contact {
  return {
    fullName: `${partial.firstName} ${partial.lastName}`,
    email: null,
    phone: null,
    company: null,
    title: null,
    npi: null,
    city: null,
    state: null,
    country: "US",
    postalCode: null,
    address: null,
    website: null,
    tags: [],
    extraFields: [],
    titleAvailable: true,
    npiAvailable: true,
    extraFieldsAvailable: true,
    dateAdded: "2024-03-01T12:00:00.000Z",
    dateUpdated: "2025-11-02T12:00:00.000Z",
    source: "mock",
    ...partial,
  };
}

export class MockCrm implements Crm {
  readonly mode = "mock" as const;
  private readonly records = new Map<string, Stored>();

  constructor() {
    const jordanA = contact({
      id: "mockJordanA",
      firstName: "Jordan",
      lastName: "Lee",
      email: "jordan.lee@northshore.example",
      phone: "+1 555-010-1001",
      company: "Northshore Eye",
      title: "Optometrist",
      npi: "1234567890",
      city: "Portland",
      state: "OR",
      tags: ["AAOptom 2025", "Speaker"],
      extraFields: [{ id: "field_specialty", label: "Specialty", value: "Cornea" }],
    });
    const jordanB = contact({
      id: "mockJordanB",
      firstName: "Jordan",
      lastName: "Lee",
      email: "jlee@harborview.example",
      phone: "+1 555-010-2002",
      company: "Harborview Vision",
      title: "Ophthalmologist",
      city: "Seattle",
      state: "WA",
      tags: ["Exhibitor"],
    });
    const sparse = contact({
      id: "mockSparse",
      firstName: "Avery",
      lastName: "Chen",
      fullName: "Avery Chen",
      city: "Austin",
      state: null,
    });
    const priya = contact({
      id: "mockPriya",
      firstName: "Priya",
      lastName: "Shah",
      email: "priya.shah@lakeside.example",
      phone: "+1 555-010-3003",
      company: "Lakeside Optometry",
      title: "Practice administrator",
      city: "Madison",
      state: "WI",
      address: "18 State Street",
      postalCode: "53703",
    });
    this.records.set(jordanA.id, {
      contact: jordanA,
      notes: [
        {
          id: "note_existing_inquiry",
          contactId: jordanA.id,
          createdAt: "2025-10-12T15:04:00.000Z",
          body: [
            "AAOPTOM 2026 INQUIRY",
            "Inquiry ID: 11111111-1111-4111-8111-111111111111",
            "Submitted: 2025-10-12T15:04:00.000Z",
            "Staff: Earlier Staff",
            `Contact ID: ${jordanA.id}`,
            "",
            "Question: Example: What best describes you?",
            "Answer: Optometrist",
            "",
            "General notes:",
            "Met at a previous planning call.",
          ].join("\n"),
        },
        {
          id: "note_plain",
          contactId: jordanA.id,
          createdAt: "2025-06-01T18:00:00.000Z",
          body: "CRM note: Prefers morning calls.",
        },
      ],
    });
    this.records.set(jordanB.id, { contact: jordanB, notes: [] });
    this.records.set(sparse.id, { contact: sparse, notes: [] });
    this.records.set(priya.id, { contact: priya, notes: [] });
  }

  async searchContacts(query: string, page: number, pageSize: number) {
    const needle = query.toLowerCase();
    const matches = [...this.records.values()]
      .map((record) => record.contact)
      .filter((item) =>
        [item.fullName, item.email, item.phone, item.company, item.city]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    const start = (page - 1) * pageSize;
    return { contacts: matches.slice(start, start + pageSize), total: matches.length };
  }

  async getContact(id: string) {
    const record = this.records.get(id);
    if (!record) throw new AppError(404, "NOT_FOUND", "That contact could not be found.");
    return record.contact;
  }

  async createContact(input: ContactWrite) {
    const id = `mock${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const created = normalizeContact(
      {
        id,
        firstName: input.firstName,
        lastName: input.lastName,
        name: `${input.firstName} ${input.lastName}`,
        email: input.email,
        phone: input.phone,
        companyName: input.company,
        city: input.city,
        state: input.state,
        address1: input.address,
        postalCode: input.postalCode,
        source: "AAOptom 2026",
        tags: ["AAOptom 2026"],
        dateAdded: new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
        customFields: [
          input.title ? { id: "field_title", value: input.title } : null,
          input.npi ? { id: "field_npi", value: input.npi } : null,
        ].filter(Boolean),
      },
      catalog,
    );
    this.records.set(id, { contact: created, notes: [] });
    return created;
  }

  async updateContact(id: string, input: Partial<ContactWrite>) {
    const current = await this.getContact(id);
    const next: Contact = {
      ...current,
      firstName: input.firstName ?? current.firstName,
      lastName: input.lastName ?? current.lastName,
      email: input.email === undefined ? current.email : input.email,
      phone: input.phone === undefined ? current.phone : input.phone,
      company: input.company === undefined ? current.company : input.company,
      city: input.city === undefined ? current.city : input.city,
      state: input.state === undefined ? current.state : input.state,
      address: input.address === undefined ? current.address : input.address,
      postalCode: input.postalCode === undefined ? current.postalCode : input.postalCode,
      title: input.title === undefined ? current.title : input.title,
      npi: input.npi === undefined ? current.npi : input.npi,
      dateUpdated: new Date().toISOString(),
    };
    next.fullName = `${next.firstName} ${next.lastName}`.trim() || next.fullName;
    this.records.get(id)!.contact = next;
    return next;
  }

  async listNotes(contactId: string) {
    const record = this.records.get(contactId);
    if (!record) throw new AppError(404, "NOT_FOUND", "That contact could not be found.");
    return record.notes;
  }

  async createNote(contactId: string, body: string) {
    const record = this.records.get(contactId);
    if (!record) throw new AppError(404, "NOT_FOUND", "That contact could not be found.");
    const note: RawNote = {
      id: `note_${randomUUID().slice(0, 8)}`,
      body,
      contactId,
      createdAt: new Date().toISOString(),
    };
    record.notes.unshift(note);
    return note;
  }

  async getFieldCatalog() {
    return catalog;
  }
}
