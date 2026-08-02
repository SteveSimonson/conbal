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

class FakeElement {
  constructor(tagName, text = '') {
    this.tagName = tagName.toUpperCase();
    this.innerText = text;
    this.textContent = text;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.removed = false;
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  insertBefore(child, sibling) {
    child.parentElement = this;
    const index = this.children.indexOf(sibling);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }

  remove() {
    this.removed = true;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
  }

  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.children]);
    if (selector === 'section, article') return descendants.filter(node => node.tagName === 'SECTION' || node.tagName === 'ARTICLE');
    if (selector === 'h2, h3') return descendants.filter(node => node.tagName === 'H2' || node.tagName === 'H3');
    return [];
  }
  getBoundingClientRect() { return { width: 800, height: 100 }; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
}

function autoDocument() {
  const main = new FakeElement('main', 'Useful page text '.repeat(90));
  const heading = new FakeElement('h1', 'Bamboo home guide');
  const sections = [1, 2, 3, 4].map(index => {
    const section = new FakeElement('section', `Section ${index} ${'relevant detail '.repeat(30)}`);
    section.append(new FakeElement('h2', `Section ${index}`));
    return section;
  });
  main.append(heading, ...sections);
  const all = [main, heading, ...sections, ...sections.flatMap(section => section.children)];
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  const script = {
    src: 'https://conbal.us/embed.js',
    dataset: { conbalSite: 'ABCDEFGHIJKL', conbalAuto: 'true' },
    hasAttribute: name => name === 'data-conbal-auto',
  };
  const document = {
    baseURI: 'https://host.example/page',
    currentScript: script,
    scripts: [script],
    readyState: 'complete',
    body: main,
    head: { appendChild: node => all.push(node) },
    querySelector(selector) {
      if (selector.includes('main')) return main;
      if (selector === 'h1' || selector === 'title') return heading;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'section, article') return sections;
      if (selector === 'h2, h3') return sections.flatMap(section => section.children);
      if (selector === '[data-conbal-auto-slot]') return descendants(main).filter(node => node.dataset?.conbalAutoSlot !== undefined && !node.removed);
      if (selector === '[data-conbal][data-conbal-site]') return [];
      return [];
    },
    createElement: tagName => new FakeElement(tagName),
    getElementById: () => null,
  };
  return { document, main, heading, all };
}

test('one automatic script analyzes the page and renders a fresh structured deck', async () => {
  const { document, main, all } = autoDocument();
  const requests = [];
  const context = {
    document,
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () => ({ assignments: {
          'auto-1': { assignment_id: 'v2_one', role: 'inline-note', budget: 'standard-v1', editorial_type: 'did_you_know', slug: 'fresh-one', content: { headline: 'A useful fact', body: 'A useful body.' } },
          'auto-2': { assignment_id: 'v2_two', role: 'section-break', budget: 'compact-v1', editorial_type: 'care_tip', slug: 'fresh-two', content: { headline: 'A care note', body: 'A care body.' } },
          'auto-3': { assignment_id: 'v2_three', role: 'aside-note', budget: 'compact-v1', editorial_type: 'fun_fact', slug: 'fresh-three', content: { headline: 'A fun fact', body: 'A fun body.' } },
        } }),
      };
    },
    URL,
    location: { href: 'https://host.example/page', pathname: '/guide' },
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener() {} },
    setTimeout: callback => { callback(); return 0; },
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
  };
  vm.runInNewContext(source, context);
  await flush();

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/v2\/b\/ABCDEFGHIJKL\/sample$/);
  assert.equal(requests[0].body.contract, '2.0');
  assert.equal(requests[0].body.repeat_policy, 'omit');
  assert.ok(requests[0].body.slots.length >= 3);
  const stylesheet = all.find(node => node.rel === 'stylesheet');
  assert.equal(stylesheet?.href, 'https://conbal.us/embed.css');
  assert.ok(!all.some(node => node.tagName === 'STYLE'));
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  const rendered = descendants(main).filter(child => child.dataset?.conbalAutoSlot !== undefined && child.dataset.conbalState === 'ready');
  assert.equal(rendered.length, 3);
  const renderedText = descendants(main).map(child => child.textContent);
  assert.ok(renderedText.includes('Did you know?'));
  assert.ok(renderedText.includes('A useful fact'));
});

test('managed hosts keep explicit slots when the automatic flag is present', async () => {
  const target = slot({ size: 'responsive' });
  const script = {
    src: 'https://conbal.us/embed.js',
    dataset: { conbalSite: 'ABCDEFGHIJKL', conbalAuto: 'true' },
    hasAttribute: name => name === 'data-conbal-auto',
  };
  const document = {
    baseURI: 'https://host.example/page',
    currentScript: script,
    scripts: [script],
    readyState: 'complete',
    querySelector: selector => selector === '[data-conbal-managed="true"]' ? {} : null,
    querySelectorAll: () => [target],
  };
  const context = {
    document,
    fetch: async url => {
      assert.match(url, /\/b\/ABCDEFGHIJKL\/fact$/);
      return { ok: true, json: async () => ({ fact: { size: 'responsive', html: '<p>Managed fact</p>', css: '' } }) };
    },
    URL,
  };
  vm.runInNewContext(source, context);
  await flush();

  assert.equal(target.style.display, 'block');
  assert.match(target.innerHTML, /Managed fact/);
});

