<script setup lang="ts">
import { ref } from "vue";
import { Eye, EyeOff } from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "@/api/client";
import { login } from "@/composables/session";

const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const showPassword = ref(false);
const error = ref("");
const pending = ref(false);

async function submit() {
  error.value = "";
  pending.value = true;
  try {
    await login(email.value, password.value);
    const next = typeof route.query.next === "string" ? route.query.next : "/";
    await router.push(next.startsWith("/") ? next : "/");
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : "Sign in failed. Try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-dvh place-items-center bg-[#1c1f20] px-4">
    <div class="relative w-full max-w-md">
      <img
        src="/brand/evoq-on-dark.png"
        alt="EVOQ Technologies"
        class="absolute bottom-[calc(100%+1.25rem)] left-1/2 h-14 w-auto -translate-x-1/2"
      />
      <form class="w-full bg-white px-10 py-12 text-black" @submit.prevent="submit">
      <div>
        <label class="text-sm" for="email">Email</label>
        <input
          id="email"
          v-model="email"
          type="email"
          autocomplete="username"
          required
          placeholder="Enter your Email"
          class="mt-2 h-11 w-full rounded-md border border-[#c5d0d6] px-3 text-sm outline-none placeholder:text-[#8aa0ab] focus:border-[#0e8494]"
        />
      </div>
      <div class="mt-5">
        <label class="text-sm" for="password">Password</label>
        <div class="mt-2 flex h-11">
          <input
            id="password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            required
            placeholder="Enter your Password"
            class="min-w-0 flex-1 rounded-l-md border border-r-0 border-[#c5d0d6] px-3 text-sm outline-none placeholder:text-[#8aa0ab] focus:border-[#0e8494]"
          />
          <button
            type="button"
            class="inline-flex w-12 cursor-pointer items-center justify-center rounded-r-md border border-[#c5d0d6] bg-white text-[#5c7380] hover:border-[#2e8ab8] hover:bg-[#e7f4fb] hover:text-[#264859]"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            @click="showPassword = !showPassword"
          >
            <EyeOff v-if="showPassword" class="size-5" aria-hidden="true" />
            <Eye v-else class="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p v-if="error" class="mt-4 text-sm text-[#8d2b2b]" role="alert">{{ error }}</p>
      <button
        type="submit"
        class="mt-5 h-11 w-full rounded-md bg-[#0e8494] text-sm font-bold text-white hover:bg-[#0c7382] disabled:opacity-60"
        :disabled="pending"
      >
        {{ pending ? "Signing in…" : "Sign in" }}
      </button>
    </form>
    </div>
  </div>
</template>
