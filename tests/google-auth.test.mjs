import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../workers/site.js';

function env({ db } = {}) {
  const writes = [];
  const values = new Map();
  return {
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    SIGNUP_INVITE_CODE: 'invite-123',
    writes,
    CONBAL_KV: {
      async put(key, value, options) { values.set(key, value); writes.push({ key, value: JSON.parse(value), options }); },
      async get(key, type) { const value = values.get(key); return value === undefined ? null : type === 'json' ? JSON.parse(value) : value; },
      async delete(key) { values.delete(key); },
    },
    DB: db || { prepare() { throw new Error('database should not be touched for the start request'); } },
  };
}

test('Google is the only supported login entry point', async () => {
  for (const path of ['/api/login', '/api/signup']) {
    const response = await worker.fetch(new Request(`https://conbal.us${path}`, { method: 'POST' }), env(), {});
    assert.equal(response.status, 410);
    assert.equal((await response.json()).error, 'Google sign-in is the only supported login method');
  }
});

test('Google start request stores invite authorization in server-side state', async () => {
  const environment = env();
  const response = await worker.fetch(new Request('https://conbal.us/api/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: 'invite-123' }),
  }), environment, {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.match(payload.location, /client_id=google-client-id/);
  assert.match(payload.location, /redirect_uri=https%3A%2F%2Fconbal\.us%2Fapi%2Fauth%2Fgoogle%2Fcallback/);
  assert.equal(environment.writes.length, 1);
  assert.equal(environment.writes[0].value.inviteAuthorized, true);
  assert.match(response.headers.get('set-cookie'), /conbal_oauth_state=/);
});

test('verified Google email links an existing password-era account', async () => {
  const calls = [];
  let linked = false;
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            async first() {
              if (sql.includes('WHERE google_id=?')) return linked ? { id: 'legacy-user', email: 'owner@example.com' } : null;
              if (sql.includes('WHERE email=?')) return { id: 'legacy-user', email: 'owner@example.com', google_id: null };
              return null;
            },
            async run() { if (sql.startsWith('UPDATE users SET google_id=?')) linked = true; return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
  const environment = env({ db });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const target = String(input);
    if (target.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 });
    if (target.includes('openidconnect.googleapis.com/v1/userinfo')) return new Response(JSON.stringify({ sub: 'google-sub', email: 'owner@example.com', email_verified: true }), { status: 200 });
    return originalFetch(input);
  };
  try {
    const start = await worker.fetch(new Request('https://conbal.us/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }), environment, {});
    const state = decodeURIComponent(start.headers.get('set-cookie').match(/conbal_oauth_state=([^;]+)/)[1]);
    const callback = await worker.fetch(new Request(`https://conbal.us/api/auth/google/callback?code=oauth-code&state=${encodeURIComponent(state)}`, { headers: { cookie: `conbal_oauth_state=${encodeURIComponent(state)}` } }), environment, {});
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), 'https://conbal.us/admin/');
    assert.match(callback.headers.get('set-cookie'), /conbal_session=/);
    assert.ok(calls.some(call => call.sql.startsWith('UPDATE users SET google_id=?')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
