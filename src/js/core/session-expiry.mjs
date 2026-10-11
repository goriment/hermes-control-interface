// Coordinate concurrent 401 responses without mistaking an upstream failure for logout.
export function createSessionExpiryHandler({ state, fetchSession, onExpired }) {
  let pending = null;
  return async function handleUnauthorized(requestGeneration = state.authGeneration || 0) {
    if (requestGeneration !== (state.authGeneration || 0)) return { ok: false, error: 'stale-session-response' };
    if (state.authExpired) return { ok: false, error: 'unauthorized' };
    if (!pending || pending.generation !== requestGeneration) {
      const probe = { generation: requestGeneration };
      pending = probe;
      probe.promise = (async () => {
        let session;
        try { session = await fetchSession(); }
        catch { return { ok: false, error: 'session-check-unavailable' }; }
        if (requestGeneration !== (state.authGeneration || 0)) return { ok: false, error: 'stale-session-response' };
        if (session.ok) return { ok: false, error: 'upstream-unauthorized' };
        if (session.status !== 401) return { ok: false, error: 'session-check-unavailable' };
        if (!state.authExpired) {
          state.authExpired = true;
          state.user = null;
          state.csrfToken = null;
          await onExpired();
        }
        return { ok: false, error: 'unauthorized' };
      })().finally(() => { if (pending === probe) pending = null; });
    }
    return pending.promise;
  };
}
