import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatInquiryNote, parseInquiryNote } from "../../shared/inquiry-note.ts";
import { displayCase, normalizeContact } from "../src/coto/normalize.ts";
import { emptyCatalog } from "../src/coto/types.ts";
import { createApp } from "../src/app.ts";
import type { AppConfig } from "../src/config.ts";
import { upsertStaff } from "../src/auth/staff-store.ts";

const staffFile = path.join(await mkdtemp(path.join(tmpdir(), "aaoptom-")), "staff.json");

const config: AppConfig = {
  nodeEnv: "test",
  port: 0,
  sessionSecret: "test-session-secret-with-32-characters",
  trustProxy: false,
  staffFile,
  crmMode: "mock",
  coto: {
    baseUrl: "https://services.leadconnectorhq.com",
    locationId: "7WK4Pl3TZvOBAwTB2gOR",
    version: "2021-07-28",
    token: "test-token-should-not-leak",
    appBaseUrl: "https://crm.coto.services",
    npiFieldId: "",
    titleFieldId: "",
  },
};

const app = createApp(config);

beforeAll(async () => {
  await upsertStaff(staffFile, {
    name: "Test Staff",
    email: "staff@evoq.example",
    password: "correct-horse-battery",
  });
});

afterAll(async () => {
  await rm(path.dirname(staffFile), { recursive: true, force: true });
});

describe("contact normalization", () => {
  it("keeps missing fields empty and ignores unmapped custom fields", () => {
    const contact = normalizeContact(
      {
        id: "abc12345",
        firstName: "Avery",
        lastName: "",
        email: "",
        customFields: [{ id: "unknown", value: "hidden" }],
      },
      emptyCatalog(),
    );
    expect(contact.email).toBeNull();
    expect(contact.fullName).toBe("Avery");
    expect(contact.titleAvailable).toBe(false);
    expect(contact.npiAvailable).toBe(false);
    expect(contact.extraFields).toEqual([]);
  });

  it("title-cases lowercase names and leaves mixed-case credentials alone", () => {
    expect(displayCase("joseph allen")).toBe("Joseph Allen");
    expect(displayCase("OD, FAAO, Dipl ABO")).toBe("OD, FAAO, Dipl ABO");
    const contact = normalizeContact(
      { id: "abc12345", firstName: "joseph", lastName: "allen", city: "portland", state: "or" },
      emptyCatalog(),
    );
    expect(contact.fullName).toBe("Joseph Allen");
    expect(contact.city).toBe("Portland");
    expect(contact.state).toBe("OR");
  });
});

describe("inquiry notes", () => {
  it("round-trips a saved inquiry without dropping an earlier one", () => {
    const first = formatInquiryNote({
      inquiryId: "11111111-1111-4111-8111-111111111111",
      contactId: "mockJordanA",
      submittedAt: "2026-01-01T00:00:00.000Z",
      staffName: "Alex",
      answers: [{ questionId: "example_role", label: "Example role", value: "Optometrist", display: "Optometrist" }],
      notes: "Keep this",
    });
    const second = formatInquiryNote({
      inquiryId: "22222222-2222-4222-8222-222222222222",
      contactId: "mockJordanA",
      submittedAt: "2026-01-02T00:00:00.000Z",
      staffName: "Alex",
      answers: [{ questionId: "example_role", label: "Example role", value: "Other", display: "Other" }],
      notes: null,
    });
    expect(parseInquiryNote(first, "note-1")?.inquiryId).toBe("11111111-1111-4111-8111-111111111111");
    expect(parseInquiryNote(second, "note-2")?.notes).toBeNull();
    expect(first).not.toBe(second);
  });
});

