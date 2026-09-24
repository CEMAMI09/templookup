import { createRouter, createWebHistory } from "vue-router";
import { restore, useSession } from "@/composables/session";
import LoginView from "@/views/LoginView.vue";
import SearchView from "@/views/SearchView.vue";
import ContactView from "@/views/ContactView.vue";
import ContactFormView from "@/views/ContactFormView.vue";
import InquiryView from "@/views/InquiryView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginView, meta: { public: true } },
    { path: "/", name: "search", component: SearchView },
    { path: "/contacts/new", name: "contact-create", component: ContactFormView },
    { path: "/contacts/:id", name: "contact", component: ContactView },
    { path: "/contacts/:id/edit", name: "contact-edit", component: ContactFormView },
    { path: "/contacts/:id/inquiry", name: "inquiry", component: InquiryView },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.ready.value) await restore();
  if (!to.meta.public && !session.staff.value) {
    return { name: "login", query: { next: to.fullPath } };
  }
  if (to.name === "login" && session.staff.value) return { name: "search" };
  return true;
});
