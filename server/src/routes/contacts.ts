import { Router } from "express";
import type { AppConfig } from "../config.ts";
import type { Contact } from "../../../shared/types.ts";
import type { Crm } from "../coto/types.ts";
import { AppError } from "../errors.ts";
import { requireMutationHeader, requireStaff } from "../middleware/auth.ts";
import { createInquiry, getContactHistory, getInquiry } from "../inquiries/service.ts";
import {
  blankToNull,
  contactParamsSchema,
  createContactSchema,
  inquirySchema,
  parseOrThrow,
  searchQuerySchema,
  updateContactSchema,
  validateInquiryAnswers,
} from "../validation.ts";

export function contactsRouter(config: AppConfig, crm: Crm) {
  const router = Router();
  router.use(requireStaff);

  router.get("/search", async (req, res, next) => {
    try {
      const query = parseOrThrow(searchQuerySchema, req.query);
      const controller = new AbortController();
      req.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const result = await crm.searchContacts(query.q, page, pageSize, controller.signal);
      const total = result.total;
      res.json({
        contacts: result.contacts,
        page,
        pageSize,
        total,
        hasMore: total === null ? result.contacts.length === pageSize : page * pageSize < total,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const { id } = parseOrThrow(contactParamsSchema, req.params);
      const contact = await crm.getContact(id);
      res.json({ contact, cotoUrl: cotoUrl(config, contact.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", requireMutationHeader, async (req, res, next) => {
    try {
      const input = parseOrThrow(createContactSchema, req.body);
      const email = blankToNull(input.email);
      const phone = blankToNull(input.phone);
      if (!email && !phone) {
        throw new AppError(400, "VALIDATION", "Add an email address or phone number.", {
          fields: { email: "Add an email or phone number.", phone: "Add an email or phone number." },
        });
      }
      await assertMappedFields(crm, input.title, input.npi);
      const matches = await findDuplicates(crm, {
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone,
      });
      if (matches.length > 0 && !input.acknowledgeDuplicates) {
        throw new AppError(
          409,
          "POSSIBLE_DUPLICATE",
          "Existing contacts look similar. Review them before creating a new record.",
          { matches },
        );
      }
      const contact = await crm.createContact({
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone,
        company: blankToNull(input.company),
        city: blankToNull(input.city),
        state: blankToNull(input.state),
        address: blankToNull(input.address),
        postalCode: blankToNull(input.postalCode),
        title: blankToNull(input.title),
        npi: blankToNull(input.npi),
      });
      res.status(201).json({ contact, cotoUrl: cotoUrl(config, contact.id) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", requireMutationHeader, async (req, res, next) => {
    try {
      const { id } = parseOrThrow(contactParamsSchema, req.params);
      const input = parseOrThrow(updateContactSchema, req.body);
      await assertMappedFields(crm, input.title, input.npi);
      const patch = {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.email !== undefined ? { email: blankToNull(input.email) } : {}),
        ...(input.phone !== undefined ? { phone: blankToNull(input.phone) } : {}),
        ...(input.company !== undefined ? { company: blankToNull(input.company) } : {}),
        ...(input.city !== undefined ? { city: blankToNull(input.city) } : {}),
        ...(input.state !== undefined ? { state: blankToNull(input.state) } : {}),
        ...(input.address !== undefined ? { address: blankToNull(input.address) } : {}),
        ...(input.postalCode !== undefined ? { postalCode: blankToNull(input.postalCode) } : {}),
        ...(input.title !== undefined ? { title: blankToNull(input.title) } : {}),
        ...(input.npi !== undefined ? { npi: blankToNull(input.npi) } : {}),
      };
      const contact = await crm.updateContact(id, patch);
      res.json({ contact, cotoUrl: cotoUrl(config, contact.id) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/inquiries", async (req, res, next) => {
    try {
      const { id } = parseOrThrow(contactParamsSchema, req.params);
      const history = await getContactHistory(crm, id);
      res.json(history);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/inquiries/:inquiryId", async (req, res, next) => {
    try {
      const { id } = parseOrThrow(contactParamsSchema, req.params);
      const inquiryId = parseOrThrow(
        inquirySchema.shape.inquiryId,
        req.params.inquiryId,
      );
      const inquiry = await getInquiry(crm, id, inquiryId);
      if (!inquiry) throw new AppError(404, "NOT_FOUND", "That inquiry could not be found.");
      res.json({ inquiry });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/inquiries", requireMutationHeader, async (req, res, next) => {
    try {
      const { id } = parseOrThrow(contactParamsSchema, req.params);
      const body = parseOrThrow(inquirySchema, req.body);
      validateInquiryAnswers(body.answers);
      await crm.getContact(id);
      const inquiry = await createInquiry(crm, {
        contactId: id,
        inquiryId: body.inquiryId,
        answers: body.answers,
        notes: blankToNull(body.notes),
        staffName: req.session.staffName ?? "Staff",
      });
      res.status(201).json({
        inquiry,
        storage: crm.mode === "live" ? "coto-notes" : "mock",
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function cotoUrl(config: AppConfig, contactId: string): string {
  return `${config.coto.appBaseUrl}/v2/location/${config.coto.locationId}/contacts/detail/${contactId}`;
}

async function assertMappedFields(crm: Crm, title: string | null | undefined, npi: string | null | undefined) {
  const catalog = await crm.getFieldCatalog();
  const fields: Record<string, string> = {};
  if (blankToNull(title) && !catalog.titleFieldId) {
    fields.title = "Professional title is not available on this CRM account.";
  }
  if (blankToNull(npi) && !catalog.npiFieldId) {
    fields.npi = "NPI is not available on this CRM account.";
  }
  if (Object.keys(fields).length > 0) {
    throw new AppError(400, "VALIDATION", "Some fields cannot be saved to the CRM.", { fields });
  }
}

async function findDuplicates(
  crm: Crm,
  input: { firstName: string; lastName: string; email: string | null; phone: string | null },
): Promise<Contact[]> {
  const queries = [input.email, input.phone, `${input.firstName} ${input.lastName}`].filter(
    (value): value is string => Boolean(value),
  );
  const seen = new Map<string, Contact>();
  for (const query of queries) {
    const result = await crm.searchContacts(query.slice(0, 75), 1, 20);
    for (const contact of result.contacts) {
      if (isStrongMatch(contact, input)) seen.set(contact.id, contact);
    }
  }
  return [...seen.values()].slice(0, 8);
}

function isStrongMatch(
  contact: Contact,
  input: { firstName: string; lastName: string; email: string | null; phone: string | null },
): boolean {
  if (input.email && contact.email && contact.email.toLowerCase() === input.email.toLowerCase()) return true;
  if (input.phone && samePhone(contact.phone, input.phone)) return true;
  return (
    contact.firstName.toLowerCase() === input.firstName.toLowerCase() &&
    contact.lastName.toLowerCase() === input.lastName.toLowerCase()
  );
}

function samePhone(left: string | null, right: string | null): boolean {
  const a = (left ?? "").replace(/\D/g, "");
  const b = (right ?? "").replace(/\D/g, "");
  if (a.length < 7 || b.length < 7) return false;
  return a.endsWith(b) || b.endsWith(a);
}