test('SPA navigation waits for replacement content before sampling again', async () => {
  const { document, main, heading } = autoDocument();
  const timers = [];
  const requests = [];
  const location = { href: 'https://host.example/guide', pathname: '/guide' };
  const history = { pushState() {}, replaceState() {} };
  const assignments = { assignments: {
    'auto-1': { role: 'inline-note', budget: 'standard-v1', editorial_type: 'did_you_know', slug: 'fresh-one', content: { headline: 'A useful fact', body: 'A useful body.' } },
    'auto-2': { role: 'section-break', budget: 'compact-v1', editorial_type: 'care_tip', slug: 'fresh-two', content: { headline: 'A care note', body: 'A care body.' } },
    'auto-3': { role: 'aside-note', budget: 'compact-v1', editorial_type: 'fun_fact', slug: 'fresh-three', content: { headline: 'A fun fact', body: 'A fun body.' } },
  } };
  const context = {
    document,
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => assignments };
    },
    URL,
    location,
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history,
    window: { addEventListener() {} },
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
  };
  vm.runInNewContext(source, context);
  const drain = async () => {
    const callback = timers.shift();
    assert.ok(callback, 'expected a scheduled automatic run');
    callback();
    await flush();
  };

  await drain();
  assert.equal(requests.length, 1);

  location.href = 'https://host.example/guide/next';
  location.pathname = '/guide/next';
  history.pushState();
  await drain();
  assert.equal(requests.length, 1, 'old DOM must not trigger a second request');

  heading.innerText = 'A different guide';
  heading.textContent = 'A different guide';
  main.innerText = 'New page content '.repeat(90);
  main.textContent = main.innerText;
  await drain();
  assert.equal(requests.length, 2);

  // Some routers commit the next view before they update the URL. The
  // persistent last-delivered signature must still treat this as a new page.
  heading.innerText = 'A pre-rendered guide';
  heading.textContent = 'A pre-rendered guide';
  main.innerText = 'Pre-rendered page content '.repeat(90);
  main.textContent = main.innerText;
  location.href = 'https://host.example/guide/prerendered';
  location.pathname = '/guide/prerendered';
  history.pushState();
  await drain();
  assert.equal(requests.length, 3);

  // Even a same-prefix route must eventually make a best-effort request
  // rather than leaving the new page permanently empty.
  location.href = 'https://host.example/guide/same-prefix';
  location.pathname = '/guide/same-prefix';
  history.pushState();
  for (let attempt = 0; attempt <= 8; attempt += 1) await drain();
  assert.equal(requests.length, 4);
});

test('empty initial shells update the remembered signature before later routes', async () => {
  const { document, main, heading } = autoDocument();
  main.innerText = 'Loading';
  main.textContent = 'Loading';
  heading.innerText = 'Loading';
  heading.textContent = 'Loading';
  const timers = [];
  const requests = [];
  const location = { href: 'https://host.example/loading', pathname: '/loading' };
  const history = { pushState() {}, replaceState() {} };
  const context = {
    document,
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ assignments: {
        'auto-1': { role: 'inline-note', budget: 'standard-v1', editorial_type: 'did_you_know', slug: 'fresh-one', content: { headline: 'A useful fact', body: 'A useful body.' } },
        'auto-2': { role: 'section-break', budget: 'compact-v1', editorial_type: 'care_tip', slug: 'fresh-two', content: { headline: 'A care note', body: 'A care body.' } },
        'auto-3': { role: 'aside-note', budget: 'compact-v1', editorial_type: 'fun_fact', slug: 'fresh-three', content: { headline: 'A fun fact', body: 'A fun body.' } },
      } }) };
    },
    URL,
    location,
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history,
    window: { addEventListener() {} },
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
  };
  vm.runInNewContext(source, context);
  const drain = async () => {
    const callback = timers.shift();
    assert.ok(callback, 'expected a scheduled automatic run');
    callback();
    await flush();
  };

  await drain();
  assert.equal(requests.length, 0);
  heading.innerText = 'Loaded guide';
  heading.textContent = 'Loaded guide';
  main.innerText = 'Loaded page content '.repeat(90);
  main.textContent = main.innerText;
  await drain();
  assert.equal(requests.length, 1);

  location.href = 'https://host.example/loaded/next';
  location.pathname = '/loaded/next';
  history.pushState();
  await drain();
  assert.equal(requests.length, 1, 'the loaded page should be treated as the outgoing page');
  heading.innerText = 'Next guide';
  heading.textContent = 'Next guide';
  main.innerText = 'Next page content '.repeat(90);
  main.textContent = main.innerText;
  await drain();
  assert.equal(requests.length, 2);
});
