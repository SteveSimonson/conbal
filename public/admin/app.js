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
const snippet = siteKey => `<div data-conbal-site="${siteKey}" data-conbal="SLUG" data-size="responsive"></div>\n<script src="https://conbal.us/embed.js" defer></script>`;
const count = value => new Intl.NumberFormat().format(Number(value) || 0);
const calledAt = value => { if (!value) return 'Never called'; const date = new Date(value); if (Number.isNaN(date.getTime())) return 'Never called'; const iso = date.toISOString(); return `<time datetime="${esc(iso)}" title="${esc(iso)}">${esc(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date))}</time>`; };
const editorialTypes = ['did_you_know', 'fun_fact', 'care_tip', 'design_note', 'material_myth', 'nature_note', 'culture_craft'];
const metadata = balloon => {
  const type = balloon.editorial_type ? esc(balloon.editorial_type.replaceAll('_', ' ')) : 'did you know (default)';
  const topics = Array.isArray(balloon.topics) ? balloon.topics : String(balloon.topics || '').split(',').map(value => value.trim()).filter(Boolean);
  return `<span class="meta">Editorial type: ${type}${topics.length ? ` · Topics: ${esc(topics.join(', '))}` : ''}</span>`;
};
let selectedSiteId = '';

async function copy(text) { try { await navigator.clipboard.writeText(text); say('Embed code copied. Replace SLUG with your balloon slug.'); } catch { say('Could not copy automatically. Select the embed code and copy it manually.'); } }
async function load() {
  const sites = await api('/sites');
  if (!sites.some(site => site.id === selectedSiteId)) selectedSiteId = sites[0]?.id || '';
  if (!selectedSiteId) { $('#sites').innerHTML = '<p>Create a site to start adding balloons.</p>'; return; }
  const site = sites.find(item => item.id === selectedSiteId);
  const analytics = await api(`/analytics?site_id=${encodeURIComponent(site.id)}`), selected = analytics.selected_site;
  $('#sites').innerHTML = `<section class="site"><label>Your site <select id="site-picker">${sites.map(item => `<option value="${esc(item.id)}" ${item.id === site.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><h2>${esc(site.name)}</h2><section class="analytics" aria-label="Delivery activity"><h3>Delivery activity</h3><div class="metric-grid"><div><strong>${count(analytics.account.calls)}</strong><span>Account calls</span></div><div><strong>${count(selected.calls)}</strong><span>Selected-site calls</span></div><div><strong>${calledAt(selected.last_called_at)}</strong><span>Selected site last called</span></div></div><h4>All sites</h4><ul class="site-stats">${analytics.sites.map(item => `<li ${item.site_id === site.id ? 'aria-current="true"' : ''}><strong>${esc(item.name)}</strong><span>${count(item.calls)} calls · Last called: ${calledAt(item.last_called_at)}</span></li>`).join('')}</ul>${analytics.account.calls ? '' : '<p class="help">No delivery calls yet. Publish a balloon and add its embed code to start tracking.</p>'}<p class="help">Each successfully returned published balloon counts once per public request. Totals are delivery calls, not unique people, and may include reloads, bots, and direct API clients.</p></section><p>Site key: <code>${esc(site.site_key)}</code></p><label>Embed code</label><pre><code>${esc(snippet(site.site_key))}</code></pre><button type="button" data-copy="${esc(site.site_key)}">Copy embed code</button><p class="help">Responsive is the safe default and adopts the host container width. Fixed sizes are opt-in and should be used only inside a container with those exact dimensions.</p><button type="button" data-add="${esc(site.id)}">New balloon</button><button type="button" id="publish-all">Publish all drafts</button><button type="button" id="reindex-site">Rebuild delivery index</button><p class="help">Publish all drafts only after reviewing their visitor-facing copy. Rebuild the delivery index after a platform migration or if published content is missing from dynamic delivery.</p><section class="import"><h3>Import draft balloons</h3><p><a href="/admin/example-balloons.csv" download>Download the example CSV</a> · <a href="/admin/content-balloon-csv-llm-guide.md" download>Download the LLM generation guide</a></p><label>Content CSV file <input id="csv-file" type="file" accept=".csv,text/csv"></label><button type="button" id="import-csv" disabled>Import content CSV</button><p class="help">Rows are imported as drafts. Required columns: title, slug, size, html, css. Optional editorial metadata may be included with each row.</p></section><section class="import"><h3>Import editorial metadata</h3><p><a href="/admin/ibamboo-bamboo-facts-50-metadata.csv" download>Download the iBamboo metadata example</a></p><label>Metadata CSV file <input id="metadata-csv-file" type="file" accept=".csv,text/csv"></label><button type="button" id="import-metadata-csv" disabled>Import metadata CSV</button><p class="help">Match existing balloons by slug. Use the optional editorial type and comma-separated topic tags to make visitor-facing facts eligible for the right page slots.</p></section><div id="b-${esc(site.id)}"></div></section>`;
  await renderBalloons(site.id, selected.balloons);
  document.querySelectorAll('[data-add]').forEach(button => { button.onclick = () => editor(button.dataset.add); });
  document.querySelectorAll('[data-copy]').forEach(button => { button.onclick = () => copy(snippet(button.dataset.copy)); });
  $('#site-picker').onchange = event => { selectedSiteId = event.target.value; load().catch(error => say(error.message)); };
  $('#csv-file').onchange = event => { $('#import-csv').disabled = !event.target.files?.length; };
  $('#import-csv').onclick = () => importCsv(site.id);
  $('#metadata-csv-file').onchange = event => { $('#import-metadata-csv').disabled = !event.target.files?.length; };
  $('#import-metadata-csv').onclick = () => importMetadataCsv(site.id);
  $('#publish-all').onclick = () => publishAllDrafts(site.id, site.name);
  $('#reindex-site').onclick = () => reindexSite(site.id);
}
async function renderBalloons(siteId, deliveryStats = []) {
  const balloons = await api(`/sites/${siteId}/balloons`);
  const byId = new Map(deliveryStats.map(item => [item.balloon_id, item]));
  $(`#b-${siteId}`).innerHTML = balloons.map(balloon => { const stats = byId.get(balloon.id) || { calls: 0, last_called_at: null }; return `<div class="balloon"><strong>${esc(balloon.title)}</strong> — ${esc(balloon.slug)} (${esc(balloon.status)}) ${metadata(balloon)}<span class="meta">Calls: ${count(stats.calls)} · Last called: ${calledAt(stats.last_called_at)}</span><button type="button" data-edit="${esc(balloon.id)}">Edit</button></div>`; }).join('') || '<p>No balloons yet. Create or import a draft to get started.</p>';
  document.querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => editor(siteId, button.dataset.edit); });
}
function preview(form) { const frame = form.querySelector('iframe'); const values = Object.fromEntries(new FormData(form)); frame.srcdoc = `<style>body{margin:0} ${values.css || ''}</style>${values.html || ''}`; }
async function importCsv(siteId) {
  const file = $('#csv-file').files?.[0];
  if (!file) return;
  const button = $('#import-csv'); button.disabled = true;
  try {
    if (!file.size) throw new Error('Choose a CSV with at least one balloon row.');
    const result = await api(`/sites/${siteId}/balloons/import`, { method: 'POST', headers: { 'content-type': 'text/csv; charset=utf-8' }, body: await file.text() });
    await load(); say(`Imported ${result.imported} draft balloon${result.imported === 1 ? '' : 's'}.`);
  } catch (error) { button.disabled = false; say(error.message); }
}
async function importMetadataCsv(siteId) {
  const file = $('#metadata-csv-file').files?.[0];
  if (!file) return;
  const button = $('#import-metadata-csv'); button.disabled = true;
  try {
    if (!file.size) throw new Error('Choose a metadata CSV with at least one row.');
    const result = await api(`/sites/${siteId}/balloons/metadata/import`, { method: 'POST', headers: { 'content-type': 'text/csv; charset=utf-8' }, body: await file.text() });
    await load(); say(`Imported metadata for ${result.updated} balloon${result.updated === 1 ? '' : 's'}.`);
  } catch (error) { button.disabled = false; say(error.message); }
}
async function publishAllDrafts(siteId, siteName) {
  if (!confirm(`Publish every draft balloon for ${siteName}? This makes each draft publicly eligible for visitor-facing delivery.`)) return;
  const button = $('#publish-all'); button.disabled = true;
  try {
    const result = await api(`/sites/${siteId}/balloons/publish-all`, { method: 'POST' });
    await load(); say(`Published ${result.published} draft balloon${result.published === 1 ? '' : 's'}.`);
  } catch (error) { button.disabled = false; say(error.message); }
}
async function reindexSite(siteId) {
  const button = $('#reindex-site'); button.disabled = true;
  try {
    const result = await api(`/sites/${siteId}/balloons/reindex`, { method: 'POST' });
    if (result.skipped) throw new Error(`Indexed ${result.indexed} of ${result.total}; ${result.skipped} published balloon${result.skipped === 1 ? '' : 's'} need attention.`);
    say(`Delivery index rebuilt for ${result.indexed} published balloon${result.indexed === 1 ? '' : 's'}.`);
  } catch (error) { say(error.message); }
  finally { button.disabled = false; }
}
async function editor(siteId, balloonId) {
  let balloon = { title: '', slug: '', html: '', css: '', size: 'responsive', editorial_type: '', topics: '' };
  if (balloonId) { const balloons = await api(`/sites/${siteId}/balloons`); balloon = balloons.find(item => item.id === balloonId); if (!balloon) throw new Error('Balloon not found'); }
  const form = document.createElement('form'); form.className = 'balloon editor';
  const topics = Array.isArray(balloon.topics) ? balloon.topics.join(', ') : balloon.topics || '';
  form.innerHTML = `<h3>${balloonId ? 'Edit' : 'New'} balloon</h3><input name="title" required maxlength="200" placeholder="Title" value="${esc(balloon.title)}"><input name="slug" required maxlength="80" pattern="[a-z0-9-]+" placeholder="slug" value="${esc(balloon.slug)}"><select name="size">${['responsive', '300x250', '336x280', '728x90', '160x600', '320x100'].map(size => `<option ${size === balloon.size ? 'selected' : ''}>${size}</option>`).join('')}</select><label>Editorial type (optional)<select name="editorial_type"><option value="">Default · did you know</option>${editorialTypes.map(type => `<option value="${type}" ${type === balloon.editorial_type ? 'selected' : ''}>${type.replaceAll('_', ' ')}</option>`).join('')}</select></label><label>Topics (optional, comma-separated)<input name="topics" maxlength="500" placeholder="plant-science, material, home-goods" value="${esc(topics)}"></label><p class="help">Metadata guides dynamic sampling. The host may turn the editorial type into a visible kicker; topic tags remain internal. The HTML below must carry the useful, customer-facing fact.</p><label>HTML</label><textarea name="html" required maxlength="50000">${esc(balloon.html)}</textarea><label>CSS (optional)</label><textarea name="css" maxlength="20000">${esc(balloon.css || '')}</textarea><p><button type="button" data-preview>Refresh preview</button></p><iframe title="Balloon preview" sandbox="allow-forms allow-popups"></iframe><p><button>Save</button>${balloonId ? '<button type="button" data-publish>Publish</button><button type="button" data-unpublish>Unpublish</button><button type="button" data-delete>Delete</button>' : ''}<button type="button" data-cancel>Cancel</button></p>`;
  $('#sites').prepend(form);
  form.onsubmit = async event => { event.preventDefault(); try { await api(balloonId ? `/balloons/${balloonId}` : `/sites/${siteId}/balloons`, { method: balloonId ? 'PATCH' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.remove(); await load(); say('Saved.'); } catch (error) { say(error.message); } };
  form.querySelector('[data-preview]').onclick = () => preview(form); form.querySelector('[data-cancel]').onclick = () => form.remove();
  for (const action of ['publish', 'unpublish', 'delete']) { const button = form.querySelector(`[data-${action}]`); if (!button) continue; button.onclick = async () => { if (action === 'delete' && !confirm('Delete this balloon?')) return; try { await api(`/balloons/${balloonId}${action === 'delete' ? '' : '/' + action}`, { method: action === 'delete' ? 'DELETE' : 'POST' }); form.remove(); await load(); say(action === 'delete' ? 'Balloon deleted.' : `Balloon ${action}ed.`); } catch (error) { say(error.message); } }; }
  preview(form);
}
$('#new-site').onsubmit = async event => { event.preventDefault(); try { const site = await api('/sites', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); selectedSiteId = site.id; event.target.reset(); await load(); say('Site created.'); } catch (error) { say(error.message); } };
$('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.assign('/admin/login.html'); };
load().catch(error => say(error.message));
