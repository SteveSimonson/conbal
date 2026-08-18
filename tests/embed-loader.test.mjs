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
    this.className = '';
    this.computedStyle = { display: 'block', columnCount: '1' };
    this.rectWidth = 800;
    this.listeners = {};
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
  matches(selector) {
    if (selector.includes('[data-card]') && this.hasAttribute('data-card')) return true;
    if (selector.includes('[data-product]') && this.hasAttribute('data-product')) return true;
    return false;
  }
  querySelector() { return null; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return descendants;
    if (selector === 'section, article') return descendants.filter(node => node.tagName === 'SECTION' || node.tagName === 'ARTICLE');
    if (selector === 'h2, h3') return descendants.filter(node => node.tagName === 'H2' || node.tagName === 'H3');
    if (selector === 'p') return descendants.filter(node => node.tagName === 'P');
    return [];
  }
  getBoundingClientRect() { return { width: this.rectWidth, height: 100 }; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatch(name) { for (const callback of this.listeners[name] || []) callback(); }
  get nextSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }
}

function autoDocument({ wordRepeats = 360, sectionCount = 4, styleOutcome = 'load', topics = '', maxSlots = '' } = {}) {
  const body = new FakeElement('body');
  const main = new FakeElement('main', 'Useful page text '.repeat(wordRepeats));
  const heading = new FakeElement('h1', 'Bamboo home guide');
  const sections = Array.from({ length: sectionCount }, (_, offset) => offset + 1).map(index => {
    const section = new FakeElement('section', `Section ${index} ${'relevant detail '.repeat(30)}`);
    section.append(new FakeElement('h2', `Section ${index}`));
    return section;
  });
  main.append(heading, ...sections);
  body.append(main);
  const head = new FakeElement('head');
  const all = [body, main, heading, ...sections, ...sections.flatMap(section => section.children)];
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  const script = {
    src: 'https://conbal.us/embed.js',
    dataset: { conbalSite: 'ABCDEFGHIJKL', conbalAuto: 'true', ...(topics ? { conbalTopics: topics } : {}), ...(maxSlots ? { conbalMaxSlots: String(maxSlots) } : {}) },
    hasAttribute: name => name === 'data-conbal-auto',
  };
  const document = {
    baseURI: 'https://host.example/page',
    currentScript: script,
    scripts: [script],
    readyState: 'complete',
    body,
    head,
    documentElement: { clientWidth: 1024 },
    querySelector(selector) {
      if (selector.includes('main')) return main;
      if (selector === 'h1' || selector === 'title') return heading;
      if (selector === 'article' || selector.startsWith('meta[') || selector.startsWith('link[')) return null;
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
  const originalAppend = head.append.bind(head);
  head.appendChild = node => {
    originalAppend(node);
    all.push(node);
    if (node.tagName === 'LINK' && styleOutcome) queueMicrotask(() => node.dispatch(styleOutcome));
  };
  return { document, body, main, heading, all, head };
}

function immediateTimer(callback, delay = 0) {
  if (delay >= 5000) return 0;
  callback();
  return 0;
}

async function automaticRequest(options) {
  const { document } = autoDocument(options);
  const requests = [];
  const scriptContext = {
    document,
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ assignments: {} }) };
    },
    URL,
    location: { href: 'https://host.example/page', pathname: '/guide' },
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener() {} },
    setTimeout: immediateTimer,
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
  };
  vm.runInNewContext(source, scriptContext);
  await flush();
  return requests[0]?.body;
}

async function automaticSlotCount(options) {
  return (await automaticRequest(options))?.slots.length || 0;
}

test('automatic slot count follows page capacity and available anchors', async () => {
  assert.equal(await automaticSlotCount({ wordRepeats: 60, sectionCount: 6 }), 1);
  assert.equal(await automaticSlotCount({ wordRepeats: 180, sectionCount: 6 }), 2);
  assert.equal(await automaticSlotCount({ wordRepeats: 360, sectionCount: 1 }), 2);
  assert.equal(await automaticSlotCount({ wordRepeats: 1500, sectionCount: 8 }), 4);
  assert.equal(await automaticSlotCount({ wordRepeats: 1500, sectionCount: 8, maxSlots: 2 }), 2);
});

