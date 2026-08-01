import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../workers/site.js';

const siteKey = 'ABCDEFGHIJKL';
const baseSlot = {
  id: 'primary',
  role: 'inline-note',
  topics: ['home'],
  editorial_types: ['did_you_know'],
  budget: 'standard-v1',
  container: { width: 640, height: 180 },
};

function requestBody(overrides = {}) {
  return {
    contract: '2.0',
    page_view_id: 'page-view_123:retry',
    repeat_policy: 'omit',
    exclude_slugs: [],
    slots: [baseSlot],
    ...overrides,
  };
}

function v2Request(data = requestBody(), method = 'POST') {
  return new Request(`https://conbal.us/v2/b/${siteKey}/sample`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
  });
}

function fakeEnvironment(inventory = [], { reverseEveryQuery = false } = {}) {
  const counted = [];
  const kvValues = new Map(inventory.map(item => [
    `b:${siteKey}:${item.slug}`,
    { balloonId: item.id, html: item.kvHtml ?? item.html, css: item.css ?? '.owner{}', size: item.size ?? 'responsive' },
  ]));
  let queryCount = 0;
  const DB = {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async all() {
          if (!sql.includes("b.status='published'")) throw new Error(`Unexpected query: ${sql}`);
          const [, ...types] = this.args;
          let rows = inventory.filter(item => (item.status ?? 'published') === 'published' && types.includes(item.editorial_type));
          if (reverseEveryQuery && queryCount++ % 2) rows = [...rows].reverse();
          return { results: rows };
        },
        async run() {
          counted.push([...this.args]);
          return { success: true };
        },
      };
    },
  };
  const CONBAL_KV = {
    async get(key) { return kvValues.get(key) ?? null; },
    async put(key, value) { kvValues.set(key, JSON.parse(value)); },
  };
  return { env: { DB, CONBAL_KV, ASSETS: { fetch: () => new Response('asset') } }, counted };
}

const inventory = [
  { id: 'context-one', slug: 'context-one', title: 'Context one title', html: '<h2>Context one</h2><p>Useful home detail.</p>', editorial_type: 'did_you_know', topics: 'home' },
  { id: 'context-two', slug: 'context-two', title: 'Context two title', html: '<h2>Context two</h2><p>Another home detail.</p>', editorial_type: 'did_you_know', topics: 'home,general' },
  { id: 'generic-one', slug: 'generic-one', title: 'Generic title', html: '<p>Generic detail.</p>', editorial_type: 'did_you_know', topics: 'general' },
];

