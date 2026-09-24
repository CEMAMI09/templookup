import "dotenv/config";
import { loadConfig } from "../config.ts";
import { LiveCrm } from "../coto/live.ts";

const config = loadConfig();
if (config.crmMode !== "live") {
  console.log("No COTO token is configured. Add it to .env, then run this check again.");
  process.exit(0);
}

const crm = new LiveCrm(config.coto);
const query = (process.env.COTO_TEST_QUERY || "a").slice(0, 75);
const search = await crm.searchContacts(query, 1, 5);
console.log(
  JSON.stringify({
    search: {
      queryLength: query.length,
      returned: search.contacts.length,
      total: search.total,
      idsLookValid: search.contacts.every((contact) => /^[A-Za-z0-9]{8,40}$/.test(contact.id)),
    },
  }),
);

const contactId = process.env.COTO_TEST_CONTACT_ID?.trim();
if (contactId) {
  const contact = await crm.getContact(contactId);
  console.log(
    JSON.stringify({
      contact: {
        idMatches: contact.id === contactId,
        hasName: Boolean(contact.fullName),
        hasEmail: Boolean(contact.email),
        hasPhone: Boolean(contact.phone),
        titleAvailable: contact.titleAvailable,
        npiAvailable: contact.npiAvailable,
      },
    }),
  );
}

if (process.env.COTO_ALLOW_WRITE_TESTS === "true") {
  if (!contactId) {
    console.error("Set COTO_TEST_CONTACT_ID before a write check. No contact was created or changed.");
    process.exit(1);
  }
  console.log("Write checks are not performed by this script. Use the application against the authorized test contact.");
}
