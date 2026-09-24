import { ref } from "vue";

export type RecentContact = {
  id: string;
  name: string;
  inquirySaved: boolean;
};

const recent = ref<RecentContact[]>([]);

export function useRecentContacts() {
  function remember(contact: { id: string; name: string }, inquirySaved = false) {
    const existing = recent.value.find((item) => item.id === contact.id);
    const next = {
      id: contact.id,
      name: contact.name,
      inquirySaved: inquirySaved || existing?.inquirySaved || false,
    };
    recent.value = [next, ...recent.value.filter((item) => item.id !== contact.id)].slice(0, 8);
  }

  function markInquiry(id: string) {
    recent.value = recent.value.map((item) => (item.id === id ? { ...item, inquirySaved: true } : item));
  }

  return { recent, remember, markInquiry };
}
