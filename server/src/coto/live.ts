import type { Contact } from "../../../shared/types.ts";
import type { AppConfig } from "../config.ts";
import { AppError } from "../errors.ts";
import { isNpiField, isTitleField, normalizeContact } from "./normalize.ts";
import type { ContactWrite, Crm, FieldCatalog, RawNote } from "./types.ts";

type RequestOptions = {
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  signal?: AbortSignal;
};

function safeDetail(text: string, token: string): string {
  const trimmed = text.replace(/\s+/g, " ").slice(0, 180);
  if (!trimmed) return "empty response";
  if (token && trimmed.includes(token)) return "response omitted";
  if (trimmed.includes("@") || /\d{3}[-.\s]?\d{3}/.test(trimmed)) return "response omitted";
  return trimmed;
}

const searchCache = new Map<string, { expires: number; contacts: Contact[]; total: number | null }>();

export class LiveCrm implements Crm {
  readonly mode = "live" as const;
  private catalogPromise: Promise<FieldCatalog> | null = null;

  constructor(private readonly config: AppConfig["coto"]) {}

  async searchContacts(query: string, page: number, pageSize: number, signal?: AbortSignal) {
    const cacheKey = `contains-v2|${query.toLowerCase()}|${page}|${pageSize}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return { contacts: cached.contacts, total: cached.total };
    }
    const [body, catalog] = await Promise.all([
      this.request({
        method: "POST",
        path: "/contacts/search",
        signal,
        body: {
          locationId: this.config.locationId,
          page,
          pageLimit: pageSize,
          query,
        },
      }),
      this.getFieldCatalog(),
    ]);
    const record = asRecord(body);
    if (!record || !Array.isArray(record.contacts)) {
      throw new AppError(502, "CRM_UNAVAILABLE", "The CRM returned an unexpected search response.");
    }
    const contacts = record.contacts.map((contact) => normalizeContact(contact, catalog));
    const total = numberOrNull(record.total) ?? numberOrNull(asRecord(record.meta)?.total);
    searchCache.set(cacheKey, { expires: Date.now() + 30_000, contacts, total });
    return { contacts, total };
  }

  async getContact(id: string, signal?: AbortSignal) {
    const [body, catalog] = await Promise.all([
      this.request({ method: "GET", path: `/contacts/${encodeURIComponent(id)}`, signal }),
      this.getFieldCatalog(),
    ]);
    const record = asRecord(body);
    const contact = record?.contact ?? body;
    try {
      return normalizeContact(contact, catalog);
    } catch {
      throw new AppError(502, "CRM_UNAVAILABLE", "The CRM returned an unexpected contact response.");
    }
  }

  async createContact(input: ContactWrite) {
    const catalog = await this.getFieldCatalog();
    const body = await this.request({
      method: "POST",
      path: "/contacts/",
      body: {
        locationId: this.config.locationId,
        firstName: input.firstName,
        lastName: input.lastName,
        name: `${input.firstName} ${input.lastName}`,
        email: input.email,
        phone: input.phone,
        companyName: input.company,
        city: input.city,
        state: input.state,
        address1: input.address ?? null,
        postalCode: input.postalCode ?? null,
        source: "AAOptom 2026",
        tags: ["AAOptom 2026"],
        customFields: customFieldPayload(input, catalog),
      },
    });
    return this.readWrittenContact(body);
  }

  async updateContact(id: string, input: Partial<ContactWrite>) {
    const catalog = await this.getFieldCatalog();
    const payload: Record<string, unknown> = {};
    if (input.firstName !== undefined) payload.firstName = input.firstName;
    if (input.lastName !== undefined) payload.lastName = input.lastName;
    if (input.firstName !== undefined || input.lastName !== undefined) {
      payload.name = `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim();
    }
    if (input.email !== undefined) payload.email = input.email;
    if (input.phone !== undefined) payload.phone = input.phone;
    if (input.company !== undefined) payload.companyName = input.company;
    if (input.city !== undefined) payload.city = input.city;
    if (input.state !== undefined) payload.state = input.state;
    if (input.address !== undefined) payload.address1 = input.address;
    if (input.postalCode !== undefined) payload.postalCode = input.postalCode;
    const customFields = customFieldPayload(input, catalog);
    if (customFields.length > 0) payload.customFields = customFields;

