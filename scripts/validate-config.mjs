import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const failures = [];
const allowPlaceholderBindings = process.env.CONBAL_ALLOW_PLACEHOLDER_BINDINGS === '1';
const requireMatch = (source, expression, description) => {
  if (!expression.test(source)) failures.push(description);
};

let wrangler;
try {
  wrangler = JSON.parse(await read('wrangler.jsonc'));
} catch (error) {
  failures.push(`wrangler.jsonc must be valid JSON: ${error.message}`);
}

if (wrangler) {
  if (wrangler.main !== 'workers/site.js') failures.push('wrangler.jsonc must use workers/site.js as main.');
  if (wrangler.d1_databases?.length !== 1 || !wrangler.d1_databases[0]?.database_id || (!allowPlaceholderBindings && wrangler.d1_databases[0].database_id.includes('REPLACE_WITH'))) {
    failures.push('Set the D1 database ID in wrangler.jsonc before deploying.');
  }
  if (wrangler.kv_namespaces?.length !== 1 || !wrangler.kv_namespaces[0]?.id || (!allowPlaceholderBindings && wrangler.kv_namespaces[0].id.includes('REPLACE_WITH'))) {
    failures.push('Set the KV namespace ID in wrangler.jsonc before deploying.');
  }
  if (!wrangler.assets?.run_worker_first?.includes('/api/*') || !wrangler.assets?.run_worker_first?.includes('/b/*') || !wrangler.assets?.run_worker_first?.includes('/v2/b/*')) {
    failures.push('Assets must route /api/*, /b/*, and /v2/b/* through the worker.');
  }
}

const schema = await read('schema.sql');
for (const [expression, description] of [
  [/CREATE TABLE users\b/i, 'schema.sql must create users.'],
  [/email TEXT UNIQUE NOT NULL/i, 'users.email must remain unique and required.'],
  [/CREATE TABLE sites\b/i, 'schema.sql must create sites.'],
  [/site_key TEXT UNIQUE NOT NULL/i, 'sites.site_key must remain unique and required.'],
  [/CREATE TABLE balloons\b/i, 'schema.sql must create balloons.'],
  [/editorial_type TEXT NOT NULL DEFAULT 'did_you_know'/i, 'balloons.editorial_type must default to did_you_know.'],
  [/topics TEXT NOT NULL DEFAULT 'general'/i, 'balloons.topics must default to general.'],
  [/UNIQUE\s*\(\s*site_id\s*,\s*slug\s*\)/i, 'balloons must enforce unique slugs per site.'],
  [/CREATE TABLE balloon_delivery_counts\b/i, 'schema.sql must create balloon delivery counters.'],
  [/delivery_count INTEGER NOT NULL DEFAULT 0/i, 'balloon delivery counts must default to zero.'],
  [/CREATE TABLE smart_delivery_items\b/i, 'schema.sql must create the smart-delivery index.'],
  [/CREATE INDEX idx_smart_delivery_lookup ON smart_delivery_items\(site_key, topic, editorial_type, balloon_id\)/i, 'smart-delivery lookups must use the bounded topic index.'],
  [/CREATE INDEX idx_sites_user ON sites\(user_id\)/i, 'schema.sql must index sites.user_id.'],
  [/CREATE INDEX idx_balloons_site ON balloons\(site_id\)/i, 'schema.sql must index balloons.site_id.'],
]) requireMatch(schema, expression, description);

let examples;
try {
  examples = JSON.parse(await read('examples/demo-balloons.json'));
} catch (error) {
  failures.push(`examples/demo-balloons.json must be valid JSON: ${error.message}`);
}

if (examples) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(examples.siteKey || '')) failures.push('The live example site key must be 12 URL-safe characters.');
  if (!Array.isArray(examples.balloons) || examples.balloons.length !== 3) failures.push('The live example manifest must contain exactly three balloons.');
  const slugs = new Set();
  for (const balloon of examples.balloons || []) {
    if (!/^[a-z0-9-]{1,80}$/.test(balloon.slug || '')) failures.push(`Invalid live example slug: ${balloon.slug || '(missing)'}.`);
    if (slugs.has(balloon.slug)) failures.push(`Duplicate live example slug: ${balloon.slug}.`);
    slugs.add(balloon.slug);
    if (!['responsive', '300x250', '336x280', '728x90', '160x600', '320x100'].includes(balloon.size)) failures.push(`Invalid live example size for ${balloon.slug}.`);
    if (!balloon.title || !balloon.html || typeof balloon.css !== 'string') failures.push(`Incomplete live example content for ${balloon.slug}.`);
  }
  const homepage = await read('public/index.html');
  if (![...slugs].every(slug => homepage.includes(`data-conbal=\"${slug}\"`))) failures.push('The homepage must embed every balloon in the live example manifest.');
  if (!homepage.includes(`data-conbal-site=\"${examples.siteKey}\"`)) failures.push('The homepage live example site key must match the manifest.');
}

if (failures.length) {
  console.error('Conbal configuration validation failed:\n' + failures.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Conbal configuration and schema contracts look valid.');
}
