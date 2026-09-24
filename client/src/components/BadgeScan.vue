<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Camera, ChevronDown, Settings, X } from "lucide-vue-next";
import type { ContactSearchResponse } from "@shared/types";
import { api } from "@/api/client";
import UiButton from "./UiButton.vue";
import { getOcrEngine } from "@/lib/ocr/engines";
import { frameChanged, frameIsUsable, frameWaitReason, sampleFrame } from "@/lib/ocr/frameQuality";
import { applyContactChecks, checkCandidate, verificationQueries, type ContactCheck } from "@/lib/ocr/contactMatch";
import { extractAttendeeName } from "@/lib/ocr/nameExtraction";
import { diagnoseScan, scanStatus, type ScanDiagnosis } from "@/lib/ocr/scanDiagnostics";
import { ScanSession, singleLineName } from "@/lib/ocr/scanSession";
import { NameStabilizer } from "@/lib/ocr/stability";
import type { NameDecision, OcrEngineId, OcrLine, OcrResult } from "@/lib/ocr/types";

const emit = defineEmits<{ confirm: [name: string] }>();

const showDiagnostics = true;
const open = ref(false);
const advancedOpen = ref(false);
const video = ref<HTMLVideoElement | null>(null);
const still = ref<HTMLImageElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const overlay = ref<HTMLCanvasElement | null>(null);
const name = ref("");
const choices = ref<string[]>([]);
const status = ref("Opening the camera…");
const phase = ref<"loading" | "watching" | "reading" | "review" | "error">("loading");
const usingUpload = ref(false);
const initMs = ref(0);
const ocrMs = ref(0);
const totalMs = ref(0);
const decision = ref<NameDecision | null>(null);
const recognized = ref<OcrLine[]>([]);
const frameUrl = ref("");
const activeEngine = ref<OcrEngineId>("paddle");
const autoSearched = ref(false);
const crmChecks = ref<ContactCheck[]>([]);
const stages = ref(emptyStages());
const diagnosis = ref<ScanDiagnosis | "">("");
const engineError = ref("");
const showManualEntry = computed(() => phase.value === "error" || phase.value === "review" || stages.value.attempts >= 3);

let stream: MediaStream | null = null;
let uploadedUrl = "";
let watchTimer = 0;
let busy = false;
let stopped = false;
let failedSample: Uint8ClampedArray | null = null;
let lastSample: Uint8ClampedArray | null = null;
const stabilizer = new NameStabilizer();
const scanSession = new ScanSession();
const verificationCache = new Map<string, ContactSearchResponse["contacts"]>();
let openedAt = 0;
let firstFrameAt = 0;
let stableFrames = 0;
let generation = 0;
let publishedQuery = "";

function setStatus(message: string) {
  if (status.value !== message) status.value = message;
}

function emptyStages() {
  return {
    cameraMs: 0,
    firstFrameMs: 0,
    stabilityMs: 0,
    captureMs: 0,
    initMs: 0,
    ocrMs: 0,
    attempts: 0,
    verifyMs: 0,
    totalMs: 0,
    waitReason: "",
    imageWidth: 0,
    imageHeight: 0,
  };
}

