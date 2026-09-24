import "dotenv/config";
import { upsertStaff } from "../auth/staff-store.ts";
import { loadConfig } from "../config.ts";

const config = loadConfig();
const args = readArgs(process.argv.slice(2));
const name = args.name || process.env.STAFF_NAME || "";
const email = args.email || process.env.STAFF_EMAIL || "";
const password = args.password || process.env.STAFF_PASSWORD || "";

await upsertStaff(config.staffFile, { name, email, password });
console.log(`Staff account saved for ${email.trim().toLowerCase()}.`);

function readArgs(argv: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) continue;
    values[key.slice(2)] = argv[index + 1] ?? "";
    index += 1;
  }
  return values;
}
