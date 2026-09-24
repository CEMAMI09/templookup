<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Mic, Plus, Search } from "lucide-vue-next";
import type { Contact, ContactSearchResponse } from "@shared/types";
import { api, ApiError } from "@/api/client";
import { rememberContact } from "@/composables/contactCache";
import { useRecentContacts } from "@/composables/recent";
import { display, location } from "@/lib/format";
import { transcribeAudio, voiceErrorMessage } from "@/lib/localRecognition";
import AppHeader from "@/components/AppHeader.vue";
import BadgeScan from "@/components/BadgeScan.vue";
import UiAlert from "@/components/UiAlert.vue";
import UiButton from "@/components/UiButton.vue";

const route = useRoute();
const router = useRouter();
const { recent, remember } = useRecentContacts();

const query = ref(typeof route.query.q === "string" ? route.query.q : "");
const contacts = ref<Contact[]>([]);
const total = ref<number | null>(null);
const page = ref(1);
const hasMore = ref(false);
const loading = ref(false);
const loadingMore = ref(false);
const searchMs = ref(0);
const searchTiming = import.meta.env.DEV;
const error = ref("");
const searched = ref(false);
const listening = ref(false);
const speechError = ref("");
const speechStatus = ref("");
const speechSupported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
const input = ref<HTMLInputElement | null>(null);

let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let searchGeneration = 0;
let recorder: MediaRecorder | null = null;
let recordTimer: ReturnType<typeof setTimeout> | undefined;
let recordChunks: Blob[] = [];

watch(query, (value) => {
  window.clearTimeout(timer);
  if (value.trim().length < 2) {
    controller?.abort();
    contacts.value = [];
    searched.value = false;
    hasMore.value = false;
    total.value = null;
    page.value = 1;
    error.value = "";
    void router.replace({ query: value ? { q: value } : {} });
    return;
  }
  timer = setTimeout(() => void runSearch(value.trim(), 1), 300);
});

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function runSearch(value: string, nextPage: number) {
  const generation = ++searchGeneration;
  controller?.abort();
  controller = new AbortController();
  const append = nextPage > 1;
  if (append) loadingMore.value = true;
  else loading.value = true;
  error.value = "";
  const started = performance.now();
  try {
    const result = await api<ContactSearchResponse>(
      `/api/contacts/search?q=${encodeURIComponent(value)}&page=${nextPage}&pageSize=20`,
      { signal: controller.signal },
    );
    if (generation !== searchGeneration) return;
    for (const contact of result.contacts) rememberContact(contact);
    contacts.value = append ? [...contacts.value, ...result.contacts] : result.contacts;
    total.value = result.total;
    page.value = result.page;
    hasMore.value = result.hasMore;
    searched.value = true;
    searchMs.value = Math.round(performance.now() - started);
    void router.replace({ query: { q: value } });
  } catch (caught) {
    if (isAbort(caught) || generation !== searchGeneration) return;
    if (!append) contacts.value = [];
    error.value = caught instanceof ApiError ? caught.message : "Search failed. Try again.";
    searched.value = true;
  } finally {
    if (generation === searchGeneration) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

function submit() {
  window.clearTimeout(timer);
  if (query.value.trim().length >= 2) void runSearch(query.value.trim(), 1);
}

function openContact(contact: Contact) {
  remember({ id: contact.id, name: contact.fullName });
  void router.push({ name: "contact", params: { id: contact.id }, query: { q: query.value } });
}

async function startVoice() {
  speechError.value = "";
  if (listening.value) {
    recorder?.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordChunks.push(event.data);
    };
    recorder.onstop = () => {
      window.clearTimeout(recordTimer);
      stream.getTracks().forEach((track) => track.stop());
      listening.value = false;
      const blob = new Blob(recordChunks, { type: recorder?.mimeType || "audio/webm" });
      void finishVoice(blob);
    };
    speechStatus.value = "Listening… say the name, then tap the microphone again.";
    listening.value = true;
    recorder.start(200);
    recordTimer = setTimeout(() => recorder?.stop(), 6000);
  } catch {
    listening.value = false;
    speechStatus.value = "";
    speechError.value = "Microphone permission was denied. You can still type a name.";
  }
}

async function finishVoice(blob: Blob) {
  try {
    const text = await transcribeAudio(blob, (message) => {
      speechStatus.value = message;
    });
    speechStatus.value = "";
    if (text.length < 2) {
      speechError.value = "No name was heard. Try again or type it.";
      return;
    }
    query.value = text;
    submit();
  } catch (error) {
    speechStatus.value = "";
    speechError.value = voiceErrorMessage(error);
  }
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const typing = target && ["INPUT", "TEXTAREA"].includes(target.tagName);
  if (event.key === "/" && !typing) {
    event.preventDefault();
    input.value?.focus();
  }
}

function useRecognized(name: string) {
  const finalName = name.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!finalName || (query.value === finalName && searched.value)) return;
  query.value = finalName;
  submit();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  if (query.value.trim().length >= 2) void runSearch(query.value.trim(), 1);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  controller?.abort();
  recorder?.stop();
  window.clearTimeout(timer);
  window.clearTimeout(recordTimer);
});
</script>