async function start() {
  open.value = true;
  stopped = false;
  openedAt = performance.now();
  firstFrameAt = 0;
  stableFrames = 0;
  generation = scanSession.start();
  advancedOpen.value = false;
  resetResult();
  phase.value = "loading";
  setStatus("Starting camera...");
  warmEngine();
  if (!navigator.mediaDevices?.getUserMedia) {
    phase.value = "error";
    setStatus("Camera access is required to scan a badge.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
    if (video.value) {
      video.value.srcObject = stream;
      await video.value.play();
    }
    phase.value = "watching";
    setStatus("Point camera at badge");
    scheduleWatch();
  } catch {
    phase.value = "error";
    setStatus("Camera access is required to scan a badge.");
  }
}

function stop() {
  stopped = true;
  generation += 1;
  window.clearTimeout(watchTimer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (uploadedUrl) URL.revokeObjectURL(uploadedUrl);
  uploadedUrl = "";
  if (frameUrl.value) URL.revokeObjectURL(frameUrl.value);
  usingUpload.value = false;
  open.value = false;
  advancedOpen.value = false;
  busy = false;
}

function resetResult() {
  name.value = "";
  choices.value = [];
  decision.value = null;
  recognized.value = [];
  initMs.value = 0;
  ocrMs.value = 0;
  totalMs.value = 0;
  failedSample = null;
  lastSample = null;
  autoSearched.value = false;
  crmChecks.value = [];
  stages.value = emptyStages();
  diagnosis.value = "";
  engineError.value = "";
  verificationCache.clear();
  stabilizer.reset();
  if (frameUrl.value) URL.revokeObjectURL(frameUrl.value);
  frameUrl.value = "";
}

function scheduleWatch() {
  window.clearTimeout(watchTimer);
  if (stopped || !open.value || scanSession.isFrozen || usingUpload.value || phase.value === "review" || phase.value === "error") return;
  watchTimer = window.setTimeout(() => void watchFrame(), 200);
}

async function watchFrame() {
  if (stopped || busy || scanSession.isFrozen || scanSession.userEdited || usingUpload.value || phase.value === "review" || phase.value === "error") return;
  const source = video.value;
  if (!source || !source.videoWidth) {
    scheduleWatch();
    return;
  }
  if (!firstFrameAt) {
    firstFrameAt = performance.now();
    stages.value.firstFrameMs = Math.round(firstFrameAt - openedAt);
  }
  const sample = sampleFrame(source, source.videoWidth, source.videoHeight, lastSample);
  if (sample) lastSample = sample.pixels;
  const usable = Boolean(sample && frameIsUsable(sample) && frameChanged(sample.pixels, failedSample));
  if (!sample || !usable) {
    stableFrames = 0;
    if (phase.value !== "reading" && sample) {
      stages.value.waitReason = frameWaitReason(sample);
      setStatus(sample.sharpness > 8 ? "Hold badge steady" : "Point camera at badge");
    }
    scheduleWatch();
    return;
  }
  stableFrames += 1;
  if (stableFrames < 2) {
    setStatus("Hold badge steady");
    scheduleWatch();
    return;
  }
  const frame = captureFrame(source, source.videoWidth, source.videoHeight);
  if (!frame) {
    diagnosis.value = "capture";
    setStatus(scanStatus("capture"));
    scheduleWatch();
    return;
  }
  stages.value.stabilityMs = Math.round(performance.now() - firstFrameAt);
  setStatus("Capturing...");
  busy = true;
  const found = await recognize(frame, true, generation);
  busy = false;
  if (!found && !stopped && !scanSession.isFrozen && !scanSession.userEdited && diagnosis.value !== "engine") {
    failedSample = sample.pixels;
    stableFrames = 0;
    scheduleWatch();
  }
}

async function onUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  generation = scanSession.start();
  publishedQuery = "";
  autoSearched.value = false;
  window.clearTimeout(watchTimer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (uploadedUrl) URL.revokeObjectURL(uploadedUrl);
  uploadedUrl = URL.createObjectURL(file);
  usingUpload.value = true;
  await new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.src = uploadedUrl;
  });
  phase.value = "watching";
  setStatus("Reading the uploaded badge…");
  const source = still.value;
  if (source) {
    const frame = captureFrame(source, source.naturalWidth, source.naturalHeight);
    if (frame) await recognize(frame, false, generation);
  }
  if (fileInput.value) fileInput.value.value = "";
}

