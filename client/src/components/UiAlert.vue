<script setup lang="ts">
import { X } from "lucide-vue-next";

defineProps<{
  tone?: "error" | "success" | "info";
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div
    role="status"
    class="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5 text-sm"
    :class="{
      'border-danger/30 bg-danger-soft text-danger': tone === 'error' || !tone,
      'border-success/30 bg-success-soft text-success': tone === 'success',
      'border-line bg-surface-muted text-ink': tone === 'info',
    }"
  >
    <div class="min-w-0 flex-1">
      <slot />
    </div>
    <button type="button" class="inline-flex size-6 shrink-0 items-center justify-center" aria-label="Dismiss" @click="emit('close')">
      <X class="size-4" aria-hidden="true" />
    </button>
  </div>
</template>
