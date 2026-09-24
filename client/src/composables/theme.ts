import { computed, ref } from "vue";

const theme = ref<"light" | "dark">(
  document.documentElement.dataset.theme === "dark" ? "dark" : "light",
);

export function useTheme() {
  const isDark = computed(() => theme.value === "dark");

  function setTheme(next: "light" | "dark") {
    theme.value = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset.theme = next;
    localStorage.setItem("evoq-theme", next);
  }

  function toggleTheme() {
    setTheme(theme.value === "dark" ? "light" : "dark");
  }

  return { theme, isDark, toggleTheme };
}
