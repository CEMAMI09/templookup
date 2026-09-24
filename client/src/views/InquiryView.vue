<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formIntro, isQuestionVisible, questionnaire, questionnaireSections } from "@shared/questionnaire";
import type { AnswerValue, Contact, InquiryRecord, QuestionDefinition } from "@shared/types";
import { api, ApiError } from "@/api/client";
import { useRecentContacts } from "@/composables/recent";
import AppHeader from "@/components/AppHeader.vue";
import UiAlert from "@/components/UiAlert.vue";
import UiButton from "@/components/UiButton.vue";

const route = useRoute();
const router = useRouter();
const { remember, markInquiry } = useRecentContacts();

const contact = ref<Contact | null>(null);
const loadError = ref("");
const saveError = ref("");
const fieldErrors = ref<Record<string, string>>({});
const pending = ref(false);
const saved = ref<{ inquiry: InquiryRecord; storage: "coto-notes" | "mock" } | null>(null);
const inquiryId = crypto.randomUUID();
const answers = reactive<Record<string, AnswerValue | undefined>>({});

for (const question of questionnaire) {
  answers[question.id] = question.type === "multi-select" ? [] : question.type === "yes-no" ? undefined : "";
}

function blankFor(question: QuestionDefinition): AnswerValue | undefined {
  if (question.type === "multi-select") return [];
  if (question.type === "yes-no") return undefined;
  return "";
}

function clearHidden() {
  for (const question of questionnaire) {
    if (!isQuestionVisible(question, answers)) answers[question.id] = blankFor(question);
  }
}

async function load() {
  try {
    const detail = await api<{ contact: Contact }>(`/api/contacts/${route.params.id}`);
    contact.value = detail.contact;
    remember({ id: detail.contact.id, name: detail.contact.fullName });
  } catch (caught) {
    loadError.value = caught instanceof ApiError ? caught.message : "The contact could not be loaded.";
  }
}

function textValue(id: string) {
  const value = answers[id];
  return typeof value === "string" ? value : "";
}

function setText(id: string, event: Event) {
  answers[id] = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}

function selected(id: string, option: string) {
  const value = answers[id];
  return Array.isArray(value) && value.includes(option);
}

function attachedQuestion(parentId: string, option: string) {
  return questionnaire.find((question) => question.attachTo?.questionId === parentId && question.attachTo.option === option);
}

function toggleMulti(id: string, option: string) {
  const current = Array.isArray(answers[id]) ? [...answers[id]] : [];
  answers[id] = current.includes(option) ? current.filter((item) => item !== option) : [...current, option];
  clearHidden();
}

function setYesNo(id: string, choice: boolean) {
  answers[id] = choice;
  clearHidden();
}

function sectionQuestions(sectionId: string) {
  const section = questionnaireSections.find((item) => item.id === sectionId);
  return (section?.questions ?? []).filter((question) => !question.attachTo && isQuestionVisible(question, answers));
}

function showQuestionLabel(sectionTitle: string, question: QuestionDefinition) {
  return question.label !== sectionTitle;
}

async function save() {
  if (!contact.value || pending.value) return;
  pending.value = true;
  saveError.value = "";
  fieldErrors.value = {};
  clearHidden();
  try {
    saved.value = await api(`/api/contacts/${contact.value.id}/inquiries`, {
      method: "POST",
      body: JSON.stringify({
        inquiryId,
        notes: null,
        answers: questionnaire.map((question) => ({
          questionId: question.id,
          value: answers[question.id] ?? blankFor(question),
        })),
      }),
    });
    markInquiry(contact.value.id);
  } catch (caught) {
    if (caught instanceof ApiError) {
      fieldErrors.value = caught.fields;
      saveError.value = caught.message;
    } else {
      saveError.value = "The inquiry was not saved. Your answers are still here.";
    }
  } finally {
    pending.value = false;
  }
}

function searchQuery() {
  return typeof route.query.q === "string" && route.query.q ? { q: route.query.q } : {};
}

onMounted(load);
</script>

