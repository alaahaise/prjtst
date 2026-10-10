const API = '/api';

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...opts
  });

  if (res.status === 401) {
    onUnauthorized();
    throw new Error('Session expirée, veuillez vous reconnecter');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'La requête a échoué');
  return data;
}
