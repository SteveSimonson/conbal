(() => {
  'use strict';

  const sizes = new Set(['responsive', '300x250', '336x280', '728x90', '160x600', '320x100']);
  const roles = ['inline-note', 'section-break', 'aside-note', 'grid-tile'];
  const editorialTypes = ['did_you_know', 'fun_fact', 'care_tip', 'design_note', 'material_myth', 'nature_note', 'culture_craft'];
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
  let autoRun = 0;
  let autoController;

  function scriptElement() {
    return document.currentScript || [...document.scripts].find(item => /\/embed\.js(?:$|\?)/.test(item.src));
  }

  function scriptConfig() {
    const script = scriptElement();
    const origin = script ? new URL(script.src, document.baseURI).origin : 'https://conbal.us';
    const site = script?.dataset?.conbalSite || script?.getAttribute?.('data-conbal-site');
    const auto = script?.dataset?.conbalAuto === 'true' || script?.hasAttribute?.('data-conbal-auto');
    return { origin: origin.replace(/\/$/, ''), site, auto, script };
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

  function excluded(node) {
    return Boolean(node.closest('header, nav, footer, form, dialog, aside, [data-conbal-ignore], [data-conbal-auto-slot]'));
  }

  function visible(node) {
    if (!node || excluded(node)) return false;
    const rect = node.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  }

  function pageRoot() {
    return document.querySelector('main, [role="main"], article') || document.body;
  }

  function pageKind(root) {
    const path = location.pathname.toLowerCase();
    if (/checkout|cart|account|admin|login/.test(path)) return 'blocked';
    if (/product|item|p\//.test(path) || root.querySelector('[itemtype*="Product"], [data-product], [data-product-page]')) return 'product';
    if (/blog|article|story|guide|news/.test(path) || root.querySelector('article')) return 'article';
    if (/shop|collection|category|search/.test(path)) return 'shop';
    return 'page';
  }

  function tokenTopics(root, kind) {
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

  function pageSlots(root, kind) {
    const words = textOf(root).split(/\s+/).filter(Boolean).length;
    if (words < 180 || kind === 'blocked') return [];
    const target = Math.min(8, Math.max(3, 2 + Math.floor(words / 350)));
    const sections = [...root.querySelectorAll('section, article')]
      .filter(node => visible(node) && textOf(node).length >= 80 && !node.parentElement?.closest('section, article'));
    const headings = [...root.querySelectorAll('h2, h3')].filter(visible).filter(node => textOf(node).length >= 8);
    const candidates = [...new Set([...sections, ...headings])];
    if (candidates.length < target) {
      const paragraphs = [...root.querySelectorAll('p')]
        .filter(node => visible(node) && textOf(node).length >= 80);
      candidates.push(...paragraphs.filter(node => !candidates.includes(node)));
    }
    if (!candidates.length) return [];
    const picked = [];
    for (let index = 0; index < Math.min(target, candidates.length); index += 1) {
      const candidate = candidates[Math.round((index * (candidates.length - 1)) / Math.max(1, target - 1))];
      if (candidate && !picked.includes(candidate)) picked.push(candidate);
    }
    for (const candidate of candidates) {
      if (picked.length >= target) break;
      if (!picked.includes(candidate)) picked.push(candidate);
    }
    const topics = tokenTopics(root, kind);
    return picked.map((anchor, index) => ({
      anchor,
      id: `auto-${index + 1}`,
      role: roles[index % roles.length],
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

  function addStyles() {
    if (document.getElementById('conbal-auto-styles')) return;
    const style = document.createElement('style');
    style.id = 'conbal-auto-styles';
    style.textContent = `
      [data-conbal-auto-slot] { box-sizing:border-box; clear:both; display:none; margin:clamp(1.25rem,3vw,2.75rem) auto; max-width:min(100%,72rem); width:100%; color:var(--conbal-ink,inherit); font-family:inherit; }
      [data-conbal-auto-slot] .conbal-auto-card { align-items:center; background:var(--conbal-surface,#f3f1eb); border:1px solid color-mix(in srgb,var(--conbal-accent,#477a56) 24%,transparent); border-radius:1rem; box-sizing:border-box; display:grid; gap:1rem; grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr); padding:clamp(1rem,2.5vw,1.5rem); }
      [data-conbal-auto-slot] [data-conbal-label] { color:var(--conbal-accent,#477a56); font-size:.68rem; font-weight:700; letter-spacing:.14em; margin:0 0 .45rem; text-transform:uppercase; }
      [data-conbal-auto-slot] h3 { color:inherit; font:inherit; font-size:clamp(1.05rem,2vw,1.45rem); font-weight:700; line-height:1.18; margin:0; }
      [data-conbal-auto-slot] p { color:inherit; font-size:.92rem; line-height:1.55; margin:0; opacity:.82; }
      [data-conbal-auto-slot][data-conbal-role="section-break"] .conbal-auto-card { background:var(--conbal-surface-strong,#173829); color:var(--conbal-on-accent,#fff); }
      [data-conbal-auto-slot][data-conbal-role="section-break"] [data-conbal-label] { color:var(--conbal-on-accent,#b8e1bd); }
      [data-conbal-auto-slot][data-conbal-role="aside-note"] { max-width:42rem; }
      [data-conbal-auto-slot][data-conbal-role="aside-note"] .conbal-auto-card { display:block; }
      [data-conbal-auto-slot][data-conbal-role="aside-note"] p { margin-top:.65rem; }
      [data-conbal-auto-slot][data-conbal-role="grid-tile"] .conbal-auto-card { grid-template-columns:auto minmax(0,1fr); }
      @media (max-width:640px) { [data-conbal-auto-slot] .conbal-auto-card { display:block; } [data-conbal-auto-slot] p { margin-top:.7rem; } }
      @media (prefers-reduced-motion:reduce) { [data-conbal-auto-slot] { scroll-behavior:auto; } }
    `;
    document.head.appendChild(style);
  }

  function renderAuto(slot, assignment) {
    if (!assignment || typeof assignment !== 'object' || !roles.includes(assignment.role) || !['compact-v1', 'standard-v1'].includes(assignment.budget)) {
      slot.remove();
      return;
    }
    const content = assignment.content;
    if (!content || typeof content.headline !== 'string' || typeof content.body !== 'string' || !content.headline.trim() || !content.body.trim()) {
      slot.remove();
      return;
    }
    slot.innerHTML = '';
    slot.dataset.conbalState = 'ready';
    slot.dataset.conbalSlug = assignment.slug;
    slot.dataset.conbalEditorialType = assignment.editorial_type || 'did_you_know';
    const card = document.createElement('div');
    card.className = 'conbal-auto-card';
    const copy = document.createElement('div');
    const label = document.createElement('p');
    label.dataset.conbalLabel = '';
    label.textContent = labels[assignment.editorial_type] || 'A useful note';
    const headline = document.createElement('h3');
    headline.textContent = content.headline;
    copy.append(label, headline);
    const body = document.createElement('p');
    body.textContent = content.body;
    card.append(copy, body);
    slot.append(card);
    slot.style.display = 'block';
  }

  async function runAuto(origin, site) {
    const root = pageRoot();
    const kind = pageKind(root);
    if (kind === 'blocked' || document.querySelector('[data-conbal-managed="true"]')) return;
    const plans = pageSlots(root, kind);
    if (!plans.length) return;
    addStyles();
    const run = ++autoRun;
    autoController?.abort();
    autoController = new AbortController();
    const previous = recentSlugs(site);
    const slots = plans.map(plan => {
      const slot = document.createElement('div');
      slot.dataset.conbalAutoSlot = '';
      slot.dataset.conbalRole = plan.role;
      slot.dataset.conbalState = 'loading';
      plan.anchor.parentElement?.insertBefore(slot, plan.anchor.nextSibling);
      return slot;
    });
    const body = {
      contract: '2.0',
      page_view_id: pageViewId(),
      repeat_policy: 'omit',
      exclude_slugs: previous,
      slots: plans.map(({ id, role, topics, editorial_types, budget }) => ({ id, role, topics, editorial_types, budget })),
    };
    try {
      const response = await fetch(`${origin}/v2/b/${encodeURIComponent(site)}/sample`, {
        body: JSON.stringify(body),
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        mode: 'cors',
        signal: autoController.signal,
      });
      if (!response.ok) throw new Error(`Conbal auto delivery failed: ${response.status}`);
      const payload = await response.json();
      if (run !== autoRun) return;
      const assignments = payload?.assignments;
      if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
        slots.forEach(slot => slot.remove());
        return;
      }
      slots.forEach((slot, index) => renderAuto(slot, assignments[plans[index].id]));
      remember(site, assignments, previous);
    } catch {
      if (run === autoRun) slots.forEach(slot => slot.remove());
    }
  }

  function watchAuto(origin, site) {
    let last = location.href;
    let timer;
    const rerun = () => {
      if (location.href === last) return;
      last = location.href;
      clearTimeout(timer);
      document.querySelectorAll('[data-conbal-auto-slot]').forEach(slot => slot.remove());
      timer = setTimeout(() => runAuto(origin, site), 40);
    };
    ['pushState', 'replaceState'].forEach(method => {
      const original = history[method];
      if (original.__conbalWrapped) return;
      const wrapped = function (...args) { const result = original.apply(this, args); rerun(); return result; };
      wrapped.__conbalWrapped = true;
      history[method] = wrapped;
    });
    window.addEventListener('popstate', rerun);
    setTimeout(() => {
      if (!document.querySelector('[data-conbal-auto-slot]')) runAuto(origin, site);
    }, 260);
  }

  function start() {
    const { origin, site, auto } = scriptConfig();
    if (site && auto) {
      runAuto(origin, site);
      watchAuto(origin, site);
      return;
    }
    renderLegacySlots(origin);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
