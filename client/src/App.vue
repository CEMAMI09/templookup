<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { RouterView, useRouter } from "vue-router";
import { isIdle, IDLE_LIMIT_MS } from "@/composables/idle";
import { logout, useSession } from "@/composables/session";

const router = useRouter();
const session = useSession();
let lastActivityAt = Date.now();
let timer = 0;
let signingOut = false;

function noteActivity() {
  lastActivityAt = Date.now();
}

async function signOutForInactivity() {
  if (signingOut || !session.staff.value) return;
  if (!isIdle(lastActivityAt, Date.now(), IDLE_LIMIT_MS)) return;
  signingOut = true;
  stopIdleWatch();
  await logout();
  if (router.currentRoute.value.name !== "login") {
    await router.push({ name: "login", query: { reason: "inactive" } });
  }
  signingOut = false;
}

function stopIdleWatch() {
  window.clearInterval(timer);
  timer = 0;
  window.removeEventListener("pointerdown", noteActivity);
  window.removeEventListener("keydown", noteActivity);
  window.removeEventListener("touchstart", noteActivity);
  document.removeEventListener("visibilitychange", onVisible);
}

function onVisible() {
  if (document.visibilityState === "visible") void signOutForInactivity();
}

function startIdleWatch() {
  stopIdleWatch();
  noteActivity();
  window.addEventListener("pointerdown", noteActivity, { passive: true });
  window.addEventListener("keydown", noteActivity);
  window.addEventListener("touchstart", noteActivity, { passive: true });
  document.addEventListener("visibilitychange", onVisible);
  timer = window.setInterval(() => void signOutForInactivity(), 15_000);
}

watch(
  () => session.staff.value,
  (staff) => {
    if (staff) startIdleWatch();
    else stopIdleWatch();
  },
  { immediate: true },
);

onBeforeUnmount(stopIdleWatch);
</script>

<template>
  <RouterView />
</template>
