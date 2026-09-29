import { createApp } from "vue";
import App from "./App.vue";
import { setUnauthorizedHandler } from "./api/unauthorized";
import { clearLocalSession, useSession } from "./composables/session";
import { router } from "./router";
import "./styles/theme.css";

setUnauthorizedHandler(() => {
  const wasSignedIn = Boolean(useSession().staff.value);
  clearLocalSession();
  const route = router.currentRoute.value;
  if (!wasSignedIn || route.name === "login") return;
  const next = route.path.startsWith("/") && route.path !== "/" && route.path !== "/login" ? route.path : "";
  void router.push({ name: "login", query: { reason: "expired", ...(next ? { next } : {}) } });
});

createApp(App).use(router).mount("#app");
