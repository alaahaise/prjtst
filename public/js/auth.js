import { reactive } from 'vue';
import { api, setUnauthorizedHandler } from './api.js';

export const authState = reactive({
  user: null,      // { id, username, role } | null
  checked: false    // becomes true once we've asked the server at least once
});

export async function fetchMe() {
  try {
    const user = await api('/auth/me');
    authState.user = user;
  } catch {
    authState.user = null;
  } finally {
    authState.checked = true;
  }
}

export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Échec de la connexion');
  authState.user = data;
  authState.checked = true;
  return data;
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch { /* ignore */ }
  authState.user = null;
}

// If any API call comes back 401 mid-session, drop the local user so route
// guards send the person back to /login on their next navigation.
setUnauthorizedHandler(() => { authState.user = null; });
