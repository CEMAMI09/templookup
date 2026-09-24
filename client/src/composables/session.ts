import { ref } from "vue";
import { api, ApiError } from "@/api/client";

export type StaffSession = {
  name: string;
  email: string;
};

type MeResponse = {
  staff: StaffSession;
  crmMode: "live" | "mock";
  fields: { title: boolean; npi: boolean };
  staffConfigured: boolean;
};

const staff = ref<StaffSession | null>(null);
const ready = ref(false);
const crmMode = ref<"live" | "mock">("live");
const fields = ref({ title: false, npi: false });
const staffConfigured = ref(true);
let pending: Promise<void> | null = null;

export function useSession() {
  return { staff, ready, crmMode, fields, staffConfigured, restore, login, logout };
}

export async function restore() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const me = await api<MeResponse>("/api/auth/me");
      staff.value = me.staff;
      crmMode.value = me.crmMode;
      fields.value = me.fields;
      staffConfigured.value = me.staffConfigured;
    } catch (error) {
      staff.value = null;
      if (error instanceof ApiError && error.status !== 401) {
        staffConfigured.value = true;
      }
    } finally {
      ready.value = true;
    }
  })();
  try {
    await pending;
  } finally {
    pending = null;
  }
}

export async function login(email: string, password: string) {
  const result = await api<{ staff: StaffSession; crmMode: "live" | "mock" }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  staff.value = result.staff;
  crmMode.value = result.crmMode;
  await restore();
}

export async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  staff.value = null;
}
