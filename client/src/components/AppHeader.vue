<script setup lang="ts">
import { Moon, Sun } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { logout, useSession } from "@/composables/session";
import { useTheme } from "@/composables/theme";

const router = useRouter();
const session = useSession();
const { isDark, toggleTheme } = useTheme();

async function signOut() {
  await logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <header class="bg-transparent">
    <div class="flex w-full items-center gap-3 px-4 py-4 sm:px-6">
      <RouterLink to="/" class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
        <img
          :src="isDark ? '/brand/evoq-on-dark.png' : '/brand/evoq-on-light.png'"
          alt="EVOQ Technologies"
          class="h-12 w-auto sm:h-14"
        />
      </RouterLink>
      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          class="inline-flex size-11 items-center justify-center rounded-md text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
          @click="toggleTheme"
        >
          <Sun v-if="isDark" class="size-4" aria-hidden="true" />
          <Moon v-else class="size-4" aria-hidden="true" />
        </button>
        <button
          v-if="session.staff.value"
          type="button"
          class="inline-flex min-h-10 items-center rounded-md border border-brand px-3.5 text-sm font-bold text-brand hover:bg-brand hover:text-on-brand"
          @click="signOut"
        >
          Sign out
        </button>
      </div>
    </div>
  </header>
</template>
