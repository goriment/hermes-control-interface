const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/js/core/session-expiry.mjs');
test('concurrent unauthorized polling prompts login once and clears stale identity', async () => {
  const { createSessionExpiryHandler } = await load();
  const state = { user: { username: 'test' }, csrfToken: 'synthetic' };
  let prompts = 0, probes = 0;
  const handle = createSessionExpiryHandler({ state, fetchSession: async () => { probes++; return { status: 401, ok: false }; }, onExpired: async () => { prompts++; } });
  await Promise.all(Array.from({ length: 20 }, () => handle()));
  await handle();
  assert.equal(probes, 1);
  assert.equal(prompts, 1);
  assert.equal(state.user, null);
  assert.equal(state.csrfToken, null);
  assert.equal(state.authExpired, true);
});
test('upstream 401 leaves valid web session authenticated', async () => {
  const { createSessionExpiryHandler } = await load();
  const state = { user: { username: 'test' } };
  const handle = createSessionExpiryHandler({ state, fetchSession: async () => ({ status: 200, ok: true }), onExpired: () => assert.fail('must not log out') });
  assert.equal((await handle()).error, 'upstream-unauthorized');
  assert.equal(state.user.username, 'test');
  assert.equal(state.authExpired, undefined);
});
test('failed session probe does not falsely log out the user', async () => {
  const { createSessionExpiryHandler } = await load();
  const state = { user: { username: 'test' } };
  for (const fetchSession of [async () => { throw new Error('offline'); }, async () => ({ status: 503, ok: false })]) {
    const handle = createSessionExpiryHandler({ state, fetchSession, onExpired: () => assert.fail('must not log out') });
    assert.equal((await handle()).error, 'session-check-unavailable');
    assert.equal(state.user.username, 'test');
  }
});
test('401 from an old request cannot expire a newly logged-in session', async () => {
  const { createSessionExpiryHandler } = await load();
  const state = { authGeneration: 1, user: { username: 'old' } };
  let resolve;
  const handle = createSessionExpiryHandler({ state, fetchSession: () => new Promise(r => { resolve = r; }), onExpired: () => assert.fail('new login must remain') });
  const pending = handle(1);
  state.authGeneration = 2;
  state.user = { username: 'new' };
  resolve({ status: 401, ok: false });
  assert.equal((await pending).error, 'stale-session-response');
  assert.equal((await handle(1)).error, 'stale-session-response');
  assert.equal(state.user.username, 'new');
});
test('new login permits a later genuine expiry to prompt again', async () => {
  const { createSessionExpiryHandler } = await load();
  const state = { authGeneration: 0 };
  let prompts = 0;
  const handle = createSessionExpiryHandler({ state, fetchSession: async () => ({ status: 401, ok: false }), onExpired: async () => { prompts++; } });
  await handle();
  state.authGeneration++;
  state.authExpired = false;
  state.user = { username: 'new' };
  await handle();
  assert.equal(prompts, 2);
});
