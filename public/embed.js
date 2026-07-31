(() => {
  const fixedSizes = new Set(['300x250', '336x280', '728x90', '160x600', '320x100']);
  function reserve(slot) { const size = slot.dataset.size; if (fixedSizes.has(size)) { const [width, height] = size.split('x'); slot.style.width = `${width}px`; slot.style.height = `${height}px`; } else if (size === 'responsive') slot.style.width = '100%'; slot.style.overflow = 'hidden'; }
  function start() {
    const script = document.currentScript || [...document.scripts].find(item => /\/embed\.js(?:$|\?)/.test(item.src));
    const origin = script ? new URL(script.src, document.baseURI).origin : 'https://conbal.us'; const slots = [...document.querySelectorAll('[data-conbal][data-conbal-site]')]; slots.forEach(reserve);
    const groups = slots.reduce((all, slot) => { (all[slot.dataset.conbalSite] ||= []).push(slot); return all; }, {});
    Object.entries(groups).forEach(([site, items]) => { const slugs = [...new Set(items.map(item => item.dataset.conbal).filter(Boolean))]; if (!slugs.length) return; fetch(`${origin}/b/${encodeURIComponent(site)}/${slugs.join(',')}`, { mode: 'cors' }).then(response => response.ok ? response.json() : {}).then(payloads => items.forEach(slot => { const balloon = payloads[slot.dataset.conbal]; if (balloon) slot.innerHTML = `<style>${balloon.css || ''}</style>${balloon.html}`; })).catch(() => {}); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
