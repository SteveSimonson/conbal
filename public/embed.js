(() => {
  const sizes = new Set(['responsive', '300x250', '336x280', '728x90', '160x600', '320x100']);

  function collapse(slot) {
    slot.innerHTML = '';
    slot.style.display = 'none';
    slot.style.width = '';
    slot.style.maxWidth = '';
    slot.style.height = '';
    slot.style.overflow = '';
    slot.style.isolation = '';
  }

  function reveal(slot, balloon, size) {
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

  function render(slot, balloon) {
    const requestedSize = slot.dataset.size;
    const payloadSize = balloon?.size;
    const validRequest = requestedSize === undefined || requestedSize === '' || sizes.has(requestedSize);
    const validPayload = sizes.has(payloadSize) && typeof balloon?.html === 'string';
    if (!validRequest || !validPayload || (requestedSize && requestedSize !== payloadSize)) {
      collapse(slot);
      return;
    }
    reveal(slot, balloon, requestedSize || payloadSize);
  }

  function start() {
    const script = document.currentScript || [...document.scripts].find(item => /\/embed\.js(?:$|\?)/.test(item.src));
    const origin = script ? new URL(script.src, document.baseURI).origin : 'https://conbal.us';
    const slots = [...document.querySelectorAll('[data-conbal][data-conbal-site]')];
    slots.forEach(collapse);
    const groups = slots.reduce((all, slot) => {
      (all[slot.dataset.conbalSite] ||= []).push(slot);
      return all;
    }, {});
    Object.entries(groups).forEach(([site, items]) => {
      const slugs = [...new Set(items.map(item => item.dataset.conbal).filter(Boolean))];
      if (!slugs.length) return;
      fetch(`${origin}/b/${encodeURIComponent(site)}/${slugs.join(',')}`, { mode: 'cors' })
        .then(response => response.ok ? response.json() : {})
        .then(payloads => items.forEach(slot => render(slot, payloads[slot.dataset.conbal])))
        .catch(() => items.forEach(collapse));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
