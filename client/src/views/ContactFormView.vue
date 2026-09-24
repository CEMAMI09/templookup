<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { Contact } from "@shared/types";
import { api, ApiError } from "@/api/client";
import { useSession } from "@/composables/session";
import AppHeader from "@/components/AppHeader.vue";
import UiAlert from "@/components/UiAlert.vue";
import UiButton from "@/components/UiButton.vue";

const route = useRoute();
const router = useRouter();
const session = useSession();
const editing = computed(() => route.name === "contact-edit");
const fields = computed(() => session.fields.value);

const form = reactive({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  city: "",
  state: "",
  address: "",
  postalCode: "",
  title: "",
  npi: "",
});
const fieldErrors = ref<Record<string, string>>({});
const error = ref("");
const pending = ref(false);
const duplicates = ref<Contact[]>([]);
const loading = ref(false);

function applyQueryPrefill() {
  const q = typeof route.query.q === "string" ? route.query.q.trim() : "";
  if (!q || editing.value) return;
  if (q.includes("@")) form.email = q;
  else if (/\d{3}/.test(q)) form.phone = q;
  else {
    const [first, ...rest] = q.split(/\s+/);
    form.firstName = first ?? "";
    form.lastName = rest.join(" ");
  }
}

async function loadContact() {
  if (!editing.value) {
    applyQueryPrefill();
    return;
  }
  loading.value = true;
  try {
    const detail = await api<{ contact: Contact }>(`/api/contacts/${route.params.id}`);
    const contact = detail.contact;
    form.firstName = contact.firstName;
    form.lastName = contact.lastName;
    form.email = contact.email ?? "";
    form.phone = contact.phone ?? "";
    form.company = contact.company ?? "";
    form.city = contact.city ?? "";
    form.state = contact.state ?? "";
    form.address = contact.address ?? "";
    form.postalCode = contact.postalCode ?? "";
    form.title = contact.title ?? "";
    form.npi = contact.npi ?? "";
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : "The contact could not be loaded.";
  } finally {
    loading.value = false;
  }
}

function payload(acknowledgeDuplicates = false) {
  return {
    firstName: form.firstName,
    lastName: form.lastName,
    email: form.email || null,
    phone: form.phone || null,
    company: form.company || null,
    city: form.city || null,
    state: form.state || null,
    ...(editing.value ? { address: form.address || null, postalCode: form.postalCode || null } : {}),
    ...(fields.value.title ? { title: form.title || null } : {}),
    ...(fields.value.npi ? { npi: form.npi || null } : {}),
    ...(acknowledgeDuplicates ? { acknowledgeDuplicates: true } : {}),
  };
}

async function save(acknowledgeDuplicates = false) {
  fieldErrors.value = {};
  error.value = "";
  if (!acknowledgeDuplicates) duplicates.value = [];
  pending.value = true;
  try {
    if (editing.value) {
      await api(`/api/contacts/${route.params.id}`, { method: "PATCH", body: JSON.stringify(payload()) });
      await router.push({ name: "contact", params: { id: route.params.id }, query: { ...searchQuery(), updated: "1" } });
      return;
    }
    const created = await api<{ contact: Contact }>("/api/contacts", {
      method: "POST",
      body: JSON.stringify(payload(acknowledgeDuplicates)),
    });
    await router.push({ name: "contact", params: { id: created.contact.id }, query: { created: "1" } });
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === "POSSIBLE_DUPLICATE") {
      duplicates.value = caught.matches;
      error.value = caught.message;
    } else if (caught instanceof ApiError) {
      fieldErrors.value = caught.fields;
      error.value = caught.message;
    } else {
      error.value = "The contact could not be saved.";
    }
  } finally {
    pending.value = false;
  }
}

function searchQuery() {
  return typeof route.query.q === "string" && route.query.q ? { q: route.query.q } : {};
}

onMounted(loadContact);
</script>

