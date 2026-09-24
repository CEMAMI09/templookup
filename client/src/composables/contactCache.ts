import type { Contact } from "@shared/types";

const previews = new Map<string, Contact>();

export function rememberContact(contact: Contact) {
  previews.set(contact.id, contact);
}

export function previewContact(id: string): Contact | null {
  return previews.get(id) ?? null;
}
