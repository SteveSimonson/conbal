import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../workers/site.js';

function env(files = {}) {
  return {
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        const file = files[url.pathname];
        if (!file) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
        return new Response(file.body, { headers: { 'content-type': file.type } });
      },
    },
    CONBAL_KV: { async get() { return null; }, async put() {}, async delete() {} },
    DB: { prepare() { throw new Error('database should not be used for static asset requests'); } },
  };
}

function request(path, init = {}) {
  return new Request(`https://conbal.us${path}`, init);
}

test('privacy page is served at /privacy', async () => {
  const response = await worker.fetch(request('/privacy'), env({
    '/privacy.html': { type: 'text/html', body: '<!doctype html><title>Privacy</title><h1>Privacy</h1>' },
  }), {});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Privacy/);
  assert.match(response.headers.get('content-type'), /text\/html/);
});

test('www host redirects to the HTTPS apex in one hop with HSTS', async () => {
  const response = await worker.fetch(new Request('https://www.conbal.us/method?ref=1'), env(), {});
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://conbal.us/method?ref=1');
  assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('static assets receive path-appropriate cache headers', async () => {
  const files = {
    '/': { type: 'text/html', body: '<!doctype html><title>Conbal</title>' },
    '/marketing.css': { type: 'text/css', body: 'body{color:#111}' },
    '/embed.js': { type: 'text/javascript', body: 'void 0;' },
    '/conbal-hero-1280.webp': { type: 'image/webp', body: 'webp' },
    '/assets/fonts/fraunces-v38-latin.woff2': { type: 'font/woff2', body: 'font' },
  };
  const cases = [
    ['/', 'public, max-age=0, must-revalidate', false],
    ['/marketing.css', 'public, max-age=300, must-revalidate', false],
    ['/embed.js', 'public, max-age=0, must-revalidate', false],
    ['/conbal-hero-1280.webp', 'public, max-age=604800', false],
    ['/assets/fonts/fraunces-v38-latin.woff2', 'public, max-age=31536000, immutable', true],
  ];
  for (const [path, cache, immutable] of cases) {
    const response = await worker.fetch(request(path), env(files), {});
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), cache, path);
    assert.equal(/immutable/.test(response.headers.get('cache-control')), immutable, path);
    assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
  }
});

test('HEAD asset requests do not subfetch ASSETS with HEAD', async () => {
  let methods = [];
  const environment = {
    ASSETS: {
      async fetch(request) {
        methods.push(request.method);
        return new Response('<!doctype html><title>Conbal</title>', { headers: { 'content-type': 'text/html' } });
      },
    },
  };
  const response = await worker.fetch(request('/', { method: 'HEAD' }), environment, {});
  assert.equal(response.status, 200);
  assert.deepEqual(methods, ['GET']);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
});