<template>
  <div class="min-h-screen">
    <AppHeader />
    <main class="mx-auto max-w-3xl px-4 py-6">
      <button type="button" class="text-sm font-bold text-brand-strong" @click="router.back()">Back</button>
      <h1 class="mt-3">{{ editing ? "Edit contact" : "Create contact" }}</h1>
      <p class="type-subtitle mt-2">{{ editing ? "Update the fields you want to change in COTO." : "Only create a contact after checking that they are not already in the list." }}</p>

      <div v-if="loading" class="mt-6 h-48 animate-pulse rounded-lg bg-surface" />
      <form v-else class="mt-6 space-y-4" @submit.prevent="save(false)">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm font-bold">First name
            <input v-model="form.firstName" required class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
            <span v-if="fieldErrors.firstName" class="mt-1 block font-normal text-danger">{{ fieldErrors.firstName }}</span>
          </label>
          <label class="block text-sm font-bold">Last name
            <input v-model="form.lastName" required class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
            <span v-if="fieldErrors.lastName" class="mt-1 block font-normal text-danger">{{ fieldErrors.lastName }}</span>
          </label>
          <label class="block text-sm font-bold">Email
            <input v-model="form.email" type="email" class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
            <span v-if="fieldErrors.email" class="mt-1 block font-normal text-danger">{{ fieldErrors.email }}</span>
          </label>
          <label class="block text-sm font-bold">Phone
            <input v-model="form.phone" type="tel" class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
            <span v-if="fieldErrors.phone" class="mt-1 block font-normal text-danger">{{ fieldErrors.phone }}</span>
          </label>
          <label class="block text-sm font-bold sm:col-span-2">Company or practice
            <input v-model="form.company" class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
          </label>
          <label class="block text-sm font-bold">City
            <input v-model="form.city" class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
          </label>
          <label class="block text-sm font-bold">State
            <input v-model="form.state" class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
          </label>
          <template v-if="editing">
            <label class="block text-sm font-bold sm:col-span-2">Address
              <input v-model="form.address" class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
            </label>
            <label class="block text-sm font-bold">Postal code
              <input v-model="form.postalCode" class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
            </label>
          </template>
          <label v-if="fields.title" class="block text-sm font-bold">Professional title
            <input v-model="form.title" class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
            <span v-if="fieldErrors.title" class="mt-1 block font-normal text-danger">{{ fieldErrors.title }}</span>
          </label>
          <label v-if="fields.npi" class="block text-sm font-bold">NPI
            <input v-model="form.npi" inputmode="numeric" class="mt-1 h-11 w-full rounded-md border border-line bg-surface px-3 font-normal outline-none focus:border-brand" />
            <span v-if="fieldErrors.npi" class="mt-1 block font-normal text-danger">{{ fieldErrors.npi }}</span>
          </label>
        </div>

        <UiAlert v-if="error" tone="error" @close="error = ''">{{ error }}</UiAlert>
        <div v-if="duplicates.length" class="rounded-lg border border-line bg-surface p-3">
          <p class="text-sm font-bold">Possible existing contacts</p>
          <ul class="mt-2 divide-y divide-line">
            <li v-for="match in duplicates" :key="match.id" class="flex items-center justify-between gap-3 py-2">
              <span>
                <span class="block font-bold">{{ match.fullName }}</span>
                <span class="text-sm text-muted">{{ match.email || "Email not provided" }} · {{ match.city || "City not provided" }}</span>
              </span>
              <UiButton variant="secondary" @click="router.push({ name: 'contact', params: { id: match.id } })">Use this contact</UiButton>
            </li>
          </ul>
          <UiButton class="mt-3" :disabled="pending" @click="save(true)">Create anyway</UiButton>
        </div>

        <div class="flex gap-2">
          <UiButton type="submit" :disabled="pending">{{ pending ? "Saving…" : editing ? "Save changes" : "Create contact" }}</UiButton>
          <UiButton variant="ghost" @click="router.back()">Cancel</UiButton>
        </div>
      </form>
    </main>
  </div>
</template>
