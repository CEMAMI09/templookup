<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, ExternalLink } from "lucide-vue-next";
import type { Contact, ContactHistory } from "@shared/types";
import { api, ApiError } from "@/api/client";
import { previewContact } from "@/composables/contactCache";
import { useRecentContacts } from "@/composables/recent";
import { display, formatWhen, location } from "@/lib/format";
import AppHeader from "@/components/AppHeader.vue";
import UiAlert from "@/components/UiAlert.vue";
import UiButton from "@/components/UiButton.vue";

const route = useRoute();
const router = useRouter();
const { remember } = useRecentContacts();

const contact = ref<Contact | null>(null);
const cotoUrl = ref("");
const history = ref<ContactHistory | null>(null);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const historyDismissed = ref(false);

const id = () => String(route.params.id);
const backQuery = () => (typeof route.query.q === "string" && route.query.q ? { q: route.query.q } : {});

async function load() {
  const cached = previewContact(id());
  error.value = "";
  notice.value = route.query.created === "1" ? "Contact created. You can start an inquiry now." : route.query.updated === "1" ? "Contact updated." : route.query.saved === "1" ? "Inquiry saved." : "";
  if (cached) {
    contact.value = cached;
    loading.value = false;
  } else {
    loading.value = true;
  }
  try {
    const [detail, records] = await Promise.all([
      api<{ contact: Contact; cotoUrl: string }>(`/api/contacts/${id()}`),
      api<ContactHistory>(`/api/contacts/${id()}/inquiries`),
    ]);
    contact.value = detail.contact;
    cotoUrl.value = detail.cotoUrl;
    history.value = records;
    remember({ id: detail.contact.id, name: detail.contact.fullName }, route.query.saved === "1");
  } catch (caught) {
    if (!contact.value) {
      error.value = caught instanceof ApiError ? caught.message : "This contact could not be loaded.";
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="min-h-screen">
    <AppHeader />
    <main class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <button type="button" class="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-brand-strong" @click="router.push({ name: 'search', query: backQuery() })">
        <ArrowLeft class="size-4" aria-hidden="true" />
        Back to search
      </button>

      <div v-if="loading" class="mt-6 space-y-3">
        <div class="h-10 w-2/3 animate-pulse rounded bg-surface-muted" />
        <div class="h-40 animate-pulse rounded-lg border border-line bg-surface" />
      </div>
      <UiAlert v-else-if="error" class="mt-6" tone="error" @close="error = ''">
        {{ error }}
        <button type="button" class="ml-2 font-bold underline" @click="load">Retry</button>
      </UiAlert>
      <template v-else-if="contact">
        <UiAlert v-if="notice" class="mt-4" tone="success" @close="notice = ''">{{ notice }}</UiAlert>
        <div class="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1>{{ contact.fullName }}</h1>
            <p v-if="contact.title" class="mt-1 text-muted">{{ contact.title }}</p>
          </div>
          <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <UiButton @click="router.push({ name: 'inquiry', params: { id: contact.id }, query: backQuery() })">Start inquiry</UiButton>
            <UiButton variant="secondary" @click="router.push({ name: 'contact-edit', params: { id: contact.id }, query: backQuery() })">Edit contact</UiButton>
            <a :href="cotoUrl" target="_blank" rel="noreferrer" class="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-bold text-brand-strong hover:bg-brand-soft">
              Open in COTO
              <ExternalLink class="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        <section class="mt-6 rounded-lg border border-line bg-surface p-4">
          <h2>Contact information</h2>
          <dl class="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <dt class="text-xs font-bold text-muted">Email</dt>
              <dd>{{ display(contact.email) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-bold text-muted">Phone</dt>
              <dd>{{ display(contact.phone) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-bold text-muted">Company or practice</dt>
              <dd>{{ display(contact.company) }}</dd>
            </div>
            <div v-if="contact.titleAvailable">
              <dt class="text-xs font-bold text-muted">Professional title</dt>
              <dd>{{ display(contact.title) }}</dd>
            </div>
            <div v-if="contact.npiAvailable">
              <dt class="text-xs font-bold text-muted">NPI</dt>
              <dd>{{ display(contact.npi) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-bold text-muted">City and state</dt>
              <dd>{{ location(contact.city, contact.state) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-bold text-muted">Address</dt>
              <dd>{{ display(contact.address) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-bold text-muted">Postal code</dt>
              <dd>{{ display(contact.postalCode) }}</dd>
            </div>
            <div v-if="contact.website">
              <dt class="text-xs font-bold text-muted">Website</dt>
              <dd><a class="text-brand-strong underline" :href="contact.website" target="_blank" rel="noreferrer">{{ contact.website }}</a></dd>
            </div>
          </dl>
          <div v-if="contact.tags.length" class="mt-4 flex flex-wrap gap-1">
            <span v-for="tag in contact.tags" :key="tag" class="rounded bg-brand-soft px-2 py-0.5 text-xs">{{ tag }}</span>
          </div>
          <div v-if="contact.extraFields.length" class="mt-4 grid gap-3 sm:grid-cols-2">
            <div v-for="field in contact.extraFields" :key="field.id">
              <dt class="text-xs font-bold text-muted">{{ field.label }}</dt>
              <dd>{{ field.value }}</dd>
            </div>
          </div>
          <p v-else-if="!contact.extraFieldsAvailable" class="mt-4 text-sm text-muted">Additional CRM fields could not be loaded.</p>
          <p class="mt-5 text-xs text-muted">Added {{ formatWhen(contact.dateAdded) }} · Updated {{ formatWhen(contact.dateUpdated) }}</p>
        </section>

        <section class="mt-4 rounded-lg border border-line bg-surface p-4">
          <h2>Previous records</h2>
          <UiAlert v-if="history && !history.available && !historyDismissed" class="mt-3" tone="info" @close="historyDismissed = true">{{ history.message }}</UiAlert>
          <template v-else-if="history">
            <h3 class="mt-4">AAOptom inquiries</h3>
            <p v-if="!history.inquiries.length" class="mt-1 text-sm text-muted">No AAOptom inquiries yet.</p>
            <ol v-else class="mt-2 space-y-3">
              <li v-for="inquiry in history.inquiries" :key="inquiry.inquiryId" class="rounded-md border border-brand/30 bg-brand-soft px-3 py-2">
                <p class="text-sm font-bold">{{ formatWhen(inquiry.submittedAt) }} · {{ inquiry.staffName }}</p>
                <p v-for="answer in inquiry.answers" :key="answer.questionId" class="mt-1 text-sm">
                  <span class="text-muted">{{ answer.label }}</span><br />
                  {{ answer.display || "Not answered" }}
                </p>
                <p v-if="inquiry.notes" class="mt-2 text-sm">Notes: {{ inquiry.notes }}</p>
              </li>
            </ol>
            <h3 class="mt-5">CRM notes</h3>
            <p v-if="!history.notes.length" class="mt-1 text-sm text-muted">No other CRM notes.</p>
            <ol v-else class="mt-2 space-y-3">
              <li v-for="note in history.notes" :key="note.id" class="rounded-md border border-line px-3 py-2">
                <p class="text-xs text-muted">{{ formatWhen(note.createdAt) }}</p>
                <p class="mt-1 text-sm whitespace-pre-wrap">{{ note.body }}</p>
              </li>
            </ol>
          </template>
        </section>
      </template>
    </main>
  </div>
</template>