<template>
  <div class="min-h-screen">
    <AppHeader />
    <main class="mx-auto max-w-3xl px-4 py-6 lg:max-w-5xl lg:px-8 lg:py-8">
      <UiAlert v-if="loadError" tone="error" @close="loadError = ''">{{ loadError }}</UiAlert>
      <template v-else-if="saved && contact">
        <UiAlert tone="success" @close="saved = null">
          Inquiry saved for {{ contact.fullName }}.
          {{ saved.storage === "coto-notes" ? "It was written to the COTO contact record." : "It was stored in the development mock record." }}
          <span v-if="saved.inquiry.noteId" class="mt-1 block">Reference {{ saved.inquiry.noteId }}</span>
          <span v-if="saved.inquiry.verified === false" class="mt-1 block">The save was accepted. History may take a moment to refresh.</span>
        </UiAlert>
        <UiButton class="mt-4" @click="router.push({ name: 'contact', params: { id: contact.id }, query: { ...searchQuery(), saved: '1' } })">
          View contact
        </UiButton>
      </template>
      <form v-else-if="contact" class="space-y-5 lg:space-y-7" @submit.prevent="save">
        <div>
          <p class="type-h4">Inquiry for</p>
          <h1>{{ contact.fullName }}</h1>
          <p class="mt-1 text-sm text-muted">{{ contact.email || "Email not provided" }} · {{ contact.company || "Company not provided" }}</p>
        </div>

        <div class="rounded-lg border border-line bg-surface p-4">
          <h2>{{ formIntro.title }}</h2>
          <p class="mt-2 text-sm text-muted">{{ formIntro.body }}</p>
        </div>

        <section v-for="(section, index) in questionnaireSections" :key="section.id" class="space-y-3 lg:space-y-4">
          <div>
            <h2 class="inquiry-section">{{ index + 1 }}. {{ section.title }}</h2>
            <p v-if="section.description" class="mt-1 text-sm text-muted lg:text-base">{{ section.description }}</p>
          </div>

          <fieldset
            v-for="question in sectionQuestions(section.id)"
            :key="question.id"
            :aria-label="question.label"
            class="rounded-lg border border-line bg-surface p-4 lg:p-6"
          >
            <p v-if="showQuestionLabel(section.title, question)" class="text-base font-bold lg:text-xl lg:leading-snug">
              {{ question.label }}
              <span v-if="question.required" class="text-danger"> *</span>
            </p>
            <input
              v-if="question.type === 'short-text'"
              :value="textValue(question.id)"
              :placeholder="question.placeholder"
              class="h-11 w-full rounded-md border border-line bg-canvas px-3 text-base outline-none focus:border-brand lg:h-14 lg:px-4 lg:text-lg"
              :class="showQuestionLabel(section.title, question) ? 'mt-3 lg:mt-4' : ''"
              @input="setText(question.id, $event)"
            />
            <textarea
              v-else-if="question.type === 'long-text'"
              :value="textValue(question.id)"
              :placeholder="question.placeholder"
              rows="4"
              class="w-full rounded-md border border-line bg-canvas px-3 py-2 text-base outline-none focus:border-brand lg:px-4 lg:py-3 lg:text-lg"
              :class="showQuestionLabel(section.title, question) ? 'mt-3 lg:mt-4' : ''"
              @input="setText(question.id, $event)"
            />
            <div
              v-else-if="question.type === 'single-select'"
              class="space-y-1 lg:space-y-2"
              :class="showQuestionLabel(section.title, question) ? 'mt-3 lg:mt-4' : ''"
            >
              <label v-for="option in question.options" :key="option" class="flex min-h-11 items-center gap-3 text-base lg:min-h-14 lg:gap-4 lg:text-lg">
                <input v-model="answers[question.id]" type="radio" :value="option" class="size-5 shrink-0 accent-[#1a6488] lg:size-7" />
                {{ option }}
              </label>
            </div>
            <div
              v-else-if="question.type === 'multi-select'"
              class="space-y-1 lg:space-y-2"
              :class="showQuestionLabel(section.title, question) ? 'mt-3 lg:mt-4' : ''"
            >
              <div v-for="option in question.options" :key="option">
                <label class="flex min-h-11 items-center gap-3 text-base lg:min-h-14 lg:gap-4 lg:text-lg">
                  <input
                    type="checkbox"
                    class="size-5 shrink-0 accent-[#1a6488] lg:size-7"
                    :checked="selected(question.id, option)"
                    @change="toggleMulti(question.id, option)"
                  />
                  {{ option }}
                </label>
                <input
                  v-if="attachedQuestion(question.id, option) && selected(question.id, option)"
                  :value="textValue(attachedQuestion(question.id, option)!.id)"
                  :placeholder="attachedQuestion(question.id, option)?.placeholder"
                  :aria-label="attachedQuestion(question.id, option)?.label"
                  class="mt-2 mb-2 h-11 w-full rounded-md border border-line bg-canvas px-3 text-base outline-none focus:border-brand lg:h-14 lg:px-4 lg:text-lg"
                  @input="setText(attachedQuestion(question.id, option)!.id, $event)"
                />
                <p
                  v-if="attachedQuestion(question.id, option) && fieldErrors[attachedQuestion(question.id, option)!.id]"
                  class="text-sm text-danger lg:text-base"
                >
                  {{ fieldErrors[attachedQuestion(question.id, option)!.id] }}
                </p>
              </div>
            </div>
            <div v-else class="flex gap-3" :class="showQuestionLabel(section.title, question) ? 'mt-3 lg:mt-4' : ''">
              <button
                v-for="choice in [true, false]"
                :key="String(choice)"
                type="button"
                class="min-h-12 flex-1 rounded-md border text-base font-bold lg:min-h-16 lg:text-xl"
                :class="answers[question.id] === choice ? 'border-brand-strong bg-brand-soft' : 'border-line'"
                @click="setYesNo(question.id, choice)"
              >
                {{ choice ? "Yes" : "No" }}
              </button>
            </div>
            <p v-if="fieldErrors[question.id]" class="mt-2 text-sm text-danger lg:text-base">{{ fieldErrors[question.id] }}</p>
          </fieldset>
        </section>

        <UiAlert v-if="saveError" tone="error" @close="saveError = ''">{{ saveError }}</UiAlert>
        <div class="flex gap-3">
          <UiButton type="submit" class="lg:min-h-14 lg:px-6 lg:text-lg" :disabled="pending">{{ pending ? "Saving…" : "Save inquiry" }}</UiButton>
          <UiButton variant="ghost" class="lg:min-h-14 lg:px-6 lg:text-lg" :disabled="pending" @click="router.push({ name: 'contact', params: { id: contact.id }, query: searchQuery() })">Cancel</UiButton>
        </div>
      </form>
      <div v-else class="mt-6 h-40 animate-pulse rounded-lg bg-surface" />
    </main>
  </div>
</template>