test('v2 returns the structured 2.0 contract with bounded plain text only', async () => {
  const source = {
    id: 'safe',
    slug: 'safe-copy',
    title: 'Database fallback',
    html: '<style>.secret{color:red}</style><h2>Home &amp; craft</h2><p>Useful <strong>bamboo</strong> detail.</p><script>alert("no")</script>',
    kvHtml: '<h1>Stale KV heading</h1>',
    css: 'body{background:red}',
    editorial_type: 'did_you_know',
    topics: 'home',
  };
  const { env, counted } = fakeEnvironment([source]);
  const response = await worker.fetch(v2Request(), env, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(body, {
    assignments: {
      primary: {
        assignment_id: body.assignments.primary.assignment_id,
        slug: 'safe-copy',
        role: 'inline-note',
        budget: 'standard-v1',
        editorial_type: 'did_you_know',
        content: {
          headline: 'Home & craft',
          body: 'Useful bamboo detail.',
        },
      },
    },
  });
  assert.match(body.assignments.primary.assignment_id, /^v2_[0-9a-f]{32}$/);
  assert.doesNotMatch(JSON.stringify(body), /<[^>]*>|html|css|color|background|alert|Stale KV/);
  assert.deepEqual(counted, [['safe']]);
});

test('v2 assignments are stable across retries and database row order', async () => {
  const { env } = fakeEnvironment(inventory, { reverseEveryQuery: true });
  const slots = ['alpha', 'beta', 'gamma'].map((id, index) => ({
    ...baseSlot,
    id,
    role: ['inline-note', 'section-break', 'grid-tile'][index],
  }));
  const request = requestBody({ slots });
  const first = await (await worker.fetch(v2Request(request), env, {})).json();
  const second = await (await worker.fetch(v2Request(request), env, {})).json();
  const nextPage = await (await worker.fetch(v2Request({ ...request, page_view_id: 'next-page-view' }), env, {})).json();

  assert.deepEqual(second, first);
  assert.equal(new Set(Object.values(first.assignments).map(item => item.slug)).size, 3);
  assert.notDeepEqual(
    Object.values(nextPage.assignments).map(item => item.assignment_id).sort(),
    Object.values(first.assignments).map(item => item.assignment_id).sort(),
  );
});

test('v2 exact context outranks unseen generic content', async () => {
  const { env } = fakeEnvironment(inventory);
  const response = await worker.fetch(v2Request(), env, {});
  const selected = (await response.json()).assignments.primary;

  assert.ok(['context-one', 'context-two'].includes(selected.slug));
  assert.notEqual(selected.slug, 'generic-one');
});

test('repeat_policy omit honors exclusions and leaves unfillable slots absent', async () => {
  const { env } = fakeEnvironment(inventory);
  const slots = ['one', 'two', 'three'].map((id, index) => ({
    ...baseSlot,
    id,
    role: ['inline-note', 'section-break', 'aside-note'][index],
  }));
  const response = await worker.fetch(v2Request(requestBody({
    exclude_slugs: ['context-one', 'context-two'],
    slots,
  })), env, {});
  const body = await response.json();

  assert.deepEqual(Object.values(body.assignments).map(item => item.slug), ['generic-one']);
  assert.equal(Object.keys(body.assignments).length, 1);
});

test('v2 extracts a safe title fallback and enforces compact copy budgets', async () => {
  const longBody = `A paragraph with encoded &#60;markup&#62;. ${'long copy '.repeat(40)}`;
  const source = {
    id: 'fallback',
    slug: 'fallback-copy',
    title: 'Fallback &amp; title',
    html: `<template><h1>Hidden</h1></template><p>${longBody}</p><svg><text>also hidden</text></svg>`,
    editorial_type: 'did_you_know',
    topics: 'home',
  };
  const { env } = fakeEnvironment([source]);
  const response = await worker.fetch(v2Request(requestBody({
    slots: [{ ...baseSlot, budget: 'compact-v1' }],
  })), env, {});
  const selected = (await response.json()).assignments.primary;

  assert.equal(selected.content.headline, 'Fallback & title');
  assert.ok(selected.content.headline.length <= 48);
  assert.ok(selected.content.body.length <= 110);
  assert.doesNotMatch(selected.content.body, /Hidden|also hidden|<p>|<svg>/);
});

test('v2 understands the existing iBamboo strong-heading templates without leaking chrome', async () => {
  const source = {
    id: 'legacy-template',
    slug: 'legacy-template-copy',
    title: 'Database title',
    html: '<aside><span>45</span><div><p>iBamboo field note</p><strong>Lucky bamboo is a look-alike</strong><span>Lucky bamboo is a dracaena; the plants are not closely related.</span></div><b>竹</b></aside>',
    editorial_type: 'did_you_know',
    topics: 'home',
  };
  const { env } = fakeEnvironment([source]);
  const response = await worker.fetch(v2Request(), env, {});
  const copy = (await response.json()).assignments.primary.content;

  assert.deepEqual(copy, {
    headline: 'Lucky bamboo is a look-alike',
    body: 'Lucky bamboo is a dracaena; the plants are not closely related.',
  });
});

test('v2 returns an empty deck when published inventory cannot fill a request', async () => {
  const { env, counted } = fakeEnvironment([
    { ...inventory[0], status: 'draft' },
    { ...inventory[2], editorial_type: 'fun_fact' },
  ]);
  const response = await worker.fetch(v2Request(), env, {});

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).assignments, {});
  assert.deepEqual(counted, []);
});

test('v2 rejects malformed contracts, slots, exclusions, and methods', async () => {
  const { env } = fakeEnvironment(inventory);
  const malformed = [
    requestBody({ contract: '1.0' }),
    requestBody({ page_view_id: '' }),
    requestBody({ repeat_policy: 'allow' }),
    requestBody({ exclude_slugs: ['context-one', 'context-one'] }),
    requestBody({ slots: [] }),
    requestBody({ slots: [baseSlot, { ...baseSlot }] }),
    requestBody({ slots: Array.from({ length: 9 }, (_, index) => ({ ...baseSlot, id: `slot-${index}` })) }),
    requestBody({ slots: [{ ...baseSlot, role: 'banner' }] }),
    requestBody({ slots: [{ ...baseSlot, budget: 'tiny-v1' }] }),
    requestBody({ slots: [{ ...baseSlot, container: { width: 0, height: 100 } }] }),
    requestBody({ slots: [{ ...baseSlot, container: { width: 100, height: 100.5 } }] }),
    requestBody({ slots: [{ ...baseSlot, topics: ['HOME'] }] }),
    requestBody({ slots: [{ ...baseSlot, unexpected: true }] }),
    requestBody({ unexpected: true }),
  ];
  for (const data of malformed) {
    const response = await worker.fetch(v2Request(data), env, {});
    assert.equal(response.status, 400, JSON.stringify(data));
  }
  assert.equal((await worker.fetch(v2Request(undefined, 'GET'), env, {})).status, 405);
  assert.equal((await worker.fetch(new Request('https://conbal.us/v2/b/short/sample', { method: 'POST' }), env, {})).status, 404);
});

test('v2 permits the JSON POST CORS preflight used by host sites', async () => {
  const { env } = fakeEnvironment();
  const response = await worker.fetch(new Request(`https://conbal.us/v2/b/${siteKey}/sample`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://ibamboo.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  }), env, {});

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.match(response.headers.get('access-control-allow-headers'), /content-type/i);
});

test('v1 explicit-slug delivery remains byte-for-byte compatible', async () => {
  const source = inventory[0];
  const { env } = fakeEnvironment([source]);
  const response = await worker.fetch(new Request(`https://conbal.us/b/${siteKey}/${source.slug}`), env, {});

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    [source.slug]: { html: source.html, css: '.owner{}', size: 'responsive' },
  });
});
