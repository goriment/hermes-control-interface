import { state, t, stopKanbanPoll } from './state.js';;
import { showToast } from '../components/toast.js';

import { createSessionExpiryHandler } from './session-expiry.mjs';

const handleUnauthorized = createSessionExpiryHandler({
  state,
  fetchSession: () => fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' }),
  onExpired: async () => {
    showToast(t('toast.sessionExpired'), 'error');
    window.__csrfToken = null;
    stopKanbanPoll();
    clearInterval(state.notifInterval);
    clearInterval(state._officeInterval);
    state.notifInterval = null;
    state._officeInterval = null;
    const { showLogin } = await import('./auth.js');
    showLogin();
  },
});

async function api(url, options = {}) {
  if (state.authExpired) return { ok: false, error: 'unauthorized' };
  const requestGeneration = state.authGeneration || 0;
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    // Add CSRF token for mutating requests
    if (state.csrfToken && options.method && options.method !== 'GET') {
      headers['X-CSRF-Token'] = state.csrfToken;
    }
    const res = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
    });
    if (res.status === 401) {
      return handleUnauthorized(requestGeneration);
    }
    if (res.status === 429) {
      showToast(t('toast.rateLimited'), 'warning');
      return { ok: false, error: 'rate-limited' };
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }
    // Non-JSON response (HTML error page, etc.)
    const text = await res.text();
    return { ok: false, error: text.substring(0, 200) };
  } catch (err) {
    showToast(t('toast.networkError'), 'error');
    return { ok: false, error: 'network' };
  }
}

export { api };