test('automatic requests can use site-level topics instead of route-specific topics', async () => {
  const request = await automaticRequest({ topics: 'Bamboo, Home, bamboo, INVALID TOPIC' });

  assert.deepEqual(Array.from(request.slots[0].topics), ['bamboo', 'home', 'general']);
  assert.ok(request.slots.every(item => JSON.stringify(item.topics) === JSON.stringify(request.slots[0].topics)));
});

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
          'auto-2': { assignment_id: 'v2_two', role: 'aside-note', budget: 'compact-v1', editorial_type: 'care_tip', slug: 'fresh-two', content: { headline: 'A care note', body: 'A care body.' } },
          'auto-3': { assignment_id: 'v2_three', role: 'section-break', budget: 'compact-v1', editorial_type: 'fun_fact', slug: 'fresh-three', content: { headline: 'A fun fact', body: 'A fun body.' } },
        } }),
      };
    },
    URL,
    location: { href: 'https://host.example/page', pathname: '/guide' },
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener() {} },
    getComputedStyle: node => node.computedStyle,
    setTimeout: immediateTimer,
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

test('automatic placement breaks out of cards and grids before inserting a slot', async () => {
  const { document, main } = autoDocument({ sectionCount: 0 });
  const section = new FakeElement('div', 'Editorial section');
  const grid = new FakeElement('div', 'Feature grid');
  grid.className = 'feature-grid';
  grid.computedStyle.display = 'grid';
  const card = new FakeElement('div', 'Feature card');
  card.className = 'feature-card';
  card.setAttribute('data-card', '');
  const paragraph = new FakeElement('p', 'Useful editorial detail '.repeat(20));
  card.append(paragraph);
  grid.append(card);
  section.append(grid);
  main.append(section);
  const context = {
    document,
    fetch: async () => ({ ok: true, json: async () => ({ assignments: {
      'auto-1': { role: 'inline-note', budget: 'standard-v1', editorial_type: 'did_you_know', slug: 'safe-boundary', content: { headline: 'A safe boundary', body: 'This note belongs between layout components.' } },
    } }) }),
    URL,
    location: { href: 'https://host.example/guide', pathname: '/guide' },
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener() {} },
    getComputedStyle: node => node.computedStyle,
    setTimeout: immediateTimer,
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
  };
  vm.runInNewContext(source, context);
  await flush();

  const inserted = section.children.find(node => node.dataset?.conbalAutoSlot !== undefined);
  assert.ok(inserted, 'slot should be inserted at the safe section boundary');
  assert.equal(inserted.parentElement, section);
  assert.equal(card.children.some(node => node.dataset?.conbalAutoSlot !== undefined), false);
  assert.equal(grid.children.some(node => node.dataset?.conbalAutoSlot !== undefined), false);
});

test('automatic content stays hidden until the scoped stylesheet loads', async () => {
  const { document, main, all } = autoDocument({ styleOutcome: '' });
  const requests = [];
  const context = {
    document,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ assignments: {
      'auto-1': { role: 'inline-note', budget: 'standard-v1', editorial_type: 'did_you_know', slug: 'styled-note', content: { headline: 'Styled only', body: 'This copy must never flash without the Conbal stylesheet.' } },
      } }) };
    },
    URL,
    location: { href: 'https://host.example/guide', pathname: '/guide' },
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener() {} },
    getComputedStyle: node => node.computedStyle,
    setTimeout: immediateTimer,
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
  };
  vm.runInNewContext(source, context);
  await flush();

  const slot = main.querySelectorAll('*').find(node => node.dataset?.conbalSlotId === 'auto-1');
  const stylesheet = all.find(node => node.tagName === 'LINK');
  assert.ok(slot);
  assert.equal(slot.hidden, true);
  assert.equal(slot.dataset.conbalState, 'loading');
  assert.equal(slot.children.length, 0);

  stylesheet.dispatch('load');
  await flush();
  await flush();
  assert.equal(slot.hidden, false);
  assert.equal(slot.dataset.conbalState, 'ready');
  assert.equal(slot.children[0].tagName, 'ASIDE');
  assert.equal(slot.children[0].getAttribute('aria-labelledby'), slot.children[0].children[0].children[1].id);
});