async function recognize(frame: HTMLCanvasElement, fromCamera: boolean, scanGeneration: number): Promise<boolean> {
  if (scanGeneration !== generation || scanSession.isFrozen || scanSession.userEdited) return false;
  phase.value = "reading";
  setStatus("Scanning badge...");
  const captureStarted = performance.now();
  const blob = await canvasToPng(frame);
  stages.value.captureMs += Math.round(performance.now() - captureStarted);
  if (showDiagnostics) {
    if (frameUrl.value) URL.revokeObjectURL(frameUrl.value);
    frameUrl.value = URL.createObjectURL(blob);
  }
  try {
    stages.value.attempts += 1;
    const result = await readWithFallback(blob);
    if (scanGeneration !== generation || scanSession.isFrozen || scanSession.userEdited) return false;
    const verifyStarted = performance.now();
    setStatus("Identifying attendee...");
    const next = await verifyCandidates(extractAttendeeName(result.lines));
    stages.value.verifyMs += Math.round(performance.now() - verifyStarted);
    if (scanGeneration !== generation || scanSession.isFrozen || scanSession.userEdited) return false;
    decision.value = next;
    recognized.value = result.lines;
    ocrMs.value = Math.round(result.processingTimeMs);
    stages.value.ocrMs += Math.round(result.processingTimeMs);
    stages.value.initMs = initMs.value;
    stages.value.imageWidth = result.imageWidth;
    stages.value.imageHeight = result.imageHeight;
    drawOverlay(frame, result);
    const stable = fromCamera ? stabilizer.observe(next) : { name: next.selected, ready: next.reliable, uncertain: !next.reliable, options: next.candidates.map((item) => item.text) };
    const payload = scanSession.complete(scanGeneration, { selected: stable.name, reliable: stable.ready });
    if (!payload) return false;
    choices.value = stable.options.filter((option) => singleLineName(option) !== payload.fieldValue);
    name.value = payload.fieldValue;
    stages.value.totalMs = Math.round(performance.now() - openedAt);
    totalMs.value = stages.value.totalMs;
    const outcome = diagnoseScan({
      captured: true,
      engineError: result.lines.length === 0 ? engineError.value || null : null,
      lineCount: result.lines.length,
      selected: payload.fieldValue || null,
      reliable: stable.ready,
    });
    diagnosis.value = outcome;
    if (outcome === "engine") {
      phase.value = "error";
      setStatus(scanStatus("engine", engineError.value));
      window.clearTimeout(watchTimer);
      return false;
    }
    if (stable.ready && payload.searchQuery) {
      publish(payload.searchQuery);
      return true;
    }
    if (payload.fieldValue) {
      phase.value = "review";
      setStatus(scanStatus("name-unreliable"));
      window.clearTimeout(watchTimer);
      return true;
    }
    phase.value = fromCamera ? "watching" : "review";
    const rejected = next.rejected.map((item) => item.text).filter(Boolean).slice(0, 3).join(", ");
    setStatus(scanStatus(outcome === "empty-ocr" ? "empty-ocr" : "name-rejected", rejected));
    return false;
  } catch (error) {
    if (scanGeneration !== generation || scanSession.isFrozen) return false;
    const detail = error instanceof Error ? error.message : "The badge reader stopped.";
    engineError.value = detail;
    diagnosis.value = "engine";
    phase.value = "error";
    setStatus(scanStatus("engine", detail));
    window.clearTimeout(watchTimer);
    return false;
  }
}

async function verifyCandidates(decision: NameDecision): Promise<NameDecision> {
  const queries = verificationQueries(decision.candidates);
  if (queries.length === 0 || (queries.length === 1 && decision.reliable)) {
    crmChecks.value = [];
    return decision;
  }
  const checks: ContactCheck[] = [];
  for (const query of queries) {
    const key = query.toLocaleLowerCase();
    let contacts = verificationCache.get(key);
    if (!contacts) {
      try {
        const result = await api<ContactSearchResponse>(`/api/contacts/search?q=${encodeURIComponent(query)}&page=1&pageSize=20`);
        contacts = result.contacts;
      } catch {
        contacts = [];
      }
      verificationCache.set(key, contacts);
    }
    checks.push(checkCandidate(query, contacts));
  }
  crmChecks.value = checks;
  return applyContactChecks(decision, checks);
}

function publish(query: string) {
  const finalName = singleLineName(query);
  window.clearTimeout(watchTimer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  stopped = true;
  generation += 1;
  open.value = false;
  advancedOpen.value = false;
  autoSearched.value = true;
  name.value = finalName;
  setStatus("Looking up contact...");
  if (!finalName || publishedQuery === finalName) return;
  publishedQuery = finalName;
  emit("confirm", finalName);
}

function warmEngine() {
  const started = performance.now();
  void getOcrEngine("paddle")
    .then(async (engine) => {
      const ready = await engine.initialize();
      initMs.value = Math.round(ready.elapsedMs || performance.now() - started);
      stages.value.initMs = initMs.value;
    })
    .catch((error: unknown) => {
      engineError.value = error instanceof Error ? error.message : "The badge reader did not start.";
      diagnosis.value = "engine";
    });
}

async function readWithFallback(blob: Blob): Promise<OcrResult> {
  const preferred = await getOcrEngine("paddle");
  try {
    const ready = await preferred.initialize();
    initMs.value = Math.round(ready.elapsedMs);
    activeEngine.value = preferred.id;
    return await preferred.recognize(blob);
  } catch (error) {
    if (preferred.id !== "tesseract") {
      const fallback = await getOcrEngine("tesseract");
      const ready = await fallback.initialize();
      initMs.value = Math.round(ready.elapsedMs);
      activeEngine.value = "tesseract";
      const detail = error instanceof Error ? error.message : "PaddleOCR did not start.";
      engineError.value = detail;
      try {
        return await fallback.recognize(blob);
      } catch (fallbackError) {
        const fallbackDetail = fallbackError instanceof Error ? fallbackError.message : "Tesseract did not start.";
        throw new Error(`PaddleOCR failed: ${detail} Tesseract failed: ${fallbackDetail}`);
      }
    }
    throw error;
  }
}

function retry() {
  generation = scanSession.start();
  publishedQuery = "";
  stableFrames = 0;
  firstFrameAt = 0;
  openedAt = performance.now();
  resetResult();
  if (usingUpload.value && still.value) {
    const frame = captureFrame(still.value, still.value.naturalWidth, still.value.naturalHeight);
    if (frame) void recognize(frame, false, generation);
    return;
  }
  phase.value = "watching";
  setStatus("Point camera at badge");
  scheduleWatch();
}

function search() {
  publish(singleLineName(name.value));
}

function onNameInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  scanSession.noteEdit(value);
  name.value = value;
}

