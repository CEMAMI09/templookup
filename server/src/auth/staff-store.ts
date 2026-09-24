import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

export type StaffUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

type StaffFile = { users: StaffUser[] };

const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 8);

async function readUsers(file: string): Promise<StaffUser[]> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as StaffFile;
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeUsers(file: string, users: StaffUser[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ users }, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}

export async function listStaff(file: string): Promise<Pick<StaffUser, "id" | "name" | "email">[]> {
  const users = await readUsers(file);
  return users.map(({ id, name, email }) => ({ id, name, email }));
}

export async function upsertStaff(
  file: string,
  input: { name: string; email: string; password: string },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name || !email || input.password.length < 12) {
    throw new Error("Staff name, email, and a password of at least 12 characters are required.");
  }
  const users = await readUsers(file);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const existing = users.find((user) => user.email === email);
  if (existing) {
    existing.name = name;
    existing.passwordHash = passwordHash;
  } else {
    users.push({
      id: randomUUID(),
      name,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    });
  }
  await writeUsers(file, users);
}

export async function authenticateStaff(
  file: string,
  email: string,
  password: string,
): Promise<Pick<StaffUser, "id" | "name" | "email"> | null> {
  const users = await readUsers(file);
  const user = users.find((item) => item.email === email.trim().toLowerCase());
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const matches = await bcrypt.compare(password, hash);
  if (!user || !matches) return null;
  return { id: user.id, name: user.name, email: user.email };
}