describe("API access", () => {
  it("blocks contact search without a staff session and hides the token", async () => {
    const response = await request(app).get("/api/contacts/search?q=Jordan");
    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain("test-token-should-not-leak");
    const health = await request(app).get("/api/health");
    expect(health.body).toEqual({ ok: true });
  });

  it("searches, distinguishes duplicates, saves two inquiries, and retries safely", async () => {
    const agent = request.agent(app);
    const denied = await agent.post("/api/auth/login").send({ email: "staff@evoq.example", password: "wrong-password-1" });
    expect(denied.status).toBe(400);

    const login = await agent
      .post("/api/auth/login")
      .set("X-Requested-With", "evoq")
      .send({ email: "staff@evoq.example", password: "correct-horse-battery" });
    expect(login.status).toBe(200);

    const many = await agent.get("/api/contacts/search").query({ q: "Jordan Lee" });
    expect(many.body.contacts).toHaveLength(2);
    expect(many.body.contacts[0].id).not.toBe(many.body.contacts[1].id);

    const none = await agent.get("/api/contacts/search").query({ q: "nobody-zzz" });
    expect(none.body.contacts).toEqual([]);

    const sparse = await agent.get("/api/contacts/mockSparse");
    expect(sparse.body.contact.email).toBeNull();

    const duplicate = await agent.post("/api/contacts").set("X-Requested-With", "evoq").send({
      firstName: "Jordan",
      lastName: "Lee",
      email: "new.person@example.com",
      phone: "5550109999",
    });
    expect(duplicate.status).toBe(409);

    const created = await agent.post("/api/contacts").set("X-Requested-With", "evoq").send({
      firstName: "Casey",
      lastName: "Nguyen",
      email: "casey.nguyen@example.com",
      acknowledgeDuplicates: true,
    });
    expect(created.status).toBe(201);

    const inquiryId = "33333333-3333-4333-8333-333333333333";
    const answers = [
      { questionId: "visit_reason", value: ["Book Inquiry / Request", "Other (Please specify)"] },
      { questionId: "visit_reason_other", value: "CE course" },
      { questionId: "book_interest", value: ["Receive a complimentary copy"] },
      { questionId: "product_interest", value: ["Twilight Dark Adaptometer"] },
      { questionId: "dark_adaptation_current", value: false },
      { questionId: "dark_adaptation_system", value: "Should stay hidden" },
      { questionId: "dark_adaptation_adding", value: "Undecided / Evaluating potential benefits" },
      { questionId: "twilight_next", value: ["Provide quote"] },
      { questionId: "other_product_next", value: [] },
      { questionId: "purchase_timeline", value: "1 – 3 Months" },
      { questionId: "additional_comments", value: "Needs a portable unit" },
    ];
    const invalid = await agent
      .post(`/api/contacts/mockJordanA/inquiries`)
      .set("X-Requested-With", "evoq")
      .send({ inquiryId, answers: [{ questionId: "not_a_question", value: "x" }], notes: "still here" });
    expect(invalid.status).toBe(400);

    const saved = await agent
      .post("/api/contacts/mockJordanA/inquiries")
      .set("X-Requested-With", "evoq")
      .send({ inquiryId, answers, notes: "Booth conversation" });
    expect(saved.status).toBe(201);
    expect(saved.body.inquiry.noteId).toBeTruthy();
    expect(saved.body.inquiry.contactId).toBe("mockJordanA");
    const savedIds = saved.body.inquiry.answers.map((item: { questionId: string }) => item.questionId);
    expect(savedIds).toContain("dark_adaptation_adding");
    expect(savedIds).not.toContain("dark_adaptation_system");
    expect(savedIds).toContain("visit_reason_other");

    const retry = await agent
      .post("/api/contacts/mockJordanA/inquiries")
      .set("X-Requested-With", "evoq")
      .send({ inquiryId, answers, notes: "Booth conversation" });
    expect(retry.body.inquiry.noteId).toBe(saved.body.inquiry.noteId);

    const second = await agent
      .post("/api/contacts/mockJordanA/inquiries")
      .set("X-Requested-With", "evoq")
      .send({
        inquiryId: "44444444-4444-4444-8444-444444444444",
        answers,
        notes: "Second visit",
      });
    expect(second.status).toBe(201);

    const history = await agent.get("/api/contacts/mockJordanA/inquiries");
    const ids = history.body.inquiries.map((item: { inquiryId: string }) => item.inquiryId);
    expect(ids).toContain("11111111-1111-4111-8111-111111111111");
    expect(ids).toContain(inquiryId);
    expect(ids).toContain("44444444-4444-4444-8444-444444444444");
    expect(history.body.notes.some((note: { body: string }) => note.body.includes("Prefers morning calls"))).toBe(true);
    expect(JSON.stringify(history.body)).not.toContain("test-token-should-not-leak");
  });
});
