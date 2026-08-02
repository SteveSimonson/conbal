import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../workers/site.js';

test('admin reindex retries a concurrent edit and never publishes its stale snapshot', async () => {
  const fields = ['slug', 'title', 'html', 'css', 'size', 'editorial_type', 'topics'];
  const site = { id: 'site-1', user_id: 'user-1', site_key: 'ABCDEFGHIJKL', name: 'iBamboo' };
  const balloon = {
    id: 'balloon-1', site_id: site.id, slug: 'bamboo-fact', title: 'Old title',
    html: '<h2>Old heading</h2><p>Old body with enough useful copy.</p>', css: '', size: 'responsive',
    editorial_type: 'did_you_know', topics: 'general', status: 'published',
  };
  const indexed = new Map();
  const kvWrites = [];
  let firstBatch = true;
  const matchesSnapshot = (args, offset) => (
    args[offset] === balloon.id &&
    args[offset + 1] === balloon.site_id &&
    fields.every((field, index) => args[offset + index + 2] === (balloon[field] ?? null))
  );
  const DB = {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.startsWith('SELECT * FROM sites')) return this.args[0] === site.id && this.args[1] === site.user_id ? site : null;
          if (sql.startsWith('SELECT * FROM balloons')) return this.args[0] === balloon.id && this.args[1] === balloon.site_id ? { ...balloon } : null;
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async all() {
          if (sql.startsWith('SELECT id FROM balloons')) return { results: [{ id: balloon.id }] };
          throw new Error(`Unexpected all query: ${sql}`);
        },
      };
    },
    async batch(statements) {
      if (firstBatch) {
        firstBatch = false;
        balloon.title = 'New title';
        balloon.html = '<h2>New heading</h2><p>New body with enough useful copy.</p>';
      }
      return statements.map(statement => {
        const insert = statement.sql.startsWith('INSERT INTO smart_delivery_items');
        const matches = matchesSnapshot(statement.args, insert ? 7 : 1);
        if (matches && insert) indexed.set(statement.args[4], { headline: statement.args[5], body: statement.args[6] });
        if (matches && !insert) indexed.clear();
        return { meta: { changes: matches ? 1 : 0 } };
      });
    },
  };
  const CONBAL_KV = {
    async get(key) { return key === 's:session' ? { id: site.user_id, email: 'owner@example.com' } : null; },
    async put(key) { kvWrites.push(key); },
  };
  const request = new Request('https://conbal.us/api/sites/site-1/balloons/reindex', {
    method: 'POST', headers: { cookie: 'conbal_session=session' },
  });
  const response = await worker.fetch(request, { DB, CONBAL_KV, ASSETS: { fetch: () => new Response('asset') } }, {});
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result, { indexed: 1, skipped: 0, total: 1 });
  assert.deepEqual(indexed.get('general'), { headline: 'New heading', body: 'New body with enough useful copy.' });
  assert.equal(kvWrites.some(key => key.startsWith('b:')), false);
});
