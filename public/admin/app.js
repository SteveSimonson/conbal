const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const api = async (path, options = {}) => {
  const response = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...options });
  if (response.status === 401) { location.assign('/admin/login.html'); throw new Error('Login required'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};
const say = message => { $('#message').textContent = message; };
const snippet = siteKey => `<div data-conbal-site="${siteKey}" data-conbal="SLUG" data-size="300x250"></div>\n<script src="https://conbal.us/embed.js" defer></script>`;

async function copy(text) { try { await navigator.clipboard.writeText(text); say('Embed code copied. Replace SLUG with your balloon slug.'); } catch { say('Could not copy automatically. Select the embed code and copy it manually.'); } }
async function load() {
  const sites = await api('/sites');
  $('#sites').innerHTML = sites.map(site => `<section class="site"><h2>${esc(site.name)}</h2><p>Site key: <code>${esc(site.site_key)}</code></p><label>Embed code</label><pre><code>${esc(snippet(site.site_key))}</code></pre><button type="button" data-copy="${esc(site.site_key)}">Copy embed code</button><button type="button" data-add="${esc(site.id)}">New balloon</button><div id="b-${esc(site.id)}"></div></section>`).join('') || '<p>Create a site to start adding balloons.</p>';
  await Promise.all(sites.map(site => renderBalloons(site.id)));
  document.querySelectorAll('[data-add]').forEach(button => { button.onclick = () => editor(button.dataset.add); });
  document.querySelectorAll('[data-copy]').forEach(button => { button.onclick = () => copy(snippet(button.dataset.copy)); });
}
async function renderBalloons(siteId) {
  const balloons = await api(`/sites/${siteId}/balloons`);
  $(`#b-${siteId}`).innerHTML = balloons.map(balloon => `<div class="balloon"><strong>${esc(balloon.title)}</strong> — ${esc(balloon.slug)} (${esc(balloon.status)}) <button type="button" data-edit="${esc(balloon.id)}">Edit</button></div>`).join('');
  document.querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => editor(siteId, button.dataset.edit); });
}
function preview(form) { const frame = form.querySelector('iframe'); const values = Object.fromEntries(new FormData(form)); frame.srcdoc = `<style>body{margin:0} ${values.css || ''}</style>${values.html || ''}`; }
async function editor(siteId, balloonId) {
  let balloon = { title: '', slug: '', html: '', css: '', size: 'responsive' };
  if (balloonId) { const balloons = await api(`/sites/${siteId}/balloons`); balloon = balloons.find(item => item.id === balloonId); if (!balloon) throw new Error('Balloon not found'); }
  const form = document.createElement('form'); form.className = 'balloon editor';
  form.innerHTML = `<h3>${balloonId ? 'Edit' : 'New'} balloon</h3><input name="title" required maxlength="200" placeholder="Title" value="${esc(balloon.title)}"><input name="slug" required maxlength="80" pattern="[a-z0-9-]+" placeholder="slug" value="${esc(balloon.slug)}"><select name="size">${['responsive', '300x250', '336x280', '728x90', '160x600', '320x100'].map(size => `<option ${size === balloon.size ? 'selected' : ''}>${size}</option>`).join('')}</select><label>HTML</label><textarea name="html" required maxlength="50000">${esc(balloon.html)}</textarea><label>CSS (optional)</label><textarea name="css" maxlength="20000">${esc(balloon.css || '')}</textarea><p><button type="button" data-preview>Refresh preview</button></p><iframe title="Balloon preview" sandbox="allow-forms allow-popups"></iframe><p><button>Save</button>${balloonId ? '<button type="button" data-publish>Publish</button><button type="button" data-unpublish>Unpublish</button><button type="button" data-delete>Delete</button>' : ''}<button type="button" data-cancel>Cancel</button></p>`;
  $('#sites').prepend(form);
  form.onsubmit = async event => { event.preventDefault(); try { await api(balloonId ? `/balloons/${balloonId}` : `/sites/${siteId}/balloons`, { method: balloonId ? 'PATCH' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.remove(); await load(); say('Saved.'); } catch (error) { say(error.message); } };
  form.querySelector('[data-preview]').onclick = () => preview(form); form.querySelector('[data-cancel]').onclick = () => form.remove();
  for (const action of ['publish', 'unpublish', 'delete']) { const button = form.querySelector(`[data-${action}]`); if (!button) continue; button.onclick = async () => { if (action === 'delete' && !confirm('Delete this balloon?')) return; try { await api(`/balloons/${balloonId}${action === 'delete' ? '' : '/' + action}`, { method: action === 'delete' ? 'DELETE' : 'POST' }); form.remove(); await load(); say(action === 'delete' ? 'Balloon deleted.' : `Balloon ${action}ed.`); } catch (error) { say(error.message); } }; }
  preview(form);
}
$('#new-site').onsubmit = async event => { event.preventDefault(); try { await api('/sites', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); event.target.reset(); await load(); say('Site created.'); } catch (error) { say(error.message); } };
$('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.assign('/admin/login.html'); };
load().catch(error => say(error.message));