function chooseName(choice: string) {
  const value = singleLineName(choice);
  scanSession.noteEdit(value);
  name.value = value;
}

function toggleAdvanced() {
  advancedOpen.value = !advancedOpen.value;
}

function captureFrame(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement | null {
  if (!width || !height) return null;
  const maxWidth = 1280;
  const scale = width > maxWidth ? maxWidth / width : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The scan image could not be encoded."))), "image/png");
  });
}

function drawOverlay(frame: HTMLCanvasElement, result: OcrResult) {
  const canvas = overlay.value;
  if (!canvas || !showDiagnostics) return;
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(frame, 0, 0);
  context.strokeStyle = "#c2410c";
  context.lineWidth = 2;
  context.font = "14px sans-serif";
  context.fillStyle = "#c2410c";
  for (const line of result.lines) {
    const box = line.boundingBox;
    if (!box) continue;
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.fillText(line.text, box.x, Math.max(14, box.y - 4));
  }
}

onBeforeUnmount(stop);
</script>

<template>
  <button
    type="button"
    class="inline-flex size-12 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    aria-label="Scan a badge"
    @click="start"
  >
    <Camera class="size-5" aria-hidden="true" />
  </button>
  <section v-if="open" class="mt-3 w-full basis-full">
    <div class="mx-auto w-full max-w-xl">
      <div class="flex items-center justify-between gap-3">
        <p class="text-base font-bold">Scan badge</p>
        <button
          type="button"
          class="inline-flex size-11 items-center justify-center rounded-md text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          aria-label="Close scanner"
          @click="stop"
        >
          <X class="size-5" aria-hidden="true" />
        </button>
      </div>
      <div class="relative mt-3 aspect-[4/3] w-full overflow-hidden rounded-lg bg-black">
        <video v-show="!usingUpload" ref="video" class="h-full w-full object-contain" playsinline muted />
        <img v-if="usingUpload" ref="still" :src="uploadedUrl" alt="" class="h-full w-full object-contain" />
      </div>
      <p class="mt-3 text-center text-sm text-muted" role="status">{{ status }}</p>
      <div class="mt-3 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-bold text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          @click="retry"
        >
          Scan again
        </button>
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-bold text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          :aria-expanded="advancedOpen"
          @click="toggleAdvanced"
        >
          <Settings class="size-4" aria-hidden="true" />
          Advanced Settings
          <ChevronDown class="size-4 transition" :class="advancedOpen ? 'rotate-180' : ''" aria-hidden="true" />
        </button>
      </div>
      <div v-if="showManualEntry" class="mt-4 rounded-lg border border-line bg-surface p-3">
        <label class="block text-sm font-bold" for="badge-name-quick">Name on badge</label>
        <input
          id="badge-name-quick"
          :value="name"
          autocomplete="off"
          class="mt-1 h-11 w-full rounded-md border border-line bg-canvas px-3 text-base outline-none focus:border-brand"
          placeholder="Type the name"
          @input="onNameInput"
        />
        <div class="mt-3">
          <UiButton variant="secondary" :disabled="name.trim().length < 2" @click="search">Search contacts</UiButton>
        </div>
      </div>

      <div v-show="advancedOpen" class="mt-4 max-h-[50vh] space-y-4 overflow-y-auto rounded-lg border border-line bg-surface p-4">
        <section>
          <p class="text-sm font-bold">Manual controls</p>
          <label class="mt-3 block text-sm font-bold" for="badge-name">Name on badge</label>
          <input
            id="badge-name"
            :value="name"
            autocomplete="off"
            class="mt-1 h-11 w-full rounded-md border border-line bg-canvas px-3 text-base outline-none focus:border-brand"
            placeholder="Edit the name if needed"
            @input="onNameInput"
          />
          <div v-if="choices.length" class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="choice in choices"
              :key="choice"
              type="button"
              class="min-h-11 rounded-md border border-line px-3 text-sm"
              :class="choice === name ? 'border-brand bg-brand-soft' : 'bg-canvas'"
              @click="chooseName(choice)"
            >
              {{ choice }}
            </button>
          </div>
          <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <UiButton variant="secondary" @click="retry">Scan again</UiButton>
            <UiButton variant="secondary" @click="fileInput?.click()">Upload photo</UiButton>
            <UiButton variant="secondary" :disabled="name.trim().length < 2" @click="search">Search contacts</UiButton>
          </div>
        </section>
        <section class="border-t border-line pt-4">
          <p class="text-sm font-bold">Recognition diagnostics</p>
          <dl class="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt class="text-muted">Active engine</dt><dd>{{ activeEngine }}</dd></div>
            <div><dt class="text-muted">Scanner state</dt><dd>{{ phase }}</dd></div>
            <div><dt class="text-muted">Camera to first frame</dt><dd>{{ stages.firstFrameMs }} ms</dd></div>
            <div><dt class="text-muted">Stability wait</dt><dd>{{ stages.stabilityMs }} ms</dd></div>
            <div><dt class="text-muted">Capture</dt><dd>{{ stages.captureMs }} ms</dd></div>
            <div><dt class="text-muted">Model init</dt><dd>{{ stages.initMs }} ms</dd></div>
            <div><dt class="text-muted">OCR</dt><dd>{{ stages.ocrMs }} ms · {{ stages.attempts }} attempt{{ stages.attempts === 1 ? "" : "s" }}</dd></div>
            <div><dt class="text-muted">Name check</dt><dd>{{ stages.verifyMs }} ms</dd></div>
            <div><dt class="text-muted">Open to result</dt><dd>{{ stages.totalMs }} ms</dd></div>
            <div><dt class="text-muted">Automatic search</dt><dd>{{ autoSearched ? "Yes" : "No" }}</dd></div>
            <div><dt class="text-muted">Failure</dt><dd>{{ diagnosis || "None" }}</dd></div>
            <div><dt class="text-muted">Captured size</dt><dd>{{ stages.imageWidth && stages.imageHeight ? `${stages.imageWidth}×${stages.imageHeight}` : "Not captured" }}</dd></div>
          </dl>
          <p v-if="stages.waitReason" class="mt-2 text-sm text-muted">{{ stages.waitReason }}</p>
          <p v-if="engineError" class="mt-2 text-sm text-muted">{{ engineError }}</p>
        </section>
        <section class="border-t border-line pt-4">
          <p class="text-sm font-bold">Name selection</p>
          <p v-if="decision" class="mt-2 text-sm">{{ decision.selected || "No name selected" }}. Reliable: {{ decision.reliable ? "yes" : "no" }}. {{ decision.selectionReason }}</p>
          <ul v-if="recognized.length" class="mt-3 space-y-1 text-sm">
            <li v-for="(item, index) in recognized" :key="index">
              {{ item.text }}
              <span v-if="item.confidence != null" class="text-muted"> · {{ Math.round(item.confidence * 100) }}%</span>
              <span v-if="item.boundingBox" class="text-muted"> · {{ Math.round(item.boundingBox.x) }},{{ Math.round(item.boundingBox.y) }} {{ Math.round(item.boundingBox.width) }}×{{ Math.round(item.boundingBox.height) }}</span>
            </li>
          </ul>
          <ul v-if="decision?.candidates.length" class="mt-3 space-y-1 text-sm">
            <li v-for="item in decision.candidates" :key="item.text">{{ item.source }} · {{ item.text }} · {{ item.score.toFixed(2) }} · {{ item.reasons.join(" ") }}</li>
          </ul>
          <ul v-if="decision?.rejected.length" class="mt-3 space-y-1 text-sm text-muted">
            <li v-for="item in decision.rejected" :key="item.text">Rejected {{ item.text }}: {{ item.reasons.join(" ") }}</li>
          </ul>
          <ul v-if="crmChecks.length" class="mt-3 space-y-1 text-sm">
            <li v-for="check in crmChecks" :key="check.query">COTO {{ check.query }}: {{ check.quality }}<template v-if="check.matchedName"> · {{ check.matchedName }}</template></li>
          </ul>
        </section>
        <section class="border-t border-line pt-4">
          <p class="text-sm font-bold">Captured image</p>
          <canvas v-show="frameUrl" ref="overlay" class="mt-3 max-h-64 max-w-full border border-line" />
          <a v-if="frameUrl" :href="frameUrl" download="badge-scan.png" class="mt-2 inline-block text-sm text-brand-strong underline">Download capture</a>
        </section>
      </div>
    </div>
    <input ref="fileInput" class="hidden" type="file" accept="image/*" @change="onUpload" />
  </section>
</template>
