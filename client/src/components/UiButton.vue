<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost";
    type?: "button" | "submit";
    disabled?: boolean;
  }>(),
  { variant: "primary", type: "button", disabled: false },
);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
    :class="{
      'bg-brand-strong text-on-brand hover:brightness-110': variant === 'primary',
      'border border-line bg-surface text-ink hover:bg-surface-muted': variant === 'secondary',
      'text-brand-strong hover:bg-brand-soft': variant === 'ghost',
    }"
  >
    <slot />
  </button>
</template>
