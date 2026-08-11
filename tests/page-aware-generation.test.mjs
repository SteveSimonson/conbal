import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../workers/site.js';

const user = { id: 'user-1', email: 'owner@example.com' };
const site = { id: 'site-1', user_id: user.id, name: 'Example', site_key: 'ABCDEFGHIJKL', origin_url: null };
const pageUrl = 'https://example.com/guide/bamboo';
const pageHtml = `<html><head><title>Bamboo guide</title><meta name="keywords" content="bamboo,material,home"></head><body><main><h1>How bamboo works at home</h1><h2>Material details</h2><p>${'Bamboo is a useful material with a long history of careful cultivation and practical design. '.repeat(35)}</p></main></body></html>`;

function environment({ key = null, origin_url = null, jobs = new Map(), balloons = [], items = [] } = {}) {
  const currentSite = { ...site, origin_url };
  const updates = [];
  const db = {
    prepare(sql) {
      const statement = { sql, args: [] };
      statement.bind = (...args) => { statement.args = args; return statement; };
      statement.first = async () => {
        if (sql.startsWith('SELECT * FROM sites WHERE id=?')) return statement.args[0] === currentSite.id ? currentSite : null;
        if (sql.startsWith('SELECT SUM(CASE WHEN status')) return { active: 0, recent: 0 };
        if (sql.startsWith('SELECT * FROM sites')) return statement.args[0] === currentSite.id && statement.args[1] === user.id ? currentSite : null;
        if (sql.startsWith('SELECT * FROM generation_jobs WHERE id=? AND user_id=?')) return jobs.get(statement.args[0])?.user_id === statement.args[1] ? jobs.get(statement.args[0]) : null;
        if (sql.startsWith('SELECT * FROM generation_jobs WHERE id=?')) return jobs.get(statement.args[0]) || null;
        throw new Error(`Unexpected first query: ${sql}`);
      };
      statement.all = async () => {
        if (sql.startsWith('SELECT gi.balloon_id')) return { results: items.map(item => ({ ...item })) };
        throw new Error(`Unexpected all query: ${sql}`);
      };
      statement.run = async () => {
        if (sql.startsWith('INSERT INTO generation_jobs')) {
          const [id, user_id, site_id, status, page_url, page_kind, page_title, page_fingerprint, requested_count, completed_count, profile_json, provider, model] = statement.args;
          jobs.set(id, { id, user_id, site_id, status, page_url, page_kind, page_title, page_fingerprint, requested_count, completed_count, profile_json, provider, model, error: null, created_at: 'now', completed_at: null });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE sites SET origin_url=')) { currentSite.origin_url = statement.args[0]; updates.push(['origin', statement.args]); return { meta: { changes: 1 } }; }
        if (sql.includes("SET status='running'")) { const job = jobs.get(statement.args[0]); if (job) job.status = 'running'; return { meta: { changes: 1 } }; }
        if (sql.includes("SET status='failed'")) { const job = jobs.get(statement.args[1]); if (job) { job.status = 'failed'; job.error = statement.args[0]; } return { meta: { changes: 1 } }; }
        throw new Error(`Unexpected run query: ${sql}`);
      };
      return statement;
    },
    async batch(statements) {
      return statements.map(statement => {
        if (statement.sql.startsWith('INSERT INTO generation_jobs')) {
          const [id, user_id, site_id, status, page_url, page_kind, page_title, page_fingerprint, requested_count, completed_count, profile_json, provider, model] = statement.args;
          jobs.set(id, { id, user_id, site_id, status, page_url, page_kind, page_title, page_fingerprint, requested_count, completed_count, profile_json, provider, model, error: null, created_at: 'now', completed_at: null });
        } else if (statement.sql.startsWith('INSERT INTO balloons')) {
          const [id, site_id, slug, title, html, css, size, editorial_type, topics, status] = statement.args;
          balloons.push({ id, site_id, slug, title, html, css, size, editorial_type, topics, status });
        } else if (statement.sql.startsWith('INSERT INTO generation_items')) {
          const [job_id, balloon_id, source_urls] = statement.args;
          items.push({ job_id, balloon_id, source_urls, slug: balloons.find(balloon => balloon.id === balloon_id)?.slug || '', title: balloons.find(balloon => balloon.id === balloon_id)?.title || '', status: 'draft' });
        } else if (statement.sql.includes("SET status='complete'")) {
          const job = jobs.get(statement.args[2]);
          if (job) { job.status = 'complete'; job.completed_count = statement.args[0]; job.model = statement.args[1]; job.completed_at = 'now'; }
        }
        return { meta: { changes: 1 } };
      });
    },
  };
  const values = new Map([['s:session', JSON.stringify(user)]]);
  return {
    OPENAI_API_KEY: key,
    DB: db,
    CONBAL_KV: {
      async get(name, type) { const value = values.get(name); return value == null ? null : type === 'json' ? JSON.parse(value) : value; },
      async put() {},
      async delete() {},
    },
    ASSETS: { fetch: () => new Response('asset') },
    jobs,
    balloons,
    items,
    updates,
  };
}

test('page profile is host-bound, readable-content aware, and returns a reviewable slot plan', async () => {
  const environment = environmentForPage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.equal(String(input), pageUrl);
    return new Response(pageHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  try {
    const response = await worker.fetch(new Request('https://conbal.us/api/sites/site-1/page-profile', { method: 'POST', headers: { cookie: 'conbal_session=session', 'content-type': 'application/json' }, body: JSON.stringify({ page_url: pageUrl }) }), environment, {});
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.profile.kind, 'article');
    assert.equal(result.profile.slots.length, 1);
    assert.equal(result.profile.slots[0].budget, 'standard-v1');
    assert.equal(result.profile.topics[0], 'article');
    assert.equal(environment.updates[0][0], 'origin');
  } finally { globalThis.fetch = originalFetch; }
});

test('page profile rejects private and cross-site URLs before fetching', async () => {
  const environment = environmentForPage({ origin_url: 'https://example.com' });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('should not fetch'); };
  try {
    const privateResponse = await worker.fetch(new Request('https://conbal.us/api/sites/site-1/page-profile', { method: 'POST', headers: { cookie: 'conbal_session=session', 'content-type': 'application/json' }, body: JSON.stringify({ page_url: 'http://127.0.0.1/admin' }) }), environment, {});
    assert.equal(privateResponse.status, 400);
    const foreignResponse = await worker.fetch(new Request('https://conbal.us/api/sites/site-1/page-profile', { method: 'POST', headers: { cookie: 'conbal_session=session', 'content-type': 'application/json' }, body: JSON.stringify({ page_url: 'https://other.example.net/page' }) }), environment, {});
    assert.equal(foreignResponse.status, 403);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('page profile samples oversized HTML within a bounded budget', async () => {
  const environment = environmentForPage();
  const originalFetch = globalThis.fetch;
  const oversizedHtml = pageHtml.replace('Bamboo guide', 'Large events guide').replace('</body>', `${' '.repeat(1100000)}</body>`);
  globalThis.fetch = async input => {
    assert.equal(String(input), pageUrl);
    return new Response(oversizedHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  try {
    const response = await worker.fetch(new Request('https://conbal.us/api/sites/site-1/page-profile', { method: 'POST', headers: { cookie: 'conbal_session=session', 'content-type': 'application/json' }, body: JSON.stringify({ page_url: pageUrl }) }), environment, {});
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.profile.truncated, true);
    assert.equal(result.profile.title, 'Large events guide');
    assert.equal(result.profile.slots.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('generation requires a server-side OpenAI key and never falls back to visitor delivery', async () => {
  const environment = environmentForPage({ key: null });
  const response = await worker.fetch(new Request('https://conbal.us/api/sites/site-1/generation-jobs', { method: 'POST', headers: { cookie: 'conbal_session=session', 'content-type': 'application/json' }, body: JSON.stringify({ page_url: pageUrl }) }), environment, {});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /OPENAI_API_KEY/);
});

test('generation stores validated results as drafts and exposes provenance after the job completes', async () => {
  const environment = environmentForPage({ key: 'test-key', jobs: new Map() });
  const pending = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input) === pageUrl) return new Response(pageHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (String(input) === 'https://api.openai.com/v1/responses') return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify({ items: [{ slot_id: 'auto-1', headline: 'A closer look at bamboo', body: 'Bamboo can be shaped into useful household pieces when its fibers are carefully selected and finished.', editorial_type: 'did_you_know', topics: ['page', 'bamboo'], source_urls: [pageUrl] }] }) }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`Unexpected fetch: ${input}`);
  };
  try {
    const response = await worker.fetch(new Request('https://conbal.us/api/sites/site-1/generation-jobs', { method: 'POST', headers: { cookie: 'conbal_session=session', 'content-type': 'application/json' }, body: JSON.stringify({ page_url: pageUrl }) }), environment, { waitUntil(promise) { pending.push(promise); } });
    const started = await response.json();
    assert.equal(response.status, 202);
    await Promise.all(pending);
    const jobResponse = await worker.fetch(new Request(`https://conbal.us/api/generation-jobs/${started.job_id}`, { headers: { cookie: 'conbal_session=session' } }), environment, {});
    const job = await jobResponse.json();
    assert.equal(job.status, 'complete');
    assert.equal(job.completed_count, 1);
    assert.equal(job.items.length, 1);
    assert.equal(job.items[0].status, 'draft');
    assert.deepEqual(job.items[0].source_urls, [pageUrl]);
    assert.equal(environment.balloons[0].status, 'draft');
    assert.match(environment.balloons[0].html, /A closer look at bamboo/);
  } finally { globalThis.fetch = originalFetch; }
});

function environmentForPage(options = {}) { return environment(options); }
