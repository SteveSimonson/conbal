import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import worker from '../workers/site.js';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

function env() {
  return {
    ASSETS: {
      async fetch() {
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      },
    },
  };
}

test('homepage raw HTML shows example copy instead of a loading placeholder', async () => {
  const homepage = await read('public/index.html');
  assert.equal((homepage.match(/Loading live balloon/g) || []).length, 0);
  assert.match(homepage, /data-conbal="announcement-bar"[^>]*>[\s\S]*Launch a new offer without rebuilding the page\./);
  assert.match(homepage, /data-conbal="promotion-card"[^>]*>[\s\S]*Make the message move\./);
  assert.match(homepage, /data-conbal="promotion-card"[^>]*>[\s\S]*Publish the moment\. Keep the page\./);
  assert.match(homepage, /data-conbal="signup-banner"[^>]*>[\s\S]*Fresh ideas\. Same page\./);
  assert.match(homepage, /<a class="nav-link" href="\/admin\/login\.html">Sign in<\/a>/);
  assert.match(homepage, /<a class="button" href="\/admin\/login\.html">Enter the room ↗<\/a>/);
  assert.match(homepage, /<a class="button" href="\/admin\/login\.html">Create a content system<\/a>/);
  assert.match(homepage, /<a class="button" href="\/admin\/login\.html">Start creating with Conbal ↗<\/a>/);
  assert.equal((homepage.match(/<h1\b/g) || []).length, 1);
  assert.ok((homepage.match(/<h2\b/g) || []).length >= 3);
  assert.match(homepage, /alt="A content balloon concept board with notes and a bold red mark"/);
  assert.match(homepage, /script\.src = '\/embed\.js'/);
});

test('worker serves sitemap.xml as XML for the public pages', async () => {
  const head = await worker.fetch(new Request('https://conbal.us/sitemap.xml', { method: 'HEAD' }), env(), {});
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type') || '', /xml/i);
  assert.equal(await head.text(), '');

  const response = await worker.fetch(new Request('https://conbal.us/sitemap.xml'), env(), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /xml/i);
  const body = await response.text();
  assert.match(body, /<loc>https:\/\/conbal\.us\/<\/loc>/);
  assert.match(body, /<loc>https:\/\/conbal\.us\/privacy<\/loc>/);
  assert.equal(body, await read('public/sitemap.xml'));
});

test('worker serves robots.txt with a user-agent rule and sitemap', async () => {
  const response = await worker.fetch(new Request('https://conbal.us/robots.txt'), env(), {});
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /^User-agent: \*$/m);
  assert.match(body, /^Allow: \/$/m);
  assert.match(body, /^Sitemap: https:\/\/conbal\.us\/sitemap\.xml$/m);
  assert.equal(body, await read('public/robots.txt'));
});