    const body = await this.request({
      method: "PUT",
      path: `/contacts/${encodeURIComponent(id)}`,
      body: payload,
    });
    const record = asRecord(body);
    if (record?.succeeded === false) {
      throw new AppError(502, "CRM_WRITE_FAILED", "The CRM did not update this contact.");
    }
    try {
      return await this.readWrittenContact(body);
    } catch {
      return this.getContact(id);
    }
  }

  async listNotes(contactId: string): Promise<RawNote[]> {
    const body = await this.request({
      method: "GET",
      path: `/contacts/${encodeURIComponent(contactId)}/notes`,
    });
    const record = asRecord(body);
    if (!record || !Array.isArray(record.notes)) {
      throw new AppError(502, "CRM_UNAVAILABLE", "The CRM returned an unexpected notes response.");
    }
    return record.notes.map((note) => normalizeNote(note, contactId));
  }

  async createNote(contactId: string, body: string): Promise<RawNote> {
    const response = await this.request({
      method: "POST",
      path: `/contacts/${encodeURIComponent(contactId)}/notes`,
      body: { body },
    });
    const note = normalizeNote(asRecord(response)?.note, contactId);
    if (!note.id) {
      throw new AppError(502, "CRM_WRITE_FAILED", "The CRM did not confirm the saved inquiry.");
    }
    return note;
  }

  async getFieldCatalog(): Promise<FieldCatalog> {
    if (!this.catalogPromise) {
      this.catalogPromise = this.loadCatalog().catch((error) => {
        this.catalogPromise = null;
        throw error;
      });
    }
    try {
      return await this.catalogPromise;
    } catch {
      return {
        status: "unavailable",
        titleFieldId: this.config.titleFieldId || null,
        npiFieldId: this.config.npiFieldId || null,
        labels: new Map(),
      };
    }
  }

  private async loadCatalog(): Promise<FieldCatalog> {
    const body = await this.request({
      method: "GET",
      path: `/locations/${encodeURIComponent(this.config.locationId)}/customFields?model=contact`,
    });
    const record = asRecord(body);
    if (!record || !Array.isArray(record.customFields)) {
      throw new AppError(502, "CRM_UNAVAILABLE", "Custom fields could not be loaded.");
    }
    const labels = new Map<string, string>();
    let npiFieldId = this.config.npiFieldId || null;
    let titleFieldId = this.config.titleFieldId || null;
    for (const field of record.customFields) {
      const item = asRecord(field);
      const id = text(item?.id);
      const name = text(item?.name) ?? "";
      const fieldKey = text(item?.fieldKey) ?? "";
      if (!id || !name) continue;
      labels.set(id, name);
      if (!this.config.npiFieldId && isNpiField(name, fieldKey)) npiFieldId = id;
      if (!this.config.titleFieldId && isTitleField(name)) titleFieldId = id;
    }
    return { status: "ready", titleFieldId, npiFieldId, labels };
  }

  private async readWrittenContact(body: unknown) {
    const record = asRecord(body);
    const catalog = await this.getFieldCatalog();
    try {
      return normalizeContact(record?.contact, catalog);
    } catch {
      throw new AppError(502, "CRM_WRITE_FAILED", "The CRM did not return the saved contact.");
    }
  }

  private async request(options: RequestOptions, attempt = 0): Promise<unknown> {
    const timeout = AbortSignal.timeout(12_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${options.path}`, {
        method: options.method,
        signal,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Version: this.config.version,
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new AppError(499, "CRM_UNAVAILABLE", "The request was cancelled.");
      }
      if (options.method === "GET" && attempt < 2) {
        await delay(300 * (attempt + 1));
        return this.request(options, attempt + 1);
      }
      const detail = error instanceof Error ? error.name : "network";
      throw new AppError(503, "CRM_UNAVAILABLE", "The CRM could not be reached. Try again.", {
        logDetail: detail,
      });
    }

    const rawText = await response.text();
    if (response.status === 429 || response.status >= 500) {
      if (options.method === "GET" && attempt < 2) {
        await delay(retryDelay(response, attempt));
        return this.request(options, attempt + 1);
      }
    }
    if (!response.ok) {
      throw mapStatus(response.status, safeDetail(rawText, this.config.token));
    }
    if (!rawText) return {};
    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      throw new AppError(502, "CRM_UNAVAILABLE", "The CRM returned an unreadable response.");
    }
  }
}

function customFieldPayload(input: Partial<ContactWrite>, catalog: FieldCatalog) {
  const fields: { id: string; fieldValue: string }[] = [];
  if (input.title !== undefined && catalog.titleFieldId) {
    fields.push({ id: catalog.titleFieldId, fieldValue: input.title ?? "" });
  }
  if (input.npi !== undefined && catalog.npiFieldId) {
    fields.push({ id: catalog.npiFieldId, fieldValue: input.npi ?? "" });
  }
  return fields;
}

function normalizeNote(input: unknown, fallbackContactId: string): RawNote {
  const record = asRecord(input);
  return {
    id: text(record?.id) ?? "",
    body: text(record?.body) ?? "",
    contactId: text(record?.contactId) ?? fallbackContactId,
    createdAt: text(record?.dateAdded) ?? text(record?.createdAt) ?? text(record?.dateUpdated),
  };
}

function mapStatus(status: number, detail: string): AppError {
  if (status === 401) {
    return new AppError(502, "CRM_AUTH", "The CRM rejected the integration credentials.", { logDetail: detail });
  }
  if (status === 403) {
    return new AppError(502, "CRM_FORBIDDEN", "The CRM integration does not have permission for this action.", {
      logDetail: detail,
    });
  }
  if (status === 404) {
    return new AppError(404, "NOT_FOUND", "That contact could not be found.", { logDetail: detail });
  }
  if (status === 429) {
    return new AppError(429, "CRM_RATE_LIMIT", "The CRM is busy. Wait a moment and try again.", { logDetail: detail });
  }
  if (status >= 500) {
    return new AppError(503, "CRM_UNAVAILABLE", "The CRM is temporarily unavailable. Try again.", { logDetail: detail });
  }
  return new AppError(502, "CRM_WRITE_FAILED", "The CRM could not complete that request.", { logDetail: detail });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function retryDelay(response: Response, attempt: number): number {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 5_000);
  return 400 * (attempt + 1);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
