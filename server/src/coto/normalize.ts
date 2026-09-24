import type { Contact } from "../../../shared/types.ts";
import type { FieldCatalog } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isAllLowercase(value: string): boolean {
  const letters = value.replace(/[^A-Za-z]/g, "");
  return letters.length > 0 && letters === letters.toLowerCase();
}

/** Title-case names the CRM stored in lowercase, and leave mixed-case values unchanged. */
export function displayCase(value: string): string {
  if (!isAllLowercase(value)) return value;
  return value
    .split(/(\s+|-|')/)
    .map((part) => {
      if (!part || /^[\s'-]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("")
    .replace(/\bMc([a-z])/g, (_match, letter: string) => `Mc${letter.toUpperCase()}`);
}

function displayState(value: string | null): string | null {
  if (!value) return null;
  if (/^[a-z]{2}$/.test(value)) return value.toUpperCase();
  return displayCase(value);
}

function safeWebsite(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function customValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return text(String(value));
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => customValue(item))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

function readCustomFields(raw: Record<string, unknown>): { id: string; value: string }[] {
  if (!Array.isArray(raw.customFields)) return [];
  const fields: { id: string; value: string }[] = [];
  for (const item of raw.customFields) {
    const record = asRecord(item);
    if (!record) continue;
    const id = text(record.id);
    if (!id) continue;
    const value = customValue(record.value ?? record.fieldValue ?? record.field_value);
    if (!value) continue;
    fields.push({ id, value });
  }
  return fields;
}

export function normalizeContact(input: unknown, catalog: FieldCatalog): Contact {
  const raw = asRecord(input);
  const id = text(raw?.id);
  if (!raw || !id) {
    throw new Error("UNEXPECTED_CONTACT");
  }

  const firstName = displayCase(text(raw.firstName) ?? "");
  const lastName = displayCase(text(raw.lastName) ?? "");
  const combined = [firstName, lastName].filter(Boolean).join(" ");
  const fullName = combined || displayCase(text(raw.contactName) ?? text(raw.name) ?? "");

  const custom = readCustomFields(raw);
  const titleFromField = catalog.titleFieldId
    ? custom.find((field) => field.id === catalog.titleFieldId)?.value ?? null
    : null;
  const npiFromField = catalog.npiFieldId
    ? custom.find((field) => field.id === catalog.npiFieldId)?.value ?? null
    : null;

  const titleAvailable = catalog.status === "ready" && Boolean(catalog.titleFieldId);
  const npiAvailable = catalog.status === "ready" && Boolean(catalog.npiFieldId);
  const hidden = new Set(
    [catalog.titleFieldId, catalog.npiFieldId].filter((value): value is string => Boolean(value)),
  );

  const extraFields =
    catalog.status === "ready"
      ? custom
          .filter((field) => !hidden.has(field.id) && catalog.labels.has(field.id))
          .map((field) => ({
            id: field.id,
            label: catalog.labels.get(field.id) ?? field.id,
            value: field.value,
          }))
      : [];

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => text(tag))
        .filter((tag): tag is string => Boolean(tag))
        .slice(0, 30)
    : [];

  return {
    id,
    firstName,
    lastName,
    fullName: fullName || "Unnamed contact",
    email: text(raw.email),
    phone: text(raw.phone),
    company: displayCase(text(raw.companyName) ?? text(raw.businessName) ?? "") || null,
    title: titleAvailable && titleFromField ? displayCase(titleFromField) : null,
    npi: npiAvailable ? npiFromField : null,
    city: displayCase(text(raw.city) ?? "") || null,
    state: displayState(text(raw.state)),
    country: text(raw.country),
    postalCode: text(raw.postalCode),
    address: displayCase(text(raw.address1) ?? text(raw.address) ?? "") || null,
    website: safeWebsite(text(raw.website)),
    tags,
    extraFields,
    titleAvailable,
    npiAvailable,
    extraFieldsAvailable: catalog.status === "ready",
    dateAdded: text(raw.dateAdded),
    dateUpdated: text(raw.dateUpdated),
    source: text(raw.source),
  };
}

export function isNpiField(name: string, fieldKey: string): boolean {
  const label = `${name} ${fieldKey}`.toLowerCase();
  return /\bnpi\b/.test(label);
}

export function isTitleField(name: string): boolean {
  const label = name.toLowerCase().trim();
  return ["title", "professional title", "job title", "credentials", "credential"].includes(label);
}
