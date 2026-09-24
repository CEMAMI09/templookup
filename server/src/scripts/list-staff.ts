import "dotenv/config";
import { listStaff } from "../auth/staff-store.ts";
import { loadConfig } from "../config.ts";

const config = loadConfig();
const staff = await listStaff(config.staffFile);
if (staff.length === 0) {
  console.log("No staff accounts yet. Run npm run staff:add.");
} else {
  for (const user of staff) {
    console.log(`${user.name} <${user.email}>`);
  }
}