test('stylesheet failures and over-budget responses remove automatic slots', async () => {
  const styleFailure = autoDocument({ styleOutcome: '' });
  const styleContext = {
    document: styleFailure.document,
    fetch: async () => ({ ok: true, json: async () => ({ assignments: {
      'auto-1': { role: 'inline-note', budget: 'standard-v1', editorial_type: 'did_you_know', slug: 'style-failure', content: { headline: 'Hidden', body: 'This content should disappear with its failed stylesheet.' } },
    } }) }),
    URL,
    location: { href: 'https://host.example/guide', pathname: '/guide' },
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener() {} },
    getComputedStyle: node => node.computedStyle,
    setTimeout: immediateTimer,
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
  };
  vm.runInNewContext(source, styleContext);
  await flush();
  styleFailure.all.find(node => node.tagName === 'LINK').dispatch('error');
  await flush();
  assert.equal(styleFailure.document.querySelectorAll('[data-conbal-auto-slot]').length, 0);

  const overBudget = autoDocument();
  vm.runInNewContext(source, {
    ...styleContext,
    document: overBudget.document,
    fetch: async () => ({ ok: true, json: async () => ({ assignments: {
      'auto-1': { role: 'inline-note', budget: 'standard-v1', editorial_type: 'did_you_know', slug: 'oversized', content: { headline: 'x'.repeat(73), body: 'A valid body.' } },
    } }) }),
  });
  await flush();
  assert.equal(overBudget.document.querySelectorAll('[data-conbal-auto-slot]').length, 0);
});

test('a stalled automatic stylesheet fails closed after its deadline', async () => {
  const { document } = autoDocument({ styleOutcome: '' });
  let styleTimeout;
  const context = {
    document,
    fetch: async () => ({ ok: true, json: async () => ({ assignments: {
      'auto-1': { role: 'inline-note', budget: 'standard-v1', editorial_type: 'did_you_know', slug: 'waiting-style', content: { headline: 'Still hidden', body: 'This response must not appear without its stylesheet.' } },
    } }) }),
    URL,
    location: { href: 'https://host.example/guide', pathname: '/guide' },
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener() {} },
    getComputedStyle: node => node.computedStyle,
    setTimeout(callback, delay = 0) {
      if (delay === 5000) { styleTimeout = callback; return 50; }
      if (delay >= 8000) return 80;
      callback();
      return 1;
    },
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
  };
  vm.runInNewContext(source, context);
  await flush();
  assert.ok(document.querySelectorAll('[data-conbal-auto-slot]').every(slot => slot.hidden));
  styleTimeout();
  await flush();
  assert.equal(document.querySelectorAll('[data-conbal-auto-slot]').length, 0);
});

test('a timed-out automatic request removes its hidden placeholders', async () => {
  const { document } = autoDocument();
  let timeout;
  const context = {
    document,
    fetch: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    URL,
    location: { href: 'https://host.example/guide', pathname: '/guide' },
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener() {} },
    getComputedStyle: node => node.computedStyle,
    setTimeout(callback, delay = 0) {
      if (delay === 8000) { timeout = callback; return 99; }
      if (delay >= 5000) return 98;
      callback();
      return 1;
    },
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
  };
  vm.runInNewContext(source, context);
  await flush();
  assert.ok(document.querySelectorAll('[data-conbal-auto-slot]').every(slot => slot.hidden));
  timeout();
  await flush();
  assert.equal(document.querySelectorAll('[data-conbal-auto-slot]').length, 0);
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
    'auto-2': { role: 'aside-note', budget: 'compact-v1', editorial_type: 'care_tip', slug: 'fresh-two', content: { headline: 'A care note', body: 'A care body.' } },
    'auto-3': { role: 'section-break', budget: 'compact-v1', editorial_type: 'fun_fact', slug: 'fresh-three', content: { headline: 'A fun fact', body: 'A fun body.' } },
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
    setTimeout: (callback, delay = 0) => { if (delay >= 5000) return 0; timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
    getComputedStyle: node => node.computedStyle,
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
        'auto-2': { role: 'aside-note', budget: 'compact-v1', editorial_type: 'care_tip', slug: 'fresh-two', content: { headline: 'A care note', body: 'A care body.' } },
        'auto-3': { role: 'section-break', budget: 'compact-v1', editorial_type: 'fun_fact', slug: 'fresh-three', content: { headline: 'A fun fact', body: 'A fun body.' } },
      } }) };
    },
    URL,
    location,
    localStorage: { getItem: () => '[]', setItem: () => {} },
    history,
    window: { addEventListener() {} },
    setTimeout: (callback, delay = 0) => { if (delay >= 5000) return 0; timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    AbortController,
    crypto: { randomUUID: () => 'page-view-123' },
    getComputedStyle: node => node.computedStyle,
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
