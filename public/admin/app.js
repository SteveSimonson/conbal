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
const snippet = siteKey => `<script defer src="https://conbal.us/embed.js" data-conbal-site="${siteKey}" data-conbal-auto></script>`;
const count = value => new Intl.NumberFormat().format(Number(value) || 0);
const calledAt = value => { if (!value) return 'Never called'; const date = new Date(value); if (Number.isNaN(date.getTime())) return 'Never called'; const iso = date.toISOString(); return `<time datetime="${esc(iso)}" title="${esc(iso)}">${esc(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date))}</time>`; };
const editorialTypes = ['did_you_know', 'fun_fact', 'care_tip', 'design_note', 'material_myth', 'nature_note', 'culture_craft'];
const metadata = balloon => {
  const type = balloon.editorial_type ? esc(balloon.editorial_type.replaceAll('_', ' ')) : 'did you know (default)';
  const topics = Array.isArray(balloon.topics) ? balloon.topics : String(balloon.topics || '').split(',').map(value => value.trim()).filter(Boolean);
  return `<span class="meta">Editorial type: ${type}${topics.length ? ` · Topics: ${esc(topics.join(', '))}` : ''}</span>`;
};
const profileSummary = profile => `<div class="profile"><strong>${esc(profile.title || profile.url)}</strong><span class="meta">${esc(profile.kind)} page · ${count(profile.word_count)} readable words · ${profile.slots.length} recommended draft${profile.slots.length === 1 ? '' : 's'}</span><span class="meta">Topics: ${esc((profile.topics || []).join(', '))}</span>${profile.truncated ? '<p class="help"><strong>Large page handled safely:</strong> Conbal analyzed a bounded readable excerpt so the dashboard stays responsive. Review generated drafts against the live page.</p>' : ''}${profile.slots.length ? `<ul>${profile.slots.map(slot => `<li>${esc(slot.id)} · ${esc(slot.role)} · ${esc(slot.budget)}</li>`).join('')}</ul>` : '<p class="help">This page is too short or transactional for a useful insertion set.</p>'}</div>`;
let selectedSiteId = '';