<template>
  <div class="min-h-screen">
    <AppHeader />
    <main class="mx-auto w-full max-w-3xl px-4 pt-1 pb-6 sm:px-6">
      <h1>Find a contact</h1>

      <form class="mt-6 flex flex-wrap items-center gap-2" @submit.prevent="submit">
        <div class="relative min-w-0 flex-1">
          <Search class="pointer-events-none absolute top-3.5 left-3 size-5 text-muted" aria-hidden="true" />
          <input
            ref="input"
            v-model="query"
            type="search"
            placeholder="Search by name, email, or phone..."
            aria-label="Search by name, email, or phone"
            class="h-12 w-full rounded-md border border-line bg-surface pr-12 pl-10 text-base outline-none focus:border-brand"
          />
          <button
            v-if="speechSupported"
            type="button"
            class="absolute top-1 right-1 inline-flex size-10 items-center justify-center rounded-md text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-brand"
            :aria-pressed="listening"
            :aria-label="listening ? 'Listening' : 'Search by voice'"
            @click="startVoice"
          >
            <Mic class="size-5" :class="{ 'text-brand-strong': listening }" aria-hidden="true" />
          </button>
        </div>
        <BadgeScan @confirm="useRecognized" />
      </form>
      <p class="mt-2 pl-1 text-xs text-muted">Press / to focus search.{{ speechStatus ? ` ${speechStatus}` : "" }}</p>
      <UiAlert v-if="speechError" class="mt-3" tone="error" @close="speechError = ''">{{ speechError }}</UiAlert>

      <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p v-if="searched && !loading" class="text-sm text-muted">
          <template v-if="total !== null">{{ total }} match{{ total === 1 ? "" : "es" }}</template>
          <template v-else>{{ contacts.length }} shown</template>
          <template v-if="searchTiming && searchMs"> · search {{ searchMs }} ms</template>
        </p>
        <span v-else />
        <RouterLink
          :to="{ name: 'contact-create', query: query.trim() ? { q: query.trim() } : {} }"
          class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-strong px-3.5 text-sm font-bold text-on-brand sm:w-auto"
        >
          <Plus class="size-4" aria-hidden="true" />
          Create new contact
        </RouterLink>
      </div>

      <UiAlert v-if="error" class="mt-4" tone="error" @close="error = ''">
        {{ error }}
        <button type="button" class="ml-2 font-bold underline" @click="submit">Retry</button>
      </UiAlert>

      <div v-if="loading" class="mt-4 space-y-2" aria-hidden="true">
        <div v-for="row in 5" :key="row" class="h-20 animate-pulse rounded-md border border-line bg-surface" />
      </div>

      <ul v-else-if="contacts.length" class="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface" aria-live="polite">
        <li v-for="contact in contacts" :key="contact.id">
          <button type="button" class="w-full px-4 py-3 text-left hover:bg-surface-muted focus-visible:bg-brand-soft focus-visible:outline-none" @click="openContact(contact)">
            <span class="block font-bold">{{ contact.fullName }}</span>
            <span v-if="contact.title" class="block text-sm text-muted">{{ contact.title }}</span>
            <span class="mt-1 block text-sm">{{ display(contact.email) }} · {{ display(contact.phone) }}</span>
            <span class="block text-sm text-muted">{{ location(contact.city, contact.state) }}</span>
            <span v-if="contact.company" class="block text-sm">{{ contact.company }}</span>
            <span v-if="contact.tags.length" class="mt-2 flex flex-wrap gap-1">
              <span v-for="tag in contact.tags.slice(0, 3)" :key="tag" class="rounded bg-brand-soft px-1.5 py-0.5 text-xs text-ink">{{ tag }}</span>
            </span>
          </button>
        </li>
      </ul>

      <div v-else-if="searched && !error" class="mt-6 rounded-lg border border-dashed border-line bg-surface px-4 py-8 text-center">
        <p class="font-bold">No matching contacts</p>
        <p class="mt-1 text-sm text-muted">Try another spelling, or create a contact and start an inquiry.</p>
      </div>

      <div v-else-if="recent.length" class="mt-8">
        <h2 class="text-sm font-bold text-muted">Recent this session</h2>
        <ul class="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <li v-for="item in recent" :key="item.id">
            <button type="button" class="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-muted" @click="router.push({ name: 'contact', params: { id: item.id }, query: query ? { q: query } : {} })">
              <span class="font-bold">{{ item.name }}</span>
              <span v-if="item.inquirySaved" class="text-xs font-bold text-success">Inquiry saved</span>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="searched && query.trim().length >= 2 && hasMore && contacts.length > 0" class="mt-4">
        <UiButton variant="secondary" :disabled="loadingMore" @click="runSearch(query.trim(), page + 1)">
          {{ loadingMore ? "Loading…" : "Load more" }}
        </UiButton>
      </div>
    </main>
  </div>
</template>
