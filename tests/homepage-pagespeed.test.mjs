import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import test from 'node:test';

const homepage = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/marketing.css', import.meta.url), 'utf8');

test('homepage ships raw-HTML crawl tags and a parseable JSON-LD block', () => {
  assert.match(homepage, /<link rel="canonical" href="https:\/\/conbal\.us\/">/);
  assert.match(homepage, /<meta name="description" content="[^"]+">/);
  assert.match(homepage, /<meta property="og:image" content="https:\/\/conbal\.us\/conbal-og\.jpg">/);
  assert.match(homepage, /<title>Conbal — put the right thought in the right place<\/title>/);
  const jsonLd = homepage.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(jsonLd, 'homepage JSON-LD is missing');
  const data = JSON.parse(jsonLd[1]);
  assert.equal(data['@type'], 'WebSite');
  assert.equal(data.url, 'https://conbal.us/');
});

test('homepage LCP image is preloaded WebP with dimensions and no async decode', () => {
  assert.match(homepage, /rel="preload" as="image"[^>]*conbal-hero-800\.webp/);
  assert.match(homepage, /srcset="\/conbal-hero-800\.webp 800w, \/conbal-hero-1280\.webp 1280w"/);
  assert.match(homepage, /<img src="\/conbal-hero\.jpg" width="1600" height="853"/);
  assert.doesNotMatch(homepage, /decoding\s*=\s*["']async["']/);
  assert.doesNotMatch(homepage, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test('homepage defers live balloon loading until idle or interaction', () => {
  assert.doesNotMatch(homepage, /<script src="\/embed\.js"/);
  assert.match(homepage, /requestIdleCallback/);
  assert.match(homepage, /script\.src = '\/embed\.js'/);
  assert.match(homepage, /data-conbal="announcement-bar"/);
});

test('above-the-fold styles do not hide the hero and self-host latin fonts', () => {
  assert.doesNotMatch(css, /@keyframes rise-in/);
  assert.doesNotMatch(css, /\.hero-art \{[^}]*opacity:\s*0/);
  assert.match(css, /url\("\/assets\/fonts\/fraunces-v38-latin\.woff2"\)/);
  assert.match(css, /url\("\/assets\/fonts\/manrope-v20-latin\.woff2"\)/);
});

test('optimized homepage image and font files are present', async () => {
  const files = [
    'public/conbal-hero-800.webp',
    'public/conbal-hero-1280.webp',
    'public/conbal-og.jpg',
    'public/assets/fonts/fraunces-v38-latin.woff2',
    'public/assets/fonts/manrope-v20-latin.woff2',
    'public/assets/fonts/dm-mono-v16-400-latin.woff2',
    'public/assets/fonts/dm-mono-v16-500-latin.woff2',
  ];
  await Promise.all(files.map(file => access(new URL(`../${file}`, import.meta.url))));
});
