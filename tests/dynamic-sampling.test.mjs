import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../workers/site.js';

const siteKey = 'ABCDEFGHIJKL';
const candidates = [
  { id: 'one', slug: 'first-fact', size: 'responsive', editorial_type: 'did_you_know', topics: 'general,home' },
  { id: 'two', slug: 'second-fact', size: 'responsive', editorial_type: 'did_you_know', topics: 'general,home' },
  { id: 'three', slug: 'third-fact', size: 'responsive', editorial_type: 'did_you_know', topics: 'general,home' },
];

function fakeEnvironment({ missing = [] } = {}) {
  const missingKeys = new Set(missing);
  const counted = [];
  const values = new Map(
    candidates.map(item => [
      `b:${siteKey}:${item.slug}`,
      { balloonId: item.id, html: `<p>${item.slug}</p>`, css: '', size: item.size },
    ]),
  );

  const DB = {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async all() {
          if (!sql.includes("b.status='published'")) throw new Error(`Unexpected query: ${sql}`);
          const [, size, ...types] = this.args;
          return {
            results: candidates.filter(item => item.size === size && types.includes(item.editorial_type)),
          };
        },
        async run() {
          counted.push([...this.args]);
          return { success: true };
        },
      };
    },
  };

  const CONBAL_KV = {
    async get(key) {
      if (missingKeys.has(key)) return null;
      return values.get(key) || null;
    },
    async put(key, value) { values.set(key, JSON.parse(value)); },
  };

  return {
    env: { DB, CONBAL_KV, ASSETS: { fetch: () => new Response('asset') } },
    counted,
  };
}

function sampleUrl(slots, { excludeSlugs } = {}) {
  const url = new URL(`https://conbal.us/b/${siteKey}/_sample`);
  url.searchParams.set('nonce', 'test-load-1');
  url.searchParams.set('slots', JSON.stringify(slots));
  if (excludeSlugs !== undefined) url.searchParams.set('exclude_slugs', excludeSlugs);
  return url;
}

const slots = ['alpha', 'beta', 'gamma'].map(id => ({
  id,
  size: 'responsive',
  topics: ['home'],
  editorial_types: ['did_you_know'],
}));

test('sampling returns one unique, exact-size public item per requested slot', async () => {
  const { env, counted } = fakeEnvironment();
  const pending = [];
  const response = await worker.fetch(
    new Request(sampleUrl(slots)),
    env,
    { waitUntil: promise => pending.push(promise) },
  );
  await Promise.all(pending);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('cache-control'), /no-store/);

  const body = await response.json();
  assert.deepEqual(Object.keys(body.slots).sort(), ['alpha', 'beta', 'gamma']);
  assert.equal(new Set(Object.values(body.slots).map(item => item.slug)).size, 3);
  for (const item of Object.values(body.slots)) {
    assert.equal(item.size, 'responsive');
    assert.equal(item.editorial_type, 'did_you_know');
  }
  assert.doesNotMatch(JSON.stringify(body), /balloonId|site_id|user_id/);
  assert.equal(counted.length, 1);
  assert.equal(counted[0].length, 3);
});

test('sampling skips missing published KV values and counts only returned items', async () => {
  const { env, counted } = fakeEnvironment({ missing: [`b:${siteKey}:second-fact`] });
  const pending = [];
  const response = await worker.fetch(
    new Request(sampleUrl(slots)),
    env,
    { waitUntil: promise => pending.push(promise) },
  );
  await Promise.all(pending);

  const body = await response.json();
  assert.equal(Object.keys(body.slots).length, 2);
  assert.equal(counted.length, 1);
  assert.equal(counted[0].length, 2);
});

test('sampling prefers eligible balloons that were not recently displayed', async () => {
  const { env } = fakeEnvironment();
  const response = await worker.fetch(
    new Request(sampleUrl([slots[0]], { excludeSlugs: 'first-fact,second-fact' })),
    env,
    {},
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).slots.alpha.slug, 'third-fact');
});

test('sampling falls back to an excluded balloon only when every eligible balloon is excluded', async () => {
  const { env } = fakeEnvironment();
  const response = await worker.fetch(
    new Request(sampleUrl([slots[0]], { excludeSlugs: candidates.map(item => item.slug).join(',') })),
    env,
    {},
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(candidates.some(item => item.slug === body.slots.alpha.slug));
});

test('sampling rejects malformed or oversized slot requests', async () => {
  const { env } = fakeEnvironment();
  const badSize = [{ ...slots[0], size: '640x480' }];
  const badResponse = await worker.fetch(new Request(sampleUrl(badSize)), env, {});
  assert.equal(badResponse.status, 400);

  const tooMany = Array.from({ length: 9 }, (_, index) => ({ ...slots[0], id: `slot-${index}` }));
  const manyResponse = await worker.fetch(new Request(sampleUrl(tooMany)), env, {});
  assert.equal(manyResponse.status, 400);

  const malformedExcludes = await worker.fetch(new Request(sampleUrl([slots[0]], { excludeSlugs: 'first-fact,NOT-VALID' })), env, {});
  assert.equal(malformedExcludes.status, 400);

  const oversizedExcludes = Array.from({ length: 31 }, (_, index) => `fact-${index}`).join(',');
  const oversizedResponse = await worker.fetch(new Request(sampleUrl([slots[0]], { excludeSlugs: oversizedExcludes })), env, {});
  assert.equal(oversizedResponse.status, 400);

  const methodResponse = await worker.fetch(new Request(sampleUrl(slots), { method: 'POST' }), env, {});
  assert.equal(methodResponse.status, 405);
});

test('legacy explicit-slug delivery remains public and backward compatible', async () => {
  const { env } = fakeEnvironment();
  const pending = [];
  const response = await worker.fetch(
    new Request(`https://conbal.us/b/${siteKey}/first-fact`),
    env,
    { waitUntil: promise => pending.push(promise) },
  );
  await Promise.all(pending);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    'first-fact': { html: '<p>first-fact</p>', css: '', size: 'responsive' },
  });
});
