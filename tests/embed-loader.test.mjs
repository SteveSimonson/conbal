import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/embed.js', import.meta.url), 'utf8');

function slot({ size, slug = 'fact' } = {}) {
  const dataset = { conbalSite: 'ABCDEFGHIJKL', conbal: slug };
  if (size !== undefined) dataset.size = size;
  return { dataset, style: {}, innerHTML: '<p>host placeholder</p>' };
}

function execute(slots, fetch) {
  const script = { src: 'https://conbal.us/embed.js' };
  const document = {
    baseURI: 'https://host.example/page',
    currentScript: script,
    scripts: [script],
    readyState: 'complete',
    querySelectorAll: () => slots,
  };
  vm.runInNewContext(source, { document, fetch, URL });
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('embed slots remain collapsed while delivery is pending', async () => {
  const target = slot({ size: '300x250' });
  let release;
  execute([target], () => new Promise(resolve => { release = resolve; }));

  assert.equal(target.style.display, 'none');
  assert.equal(target.style.width, '');
  assert.equal(target.style.height, '');
  assert.equal(target.innerHTML, '');

  release({ ok: true, json: async () => ({ fact: { size: '300x250', html: '<p>Fact</p>', css: '' } }) });
  await flush();
  assert.equal(target.style.display, 'block');
  assert.equal(target.style.width, '300px');
  assert.equal(target.style.height, '250px');
});

test('responsive delivery receives the container-safe style contract', async () => {
  const target = slot({ size: 'responsive' });
  execute([target], async () => ({
    ok: true,
    json: async () => ({ fact: { size: 'responsive', html: '<p>Fluid fact</p>', css: '.fact{}' } }),
  }));
  await flush();

  assert.equal(target.style.display, 'block');
  assert.equal(target.style.width, '100%');
  assert.equal(target.style.maxWidth, '100%');
  assert.equal(target.style.height, 'auto');
  assert.equal(target.style.overflow, 'clip');
  assert.equal(target.style.isolation, 'isolate');
  assert.match(target.innerHTML, /Fluid fact/);
});

test('missing content, invalid sizes, and size mismatches fail closed', async () => {
  const missing = slot({ size: 'responsive', slug: 'missing' });
  const mismatch = slot({ size: '300x250', slug: 'mismatch' });
  const invalid = slot({ size: '640x480', slug: 'invalid' });
  execute([missing, mismatch, invalid], async () => ({
    ok: true,
    json: async () => ({
      mismatch: { size: '336x280', html: '<p>Wrong dimensions</p>', css: '' },
      invalid: { size: '640x480', html: '<p>Unknown dimensions</p>', css: '' },
    }),
  }));
  await flush();

  for (const target of [missing, mismatch, invalid]) {
    assert.equal(target.style.display, 'none');
    assert.equal(target.style.width, '');
    assert.equal(target.style.height, '');
    assert.equal(target.innerHTML, '');
  }
});

test('delivery errors leave every affected slot collapsed', async () => {
  const first = slot({ size: 'responsive', slug: 'first' });
  const second = slot({ size: '728x90', slug: 'second' });
  execute([first, second], async () => { throw new Error('network unavailable'); });
  await flush();

  for (const target of [first, second]) {
    assert.equal(target.style.display, 'none');
    assert.equal(target.style.width, '');
    assert.equal(target.style.height, '');
    assert.equal(target.innerHTML, '');
  }
});

test('legacy slots without data-size adopt a valid payload size', async () => {
  const target = slot();
  execute([target], async () => ({
    ok: true,
    json: async () => ({ fact: { size: '320x100', html: '<p>Legacy fact</p>', css: '' } }),
  }));
  await flush();

  assert.equal(target.style.display, 'block');
  assert.equal(target.style.width, '320px');
  assert.equal(target.style.height, '100px');
});
