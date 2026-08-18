(() => {
  'use strict';

  const sizes = new Set(['responsive', '300x250', '336x280', '728x90', '160x600', '320x100']);
  const automaticRoles = {
    article: ['inline-note', 'aside-note', 'section-break'],
    page: ['section-break', 'inline-note', 'aside-note'],
    product: ['section-break', 'inline-note', 'aside-note'],
    shop: ['section-break', 'inline-note', 'aside-note'],
  };
  const editorialTypes = ['did_you_know', 'fun_fact', 'care_tip', 'design_note', 'material_myth', 'nature_note', 'culture_craft'];
  const budgetLimits = {
    'compact-v1': { headline: 48, body: 110 },
    'standard-v1': { headline: 72, body: 180 },
  };
  const labels = {
    did_you_know: 'Did you know?',
    fun_fact: 'Fun fact',
    care_tip: 'Care note',
    design_note: 'Design detail',
    material_myth: 'Material check',
    nature_note: 'From the source',
    culture_craft: 'Craft & culture',
  };
  const stopWords = new Set('a an and are as at be by for from how in is it of on or the this to with your you'.split(' '));
  const autoStyleTimeoutMs = 5000;
  const autoRequestTimeoutMs = 8000;
  const unsafeClassTerms = ['banner', 'card', 'carousel', 'columns', 'cta', 'feature', 'grid', 'hero', 'modal', 'panel', 'pricing', 'slider', 'testimonial', 'tile'];
  const unsafeParentTags = new Set(['ASIDE', 'BUTTON', 'DIALOG', 'FIELDSET', 'FIGURE', 'FOOTER', 'FORM', 'HEADER', 'LI', 'NAV', 'OL', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL']);
  let autoRun = 0;
  let autoController;
  let autoHeading = 0;
  let autoStylesPromise;

  function scriptElement() {
    return document.currentScript || [...document.scripts].find(item => /\/embed\.js(?:$|\?)/.test(item.src));
  }

  function scriptConfig() {
    const script = scriptElement();
    const origin = script ? new URL(script.src, document.baseURI).origin : 'https://conbal.us';
    const site = script?.dataset?.conbalSite || script?.getAttribute?.('data-conbal-site');
    const auto = script?.dataset?.conbalAuto === 'true' || script?.hasAttribute?.('data-conbal-auto');
    const topics = topicTokens(script?.dataset?.conbalTopics || script?.getAttribute?.('data-conbal-topics'));
    const requestedMax = Number(script?.dataset?.conbalMaxSlots || script?.getAttribute?.('data-conbal-max-slots'));
    const maxSlots = Number.isInteger(requestedMax) && requestedMax >= 1 && requestedMax <= 8 ? requestedMax : 4;
    return { origin: origin.replace(/\/$/, ''), site, auto, topics, maxSlots, script };
  }

  function collapse(slot) {
    slot.innerHTML = '';
    slot.style.display = 'none';
    slot.style.width = '';
    slot.style.maxWidth = '';
    slot.style.height = '';
    slot.style.overflow = '';
    slot.style.isolation = '';
    slot.removeAttribute?.('data-conbal-state');
  }

  function revealLegacy(slot, balloon, size) {
    slot.innerHTML = `<style>${balloon.css || ''}</style>${balloon.html}`;
    slot.style.display = 'block';
    slot.style.overflow = 'clip';
    slot.style.isolation = 'isolate';
    if (size === 'responsive') {
      slot.style.width = '100%';
      slot.style.maxWidth = '100%';
      slot.style.height = 'auto';
      return;
    }
    const [width, height] = size.split('x');
    slot.style.width = `${width}px`;
    slot.style.maxWidth = '';
    slot.style.height = `${height}px`;
  }

  function renderLegacy(slot, balloon) {
    const requestedSize = slot.dataset.size;
    const payloadSize = balloon?.size;
    const validRequest = requestedSize === undefined || requestedSize === '' || sizes.has(requestedSize);
    const validPayload = sizes.has(payloadSize) && typeof balloon?.html === 'string';
    if (!validRequest || !validPayload || (requestedSize && requestedSize !== payloadSize)) {
      collapse(slot);
      return;
    }
    revealLegacy(slot, balloon, requestedSize || payloadSize);
  }

  function renderLegacySlots(origin) {
    const slots = [...document.querySelectorAll('[data-conbal][data-conbal-site]')];
    slots.forEach(collapse);
    const groups = slots.reduce((all, slot) => {
      (all[slot.dataset.conbalSite] ||= []).push(slot);
      return all;
    }, {});
    Object.entries(groups).forEach(([site, items]) => {
      const slugs = [...new Set(items.map(item => item.dataset.conbal).filter(Boolean))];
      if (!slugs.length) return;
      fetch(`${origin}/b/${encodeURIComponent(site)}/${slugs.join(',')}`, { mode: 'cors', cache: 'no-store' })
        .then(response => response.ok ? response.json() : {})
        .then(payloads => items.forEach(slot => renderLegacy(slot, payloads[slot.dataset.conbal])))
        .catch(() => items.forEach(collapse));
    });
  }

  function textOf(node) {
    return String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function topicTokens(value) {
    if (typeof value !== 'string') return [];
    return [...new Set(value.toLowerCase().split(',').map(item => item.trim()).filter(item => /^[a-z0-9-]{1,48}$/.test(item)))].slice(0, 7);
  }

  function excluded(node) {
    return Boolean(node.closest('header, nav, footer, form, dialog, aside, [data-conbal-ignore], [data-conbal-auto-slot]'));
  }

  function visible(node) {
    if (!node || excluded(node)) return false;
    const rect = node.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  }

  function pageRoot() {
    const main = document.querySelector('main, [role="main"]');
    if (!main) return document.querySelector('article') || document.body;
    const articles = [...main.querySelectorAll('article')];
    if (articles.length === 1) {
      const articleWords = textOf(articles[0]).split(/\s+/).filter(Boolean).length;
      const mainWords = textOf(main).split(/\s+/).filter(Boolean).length;
      if (articleWords >= 180 && articleWords >= mainWords * 0.6) return articles[0];
    }
    return main;
  }

  function contentSignature() {
    const root = pageRoot();
    const heading = document.querySelector('h1');
    const semantic = [...root.querySelectorAll('h2, h3, p, li')]
      .filter(node => !node.closest?.('[data-conbal-auto-slot]'))
      .map(textOf)
      .filter(Boolean)
      .join(' ');
    return `${textOf(heading).slice(0, 160)}|${(semantic || textOf(root)).slice(0, 640)}`;
  }

  function pageKind(root) {
    const path = location.pathname.toLowerCase();
    if (/checkout|cart|account|admin|login/.test(path)) return 'blocked';
    if (/product|item|p\//.test(path) || root.querySelector('[itemtype*="Product"], [data-product], [data-product-page]')) return 'product';
    if (/blog|article|story|guide|news/.test(path) || root.querySelector('article')) return 'article';
    if (/shop|collection|category|search/.test(path)) return 'shop';
    return 'page';
  }

  function tokenTopics(root, kind, configuredTopics) {
    if (configuredTopics.length) return [...new Set([...configuredTopics, 'general'])].slice(0, 8);
    const metaTopics = topicTokens(document.querySelector('meta[name="conbal:topics"]')?.getAttribute('content'));
    if (metaTopics.length) return [...new Set([...metaTopics, 'general'])].slice(0, 8);
    const title = document.querySelector('h1') || document.querySelector('title');
    const meta = document.querySelector('meta[name="keywords"], meta[property="article:section"]');
    const source = `${textOf(title)} ${meta?.getAttribute('content') || ''} ${location.pathname}`.toLowerCase();
    const words = source.match(/[a-z][a-z0-9-]{2,47}/g) || [];
    const topics = [];
    for (const word of words) {
      if (stopWords.has(word) || topics.includes(word)) continue;
      topics.push(word);
      if (topics.length === 5) break;
    }
    return [...new Set([kind, ...topics, 'general'])].slice(0, 8);
  }

  function unsafeClassName(node) {
    const value = typeof node?.className === 'string' ? node.className.toLowerCase() : '';
    return unsafeClassTerms.some(term => value.includes(term));
  }

  function unsafePlacementNode(node) {
    if (!node) return true;
    if (unsafeParentTags.has(node.tagName) || unsafeClassName(node)) return true;
    if (node.hasAttribute?.('data-conbal-ignore') || node.hasAttribute?.('data-conbal-auto-slot')) return true;
    const role = node.getAttribute?.('role');
    if (role === 'list' || role === 'listitem') return true;
    if (node.matches?.('[data-card], [data-product], [data-product-card], [itemtype*="Product"], [aria-modal="true"]')) return true;
    return false;
  }

  function layoutStyle(node) {
    try { return globalThis.getComputedStyle?.(node) || null; } catch { return null; }
  }

  function narrowPlacementParent(node) {
    const rect = node?.getBoundingClientRect?.();
    if (!rect?.width) return false;
    const viewport = document.documentElement?.clientWidth || globalThis.innerWidth || rect.width;
    const minimum = Math.min(360, Math.max(280, viewport - 32));
    return rect.width < minimum;
  }

  function unsafePlacementParent(node) {
    if (unsafePlacementNode(node) || narrowPlacementParent(node)) return true;
    const style = layoutStyle(node);
    const display = String(style?.display || '').toLowerCase();
    if (display.includes('flex')) {
      const direction = String(style?.flexDirection || 'row').toLowerCase();
      const wrap = String(style?.flexWrap || 'nowrap').toLowerCase();
      if (direction !== 'column' || wrap !== 'nowrap') return true;
    }
    if (display.includes('grid')) {
      const columns = String(style?.gridTemplateColumns || '').trim().toLowerCase();
      // Computed styles normally resolve each grid track to one whitespace-
      // separated value. Anything more complex fails closed as multi-column.
      const oneColumn = !columns || columns === 'none' || (!columns.startsWith('repeat(') && !/\s/.test(columns));
      if (!oneColumn) return true;
    }
    if (display === 'contents') return true;
    const columns = Number.parseInt(style?.columnCount || '1', 10);
    return Number.isFinite(columns) && columns > 1;
  }

  function placementFor(node, root) {
    let anchor = node;
    let parent = anchor?.parentElement;
    // The semantic page root is a hard placement boundary. Climbing beyond it
    // can move an insertion outside a React/Vue app shell and below its footer.
    while (parent && parent !== root && unsafePlacementParent(parent)) {
      anchor = parent;
      parent = anchor.parentElement;
    }
    if (!parent || unsafePlacementParent(parent)) return null;
    return { anchor, parent };
  }

  function pageSlots(root, kind, configuredTopics, maxSlots) {
    const words = textOf(root).split(/\s+/).filter(Boolean).length;
    if (words < 180 || kind === 'blocked') return [];
    // The page determines its own editorial capacity. Start with one useful
    // insertion, add another roughly every 360 words beyond the first 180,
    // and let the available semantic anchors constrain the result. Eight is
    // only a hard abuse/readability ceiling inherited from the v2 contract;
    // there is no arbitrary minimum of three.
    const wordCapacity = 1 + Math.floor(Math.max(0, words - 180) / 360);
    const desired = Math.min(maxSlots, wordCapacity);
    const sections = [...root.querySelectorAll('section, article')]
      .filter(node => visible(node) && textOf(node).length >= 80 && !node.parentElement?.closest('section, article'));
    const headings = [...root.querySelectorAll('h2, h3')]
      .filter(visible)
      .filter(node => textOf(node).length >= 8)
      .filter(node => !node.closest('section, article'));
    const candidates = [...new Set([...sections, ...headings])];
    if (candidates.length < desired) {
      const paragraphs = [...root.querySelectorAll('p')]
        .filter(node => visible(node) && textOf(node).length >= 80);
      candidates.push(...paragraphs.filter(node => !candidates.includes(node)));
    }
    const placements = [];
    const placementAnchors = new Set();
    for (const candidate of candidates) {
      const placement = placementFor(candidate, root);
      if (!placement || placementAnchors.has(placement.anchor)) continue;
      placementAnchors.add(placement.anchor);
      placements.push(placement);
    }
    if (!placements.length) return [];
    const target = Math.min(desired, placements.length);
    const picked = [];
    for (let index = 0; index < Math.min(target, placements.length); index += 1) {
      const placement = placements[Math.round((index * (placements.length - 1)) / Math.max(1, target - 1))];
      if (placement && !picked.includes(placement)) picked.push(placement);
    }
    for (const placement of placements) {
      if (picked.length >= target) break;
      if (!picked.includes(placement)) picked.push(placement);
    }
    const topics = tokenTopics(root, kind, configuredTopics);
    const availableRoles = automaticRoles[kind] || automaticRoles.page;
    return picked.map((placement, index) => ({
      ...placement,
      id: `auto-${index + 1}`,
      role: availableRoles[index % availableRoles.length],
      budget: index % 3 === 0 ? 'standard-v1' : 'compact-v1',
      topics,
      editorial_types: editorialTypes,
    }));
  }

  function pageViewId() {
    const random = globalThis.crypto?.randomUUID?.();
    return random || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function recentKey(site) {
    return `conbal:auto-history:${site}`;
  }

  function recentSlugs(site) {
    try {
      const parsed = JSON.parse(localStorage.getItem(recentKey(site)) || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => /^[a-z0-9-]{1,80}$/.test(item)).slice(0, 30) : [];
    } catch {
      return [];
    }
  }

  function remember(site, assignments, previous) {
    try {
      const slugs = [...new Set([...Object.values(assignments).map(item => item.slug), ...previous])].slice(0, 30);
      localStorage.setItem(recentKey(site), JSON.stringify(slugs));
    } catch {
      // Storage may be blocked; delivery still works without history.
    }
  }

  function addStyles(origin) {
    if (autoStylesPromise) return autoStylesPromise;
    let link = document.querySelector('link[data-conbal-auto-styles]');
    if (link?.dataset?.conbalStyleState === 'ready' || link?.sheet) return Promise.resolve(true);
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${origin}/embed.css`;
      link.dataset.conbalAutoStyles = '';
    }
    link.dataset.conbalStyleState = 'loading';
    autoStylesPromise = new Promise(resolve => {
      let settled = false;
      let timeout;
      const finish = ready => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        link.dataset.conbalStyleState = ready ? 'ready' : 'error';
        resolve(ready);
      };
      link.addEventListener('load', () => finish(true), { once: true });
      link.addEventListener('error', () => finish(false), { once: true });
      if (!link.parentElement) document.head.appendChild(link);
      timeout = setTimeout(() => finish(Boolean(link.sheet)), autoStyleTimeoutMs);
    });
    return autoStylesPromise;
  }

  function renderAuto(slot, assignment, plan) {
    const limits = budgetLimits[assignment?.budget];
    if (!assignment || typeof assignment !== 'object' || assignment.role !== plan.role || assignment.budget !== plan.budget || !limits || !/^[a-z0-9-]{1,80}$/.test(assignment.slug || '')) {
      slot.remove();
      return false;
    }
    const content = assignment.content;
    if (!content || typeof content.headline !== 'string' || typeof content.body !== 'string' || !content.headline.trim() || !content.body.trim() || content.headline.length > limits.headline || content.body.length > limits.body) {
      slot.remove();
      return false;
    }
    slot.innerHTML = '';
    slot.dataset.conbalState = 'ready';
    slot.dataset.conbalSlug = assignment.slug;
    slot.dataset.conbalEditorialType = assignment.editorial_type || 'did_you_know';
    const card = document.createElement('aside');
    card.className = 'conbal-auto-card';
    const copy = document.createElement('div');
    const label = document.createElement('p');
    label.dataset.conbalLabel = '';
    label.textContent = labels[assignment.editorial_type] || 'A useful note';
    const headline = document.createElement('h3');
    headline.id = `conbal-auto-heading-${++autoHeading}`;
    headline.textContent = content.headline;
    card.setAttribute('aria-labelledby', headline.id);
    copy.append(label, headline);
    const body = document.createElement('p');
    body.textContent = content.body;
    card.append(copy, body);
    slot.append(card);
    slot.hidden = false;
    slot.removeAttribute?.('hidden');
    return true;
  }

  async function runAuto(origin, site, configuredTopics, maxSlots) {
    const root = pageRoot();
    const kind = pageKind(root);
    if (kind === 'blocked' || document.querySelector('[data-conbal-managed="true"]')) return 'blocked';
    const plans = pageSlots(root, kind, configuredTopics, maxSlots);
    if (!plans.length) return 'empty';
    const stylesReady = addStyles(origin);
    const run = ++autoRun;
    autoController?.abort();
    const controller = new AbortController();
    autoController = controller;
    const previous = recentSlugs(site);
    const slots = plans.map(plan => {
      const slot = document.createElement('div');
      slot.dataset.conbalAutoSlot = '';
      slot.dataset.conbalSlotId = plan.id;
      slot.dataset.conbalRole = plan.role;
      slot.dataset.conbalState = 'loading';
      slot.hidden = true;
      slot.setAttribute?.('hidden', '');
      if (plan.anchor.parentElement === plan.parent) plan.parent.insertBefore(slot, plan.anchor.nextSibling);
      return slot;
    });
    const body = {
      contract: '2.0',
      page_view_id: pageViewId(),
      repeat_policy: 'omit',
      exclude_slugs: previous,
      slots: plans.map(({ id, role, topics, editorial_types, budget }) => ({ id, role, topics, editorial_types, budget })),
    };
    const requestTimeout = setTimeout(() => controller.abort(), autoRequestTimeoutMs);
    try {
      const response = await fetch(`${origin}/v2/b/${encodeURIComponent(site)}/sample`, {
        body: JSON.stringify(body),
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        mode: 'cors',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Conbal auto delivery failed: ${response.status}`);
      const [payload, styled] = await Promise.all([response.json(), stylesReady]);
      if (run !== autoRun) return;
      if (!styled) throw new Error('Conbal automatic styles failed to load');
      const assignments = payload?.assignments;
      if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
        slots.forEach(slot => slot.remove());
        return 'started';
      }
      const rendered = {};
      slots.forEach((slot, index) => {
        const assignment = assignments[plans[index].id];
        if (renderAuto(slot, assignment, plans[index])) rendered[plans[index].id] = assignment;
      });
      remember(site, rendered, previous);
      return 'started';
    } catch {
      if (run === autoRun) slots.forEach(slot => slot.remove());
      return 'error';
    } finally {
      clearTimeout(requestTimeout);
    }
  }

  let autoSchedule = 0;

  function cancelAuto() {
    autoSchedule += 1;
    autoRun += 1;
    autoController?.abort();
    autoController = undefined;
  }

  function scheduleAuto(origin, site, configuredTopics, maxSlots, generation, attempt = 0, previousContent, onContentChanged) {
    const maxAttempts = 8;
    const delay = attempt === 0 ? 40 : Math.min(500, 40 * (attempt + 1));
    setTimeout(async () => {
      if (generation !== autoSchedule || document.querySelector('[data-conbal-auto-slot]')) return;
      const currentContent = contentSignature();
      if (previousContent !== undefined && currentContent === previousContent && attempt < maxAttempts) {
        scheduleAuto(origin, site, configuredTopics, maxSlots, generation, attempt + 1, previousContent, onContentChanged);
        return;
      }
      if (previousContent !== undefined) onContentChanged?.(currentContent);
      const status = await runAuto(origin, site, configuredTopics, maxSlots);
      if (status === 'started' || status === 'empty') onContentChanged?.(contentSignature());
      if (status === 'empty' && attempt < maxAttempts && generation === autoSchedule) {
        scheduleAuto(origin, site, configuredTopics, maxSlots, generation, attempt + 1, undefined, onContentChanged);
      }
    }, delay);
  }

  function watchAuto(origin, site, configuredTopics, maxSlots) {
    let last = location.href;
    let lastContent = contentSignature();
    const rerun = () => {
      if (location.href === last) return;
      last = location.href;
      cancelAuto();
      document.querySelectorAll('[data-conbal-auto-slot]').forEach(slot => slot.remove());
      scheduleAuto(origin, site, configuredTopics, maxSlots, autoSchedule, 0, lastContent, signature => { lastContent = signature; });
    };
    ['pushState', 'replaceState'].forEach(method => {
      const original = history[method];
      if (original.__conbalWrapped) return;
      const wrapped = function (...args) { const result = original.apply(this, args); rerun(); return result; };
      wrapped.__conbalWrapped = true;
      history[method] = wrapped;
    });
    window.addEventListener('popstate', rerun);
    scheduleAuto(origin, site, configuredTopics, maxSlots, autoSchedule, 0, undefined, signature => { lastContent = signature; });
  }

  function start() {
    const { origin, site, auto, topics, maxSlots } = scriptConfig();
    if (site && auto) {
      // A managed host can keep its own renderer while still using the
      // legacy explicit-slot API from this same script.
      if (document.querySelector('[data-conbal-managed="true"]')) {
        renderLegacySlots(origin);
        return;
      }
      watchAuto(origin, site, topics, maxSlots);
      return;
    }
    renderLegacySlots(origin);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
