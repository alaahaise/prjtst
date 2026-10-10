import { reactive } from 'vue';

export const toastState = reactive({ items: [] });

let uid = 0;

export function toast(text, ok = true) {
  const id = ++uid;
  toastState.items.push({ id, text, ok });
  setTimeout(() => {
    const idx = toastState.items.findIndex(t => t.id === id);
    if (idx !== -1) toastState.items.splice(idx, 1);
  }, 3200);
}