async function copy(text) { try { await navigator.clipboard.writeText(text); say('Automatic integration code copied. Paste it once into your site.'); } catch { say('Could not copy automatically. Select the integration code and copy it manually.'); } }
async function load() {
  const sites = await api('/sites');
  if (!sites.some(site => site.id === selectedSiteId)) selectedSiteId = sites[0]?.id || '';
  if (!selectedSiteId) { $('#sites').innerHTML = '<p>Create a site to start adding balloons.</p>'; return; }
  const site = sites.find(item => item.id === selectedSiteId);
  const analytics = await api(`/analytics?site_id=${encodeURIComponent(site.id)}`), selected = analytics.selected_site;
  $('#sites').innerHTML = `<section class="site"><label>Your site <select id="site-picker">${sites.map(item => `<option value="${esc(item.id)}" ${item.id === site.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><h2>${esc(site.name)}</h2><section class="analytics" aria-label="Delivery activity"><h3>Delivery activity</h3><div class="metric-grid"><div><strong>${count(analytics.account.calls)}</strong><span>Account calls</span></div><div><strong>${count(selected.calls)}</strong><span>Selected-site calls</span></div><div><strong>${calledAt(selected.last_called_at)}</strong><span>Selected site last called</span></div></div><h4>All sites</h4><ul class="site-stats">${analytics.sites.map(item => `<li ${item.site_id === site.id ? 'aria-current="true"' : ''}><strong>${esc(item.name)}</strong><span>${count(item.calls)} calls · Last called: ${calledAt(item.last_called_at)}</span></li>`).join('')}</ul>${analytics.account.calls ? '' : '<p class="help">No delivery calls yet. Install the automatic script and publish a balloon to start tracking.</p>'}<p class="help">Each successfully returned published balloon counts once per public request. Totals are delivery calls, not unique people, and may include reloads, bots, and direct API clients.</p></section><p>Site key: <code>${esc(site.site_key)}</code></p><h3>Automatic site integration</h3><p class="help">Paste this once into your site. Conbal will analyze each page, choose safe locations, and request fresh content automatically.</p><pre><code>${esc(snippet(site.site_key))}</code></pre><button type="button" data-copy="${esc(site.site_key)}">Copy automatic install code</button><p class="help">The runtime skips short, transactional, and unsafe areas. Add <code>data-conbal-managed="true"</code> to a host root when the site already owns its own renderer.</p><section class="generation"><h3>Generate page-aware drafts</h3><p class="help">Analyze one public page first. Conbal recommends a number of useful slots from the readable content, then sends one batched generation request. Every result starts as a draft for your review; nothing publishes automatically.</p><button type="button" id="generate-page">Analyze a page</button><div id="generation-panel" hidden><label>Public page URL <input id="generation-page-url" type="url" placeholder="${esc(site.origin_url || 'https://example.com/page')}"></label><button type="button" id="analyze-page">Analyze page</button><div id="generation-profile"></div><button type="button" id="start-generation" disabled>Generate drafts</button><p id="generation-status" class="help" role="status"></p></div></section><button type="button" data-add="${esc(site.id)}">New balloon</button><button type="button" id="publish-all">Publish all drafts</button><button type="button" id="reindex-site">Rebuild delivery index</button><p class="help">Publish all drafts only after reviewing their visitor-facing copy. Rebuild the delivery index after a platform migration or if published content is missing from dynamic delivery.</p><section class="import"><h3>Import draft balloons</h3><p><a href="/admin/example-balloons.csv" download>Download the example CSV</a> · <a href="/admin/content-balloon-csv-llm-guide.md" download>Download the LLM generation guide</a></p><label>Content CSV file <input id="csv-file" type="file" accept=".csv,text/csv"></label><button type="button" id="import-csv" disabled>Import content CSV</button><p class="help">Rows are imported as drafts. Required columns: title, slug, size, html, css. Optional editorial metadata may be included with each row.</p></section><section class="import"><h3>Import editorial metadata</h3><p><a href="/admin/ibamboo-bamboo-facts-50-metadata.csv" download>Download the iBamboo metadata example</a></p><label>Metadata CSV file <input id="metadata-csv-file" type="file" accept=".csv,text/csv"></label><button type="button" id="import-metadata-csv" disabled>Import metadata CSV</button><p class="help">Match existing balloons by slug. Use the optional editorial type and comma-separated topic tags to make visitor-facing facts eligible for the right page slots.</p></section><div id="b-${esc(site.id)}"></div></section>`;
  await renderBalloons(site.id, selected.balloons);
  document.querySelectorAll('[data-add]').forEach(button => { button.onclick = () => editor(button.dataset.add); });
  document.querySelectorAll('[data-copy]').forEach(button => { button.onclick = () => copy(snippet(button.dataset.copy)); });
  $('#generate-page').onclick = () => openGeneration(site.id, site.origin_url);
  $('#analyze-page').onclick = () => analyzePage(site.id);
  $('#start-generation').onclick = () => generateFromPage(site.id);
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
  $(`#b-${siteId}`).innerHTML = balloons.map(balloon => { const stats = byId.get(balloon.id) || { calls: 0, last_called_at: null }; const provenance = balloon.generated_from ? `<span class="meta">Generated from <a href="${esc(balloon.generated_from)}" target="_blank" rel="noreferrer">${esc(balloon.generated_from)}</a> · review before publishing</span>` : ''; return `<div class="balloon"><strong>${esc(balloon.title)}</strong> — ${esc(balloon.slug)} (${esc(balloon.status)}) ${metadata(balloon)}${provenance}<span class="meta">Calls: ${count(stats.calls)} · Last called: ${calledAt(stats.last_called_at)}</span><button type="button" data-edit="${esc(balloon.id)}">Edit</button></div>`; }).join('') || '<p>No balloons yet. Create or import a draft to get started.</p>';
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
function openGeneration(siteId, originUrl = '') {
  const panel = $('#generation-panel');
  if (!panel) return;
  panel.hidden = false;
  const input = $('#generation-page-url');
  if (input && !input.value) input.value = originUrl || '';
  input?.focus();
}
async function analyzePage(siteId) {
  const input = $('#generation-page-url'), button = $('#analyze-page'), output = $('#generation-profile'), generate = $('#start-generation');
  if (!input?.value) return say('Enter the public page URL to analyze.');
  button.disabled = true; generate.disabled = true; output.innerHTML = '<p class="help">Reading the page structure…</p>';
  try { const result = await api(`/sites/${siteId}/page-profile`, { method: 'POST', body: JSON.stringify({ page_url: input.value.trim() }) }); output.innerHTML = profileSummary(result.profile); output.dataset.profileReady = 'true'; generate.disabled = !result.profile.slots.length; say(result.profile.slots.length ? `Page analyzed${result.profile.truncated ? ' from a bounded excerpt' : ''}. Review the plan, then generate drafts.` : 'Page analyzed, but it does not need a balloon yet.'); }
  catch (error) { output.innerHTML = ''; say(error.message); }
  finally { button.disabled = false; }
}
async function generateFromPage(siteId) {
  const input = $('#generation-page-url'), button = $('#start-generation'), output = $('#generation-status');
  if (!input?.value) return say('Enter and analyze a page first.');
  button.disabled = true; output.textContent = 'Starting a draft job…';
  try {
    const started = await api(`/sites/${siteId}/generation-jobs`, { method: 'POST', body: JSON.stringify({ page_url: input.value.trim() }) });
    output.textContent = 'Draft job is running. This never publishes automatically.';
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const job = await api(`/generation-jobs/${started.job_id}`);
      if (job.status === 'complete') { await load(); say(`Generated ${job.completed_count} draft balloon${job.completed_count === 1 ? '' : 's'}. Review and publish them when ready.`); return; }
      if (job.status === 'failed') throw new Error(job.error || 'Draft generation failed');
      output.textContent = job.status === 'running' ? 'Draft job is running…' : 'Draft job is queued…';
    }
    throw new Error('Draft generation is taking longer than expected. Check the dashboard again shortly.');
  } catch (error) { output.textContent = ''; say(error.message); button.disabled = false; }
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
  const button = $('#reindex-site'), controls = [...document.querySelectorAll('button, input, select, textarea')];
  controls.forEach(control => { control.disabled = true; });
  try {
    const result = await api(`/sites/${siteId}/balloons/reindex`, { method: 'POST' });
    if (result.skipped) throw new Error(`Indexed ${result.indexed} of ${result.total}; ${result.skipped} published balloon${result.skipped === 1 ? '' : 's'} need attention.`);
    if (selectedSiteId === siteId) say(`Delivery index rebuilt for ${result.indexed} published balloon${result.indexed === 1 ? '' : 's'}.`);
  } catch (error) { say(error.message); }
  finally { controls.filter(control => control.isConnected).forEach(control => { control.disabled = false; }); button.disabled = false; }
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
