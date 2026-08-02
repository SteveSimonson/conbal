const encoder = new TextEncoder();
const fixedSizes = new Set(['responsive', '300x250', '336x280', '728x90', '160x600', '320x100']);
const editorialTypes = new Set(['did_you_know', 'fun_fact', 'care_tip', 'design_note', 'material_myth', 'nature_note', 'culture_craft']);
const sampleLayouts = new Set(['inline', 'panel', 'product-card', 'banner', 'rail', 'fixed']);
const containerNativeLayouts = new Set(['inline', 'panel', 'product-card']);
const structuredRoles = new Set(['inline-note', 'section-break', 'grid-tile', 'aside-note']);
const structuredBudgets = new Map([
  ['compact-v1', { headline: 48, body: 110 }],
  ['standard-v1', { headline: 72, body: 180 }],
]);
const defaultEditorialType = 'did_you_know';
const defaultContext = 'general';
const maxImportBytes = 512000;
const maxImportRows = 100;
const maxImportRowChars = 75000;
const maxStructuredBytes = 32768;
const maxStructuredCandidatesPerSlot = 16;
const generationMaxPageBytes = 262144;
const generationMaxPageWords = 12000;
const generationMaxSourceUrls = 16;
const generationTimeoutMs = 6500;
const generationMaxRecentJobs = 20;
const generationRoles = ['inline-note', 'section-break', 'aside-note', 'grid-tile'];
const generationLabels = {
  did_you_know: 'Did you know?',
  fun_fact: 'Fun fact',
  care_tip: 'Care note',
  design_note: 'Design detail',
  material_myth: 'Material check',
  nature_note: 'From the source',
  culture_craft: 'Craft & culture',
};
const generationStopWords = new Set('a an and are as at be by for from how in is it of on or the this to with your you'.split(' '));
const json = (data, init = {}) => new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) } });
const fail = (error, status = 400) => json({ error }, { status });
const id = () => crypto.randomUUID();
const token = (bytes = 18) => { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); };

function generationFailure(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function sameOriginRequest(request, url) {
  for (const header of ['origin', 'referer']) {
    const value = request.headers.get(header);
    if (!value) continue;
    try { if (new URL(value).origin !== url.origin) return false; } catch { return false; }
  }
  return true;
}
function htmlEscape(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function canonicalOrigin(url) { return `${url.protocol}//${url.host}`; }
function privateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.includes(':')) return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && b >= 18 && b <= 19) || a >= 224;
}
function hostnameMatches(pageUrl, originUrl) {
  const pageHost = pageUrl.hostname.toLowerCase();
  const originHost = originUrl.hostname.toLowerCase();
  return pageHost === originHost || pageHost.endsWith(`.${originHost}`) || originHost === `www.${pageHost}`;
}
function validatePageUrl(value, site = null) {
  if (!(value instanceof URL) && (typeof value !== 'string' || value.length > 2048)) generationFailure('Enter a public page URL');
  let pageUrl;
  try { pageUrl = new URL(value.toString()); } catch { generationFailure('Enter a valid page URL'); }
  if (!['http:', 'https:'].includes(pageUrl.protocol) || pageUrl.username || pageUrl.password || pageUrl.hash || ![80, 443, 0].includes(Number(pageUrl.port)) || privateHostname(pageUrl.hostname)) generationFailure('Page URL must be a public HTTP(S) page');
  if (site?.origin_url) {
    let originUrl;
    try { originUrl = new URL(site.origin_url); } catch { generationFailure('This site has an invalid canonical URL; update it before generating'); }
    if (!hostnameMatches(pageUrl, originUrl)) generationFailure('Page URL must use this site’s registered hostname', 403);
  }
  pageUrl.hash = '';
  for (const key of [...pageUrl.searchParams.keys()]) if (/token|secret|password|passwd|api[_-]?key|auth|signature|code/i.test(key)) pageUrl.searchParams.delete(key);
  return pageUrl;
}
async function readLimitedResponse(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) generationFailure('Page returned an unreadable body', 502);
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); generationFailure('Page is too large to analyze', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
async function fetchPageHtml(pageUrl, site) {
  let current = validatePageUrl(pageUrl, site);
  for (let redirects = 0; redirects <= 2; redirects++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), generationTimeoutMs);
    let response;
    try {
      response = await fetch(current.toString(), { redirect: 'manual', signal: controller.signal, headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Conbal page analyzer/1.0' } });
    } catch (error) {
      clearTimeout(timeout);
      if (error?.name === 'AbortError') generationFailure('Page analysis timed out', 504);
      generationFailure('Page could not be fetched', 502);
    }
    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timeout);
      const location = response.headers.get('location');
      if (!location || redirects === 2) generationFailure('Page redirected too many times', 502);
      current = validatePageUrl(new URL(location, current).toString(), site);
      continue;
    }
    if (!response.ok) generationFailure(`Page returned HTTP ${response.status}`, 502);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) generationFailure('Page is not HTML', 415);
    try { return { url: current, html: await readLimitedResponse(response, generationMaxPageBytes) }; } finally { clearTimeout(timeout); }
  }
  generationFailure('Page could not be fetched', 502);
}
function tagContent(html, tag) {
  const match = String(html).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? storedText(match[1].replace(/<[^>]+>/g, ' ')) : '';
}
function attributeContent(html, name, content) {
  const pattern = new RegExp(`<meta\\b[^>]*(?:${name}\\s*=\\s*["']${content}["'][^>]*|${content}\\s*=\\s*["']${name}["'])[^>]*>`, 'i');
  const tag = String(html).match(pattern)?.[0] || '';
  return tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] || '';
}
function pageKindFromProfile(url, html) {
  const path = url.pathname.toLowerCase();
  if (/checkout|cart|account|admin|login/.test(path)) return 'blocked';
  if (/product|item|\bp\b/.test(path) || /itemtype\s*=\s*["'][^"']*product/i.test(html) || /data-product(?:-page)?/i.test(html)) return 'product';
  if (/blog|article|story|guide|news/.test(path) || /<article\b/i.test(html)) return 'article';
  if (/shop|collection|category|search/.test(path)) return 'shop';
  return 'page';
}
function generationTopics(url, kind, pageTitle, headings, meta) {
  const source = `${pageTitle} ${headings.join(' ')} ${meta} ${url.pathname}`.toLowerCase();
  const topics = [];
  for (const word of source.match(/[a-z][a-z0-9-]{2,47}/g) || []) {
    if (generationStopWords.has(word) || topics.includes(word)) continue;
    topics.push(word);
    if (topics.length === 5) break;
  }
  return [...new Set([kind, ...topics, defaultContext])].slice(0, 8);
}
function pageSourceUrls(pageUrl, html) {
  const urls = [pageUrl.toString()];
  const hrefs = [...String(html).matchAll(/<(?:a|link)\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  for (const href of hrefs) {
    if (urls.length >= generationMaxSourceUrls) break;
    try {
      const candidate = new URL(href, pageUrl);
      if (['http:', 'https:'].includes(candidate.protocol) && hostnameMatches(candidate, pageUrl)) { candidate.hash = ''; const value = candidate.toString(); if (!urls.includes(value)) urls.push(value); }
    } catch { /* ignore malformed links */ }
  }
  return urls;
}
function pageSlotsForProfile(wordCount, kind) {
  if (wordCount < 180 || kind === 'blocked') return [];
  const desired = Math.min(8, 1 + Math.floor(Math.max(0, wordCount - 180) / 360));
  return Array.from({ length: desired }, (_, index) => ({
    id: `auto-${index + 1}`,
    role: generationRoles[index % generationRoles.length],
    budget: index % 3 === 0 ? 'standard-v1' : 'compact-v1',
  }));
}
async function buildPageProfile(rawUrl, site) {
  const requested = validatePageUrl(rawUrl, site);
  const fetched = await fetchPageHtml(requested, { ...site, origin_url: site?.origin_url || canonicalOrigin(requested) });
  const parts = htmlParts(fetched.html);
  const title = tagContent(fetched.html, 'title') || parts.headings[0] || requested.hostname;
  const headings = parts.headings.slice(0, 12);
  const meta = [attributeContent(fetched.html, 'name', 'keywords'), attributeContent(fetched.html, 'property', 'article:section')].filter(Boolean).join(' ');
  const kind = pageKindFromProfile(fetched.url, fetched.html);
  const text = parts.all.slice(0, generationMaxPageWords * 8);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const slots = pageSlotsForProfile(wordCount, kind);
  const fingerprintBytes = await crypto.subtle.digest('SHA-256', encoder.encode(`${fetched.url}\u0000${title}\u0000${text.slice(0, 4000)}`));
  const fingerprint = Array.from(new Uint8Array(fingerprintBytes), byte => byte.toString(16).padStart(2, '0')).join('');
  return { url: fetched.url.toString(), origin: canonicalOrigin(fetched.url), title: title.slice(0, 200), kind, headings, topics: generationTopics(fetched.url, kind, title, headings, meta), word_count: wordCount, slots, source_urls: pageSourceUrls(fetched.url, fetched.html), excerpt: text.slice(0, 12000), fingerprint };
}
function publicPageProfile(profile) {
  return { url: profile.url, origin: profile.origin, title: profile.title, kind: profile.kind, headings: profile.headings, topics: profile.topics, word_count: profile.word_count, slots: profile.slots, source_urls: profile.source_urls, fingerprint: profile.fingerprint };
}

function cookies(request) { return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v[0])); }
async function body(request) { try { return await request.json(); } catch { throw Object.assign(new Error('Expected a JSON body'), { status: 400 }); } }
function importError(message, status = 400) { throw Object.assign(new Error(message), { status }); }
async function csvBody(request) {
  const contentLength=Number(request.headers.get('content-length') || 0); if(contentLength>maxImportBytes) importError('CSV file is too large',413);
  const contentType=(request.headers.get('content-type') || '').split(';',1)[0].trim().toLowerCase(); let csv;
  if(contentType==='text/csv'){ csv=await request.text(); }
  else if(contentType==='application/json'){ const data=await body(request); csv=data?.csv; }
  else importError('Use text/csv or JSON with a csv field',415);
  if(typeof csv!=='string') importError('Expected a CSV string'); if(new TextEncoder().encode(csv).byteLength>maxImportBytes) importError('CSV file is too large',413); return csv;
}
function parseCsv(csv) {
  const rows=[]; let row=[], field='', quoted=false, quoteClosed=false, endedWithNewline=false;
  for(let i=0;i<csv.length;i++) { const char=csv[i];
    if(quoted) { if(char==='"') { if(csv[i+1]==='"'){field+='"';i++;} else {quoted=false;quoteClosed=true;} } else field+=char; endedWithNewline=false; continue; }
    if(quoteClosed&&char!==','&&char!=='\n'&&char!=='\r') importError(`Malformed CSV near character ${i+1}`);
    if(char==='"') { if(field||quoteClosed) importError(`Malformed CSV near character ${i+1}`); quoted=true; endedWithNewline=false; continue; }
    if(char===',') { row.push(field); field=''; quoteClosed=false; endedWithNewline=false; continue; }
    if(char==='\n'||char==='\r') { if(char==='\r'&&csv[i+1]==='\n')i++; row.push(field); rows.push(row); row=[]; field=''; quoteClosed=false; endedWithNewline=true; continue; }
    field+=char; endedWithNewline=false;
  }
  if(quoted) importError('CSV contains an unterminated quoted field'); if(!endedWithNewline||field||row.length){row.push(field);rows.push(row);} return rows;
}
function csvImportRows(csv) {
  const rows=parseCsv(csv); if(!rows.length) importError('CSV must include a header row'); const headers=rows.shift().map((value,index)=>(index===0?value.replace(/^\uFEFF/,''):value).trim().toLowerCase());
  const required=['title','slug','size','html','css']; const indexes={}; for(const name of required){const index=headers.indexOf(name);if(index<0)importError(`CSV is missing required ${name} column`);if(headers.indexOf(name,index+1)>=0)importError(`CSV contains duplicate ${name} columns`);indexes[name]=index;}
  const optional=['editorial_type','topics']; for(const name of optional){const index=headers.indexOf(name);if(index>=0&&headers.indexOf(name,index+1)>=0)importError(`CSV contains duplicate ${name} columns`);indexes[name]=index;}
  if(rows.length>maxImportRows) importError(`CSV may contain at most ${maxImportRows} balloon rows`,413); const slugs=new Set(); const balloons=[];
  rows.forEach((row,rowIndex)=>{const number=rowIndex+2;if(row.join('').length>maxImportRowChars)importError(`Row ${number}: row is too large`,413);if(row.length>headers.length)importError(`Row ${number}: has more columns than the header`);const data=Object.fromEntries([...required,...optional].map(name=>[name,indexes[name]>=0?(row[indexes[name]] ?? ''):undefined]));let balloon;try{balloon=cleanBalloon(data);}catch(error){importError(`Row ${number}: ${error.message}`);}if(slugs.has(balloon.slug))importError(`Row ${number}: duplicate slug "${balloon.slug}" in this file`);slugs.add(balloon.slug);balloons.push({...balloon,sourceRow:number});});
  if(!balloons.length) importError('CSV must include at least one balloon row'); return balloons;
}
function csvMetadataRows(csv) {
  const rows=parseCsv(csv); if(!rows.length) importError('CSV must include a header row'); const headers=rows.shift().map((value,index)=>(index===0?value.replace(/^\uFEFF/,''):value).trim().toLowerCase());
  const required=['slug','editorial_type','topics']; const indexes={}; for(const name of required){const index=headers.indexOf(name);if(index<0)importError(`CSV is missing required ${name} column`);if(headers.indexOf(name,index+1)>=0)importError(`CSV contains duplicate ${name} columns`);indexes[name]=index;}
  if(rows.length>maxImportRows) importError(`CSV may contain at most ${maxImportRows} balloon rows`,413); const slugs=new Set(); const metadata=[];
  rows.forEach((row,rowIndex)=>{const number=rowIndex+2;if(row.join('').length>maxImportRowChars)importError(`Row ${number}: row is too large`,413);if(row.length>headers.length)importError(`Row ${number}: has more columns than the header`);const slug=row[indexes.slug] ?? '', editorialType=row[indexes.editorial_type], topics=row[indexes.topics];let values;try{if(!validSlug(slug))throw new Error('Invalid balloon slug');if(typeof editorialType!=='string'||!editorialType.trim()||typeof topics!=='string'||!topics.trim())throw new Error('Metadata values are required');values={slug,editorial_type:cleanEditorialType(editorialType),topics:cleanTopics(topics)};}catch(error){importError(`Row ${number}: ${error.message}`);}if(slugs.has(values.slug))importError(`Row ${number}: duplicate slug "${values.slug}" in this file`);slugs.add(values.slug);metadata.push({...values,sourceRow:number});});
  if(!metadata.length) importError('CSV must include at least one balloon row'); return metadata;
}
function validEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validSlug(slug) { return typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug); }
function validSiteKey(siteKey) { return typeof siteKey === 'string' && /^[A-Za-z0-9_-]{12}$/.test(siteKey); }
function validMetadataToken(value) { return typeof value === 'string' && /^[a-z0-9-]{1,48}$/.test(value); }
function isGoogleConflict(error) { return /UNIQUE constraint failed: users\.(email|google_id)/i.test(String(error?.message || error)); }
function isBalloonSlugConflict(error) { return /UNIQUE constraint failed: balloons\.site_id, balloons\.slug/i.test(String(error?.message || error)); }
function cookie(value, age = 0) { return `conbal_session=${encodeURIComponent(value || '')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
function oauthStateCookie(value, age = 0) { return `conbal_oauth_state=${encodeURIComponent(value || '')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
function googleCallbackUrl(url) { return ['localhost', '127.0.0.1'].includes(url.hostname) ? `${url.origin}/api/auth/google/callback` : 'https://conbal.us/api/auth/google/callback'; }
async function session(request, env) { const value = cookies(request).conbal_session; if (!value) return null; const data = await env.CONBAL_KV.get(`s:${value}`, 'json'); if (!data) return null; await env.CONBAL_KV.put(`s:${value}`, JSON.stringify(data), { expirationTtl: 604800 }); return data; }
async function requireUser(request, env) { const s = await session(request, env); if (!s) throw Object.assign(new Error('Login required'), { status: 401 }); return s; }
async function ownerSite(env, user, siteId) { const site = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND user_id=?').bind(siteId, user.id).first(); if (!site) throw Object.assign(new Error('Site not found'), { status: 404 }); return site; }
async function ownerBalloon(env, user, balloonId) { const balloon = await env.DB.prepare('SELECT b.*, s.site_key FROM balloons b JOIN sites s ON s.id=b.site_id WHERE b.id=? AND s.user_id=?').bind(balloonId, user.id).first(); if (!balloon) throw Object.assign(new Error('Balloon not found'), { status: 404 }); return balloon; }
function cleanBalloon(data) {
  const { title, slug, html, css = '', size = 'responsive', editorial_type, topics } = data;
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || !validSlug(slug) || typeof html !== 'string' || html.length > 50000 || typeof css !== 'string' || css.length > 20000 || !fixedSizes.has(size)) throw new Error('Invalid balloon fields');
  return { title: title.trim(), slug, html, css, size, editorial_type: cleanEditorialType(editorial_type), topics: cleanTopics(topics) };
}
function cleanEditorialType(value) { const editorialType=value==null||value===''?defaultEditorialType:String(value).trim(); if(!editorialTypes.has(editorialType))throw new Error('Invalid editorial type'); return editorialType; }
function cleanTopics(value) { const raw=value==null||value===''?defaultContext:String(value).trim(); const topics=[...new Set(raw.split(',').map(item=>item.trim()).filter(Boolean))]; if(!topics.length||topics.length>8||!topics.every(validMetadataToken))throw new Error('Invalid balloon topics'); return topics.join(','); }
async function publish(env, balloon) {
  const key = `b:${balloon.site_key}:${balloon.slug}`;
  await env.CONBAL_KV.put(key, JSON.stringify({ balloonId: balloon.id, html: balloon.html, css: balloon.css, size: balloon.size, editorial_type: balloon.editorial_type || defaultEditorialType, topics: balloon.topics || defaultContext }));
  const copy=structuredCopy(balloon,'standard-v1');
  await env.DB.prepare('DELETE FROM smart_delivery_items WHERE balloon_id=?').bind(balloon.id).run();
  if(copy.headline&&copy.body){const topics=String(balloon.topics||defaultContext).split(',').map(topic=>topic.trim()).filter(validMetadataToken);await env.DB.batch(topics.map(topic=>env.DB.prepare('INSERT INTO smart_delivery_items (balloon_id,site_key,slug,editorial_type,topic,headline,body) VALUES (?,?,?,?,?,?,?)').bind(balloon.id,balloon.site_key,balloon.slug,balloon.editorial_type||defaultEditorialType,topic,copy.headline,copy.body)));return true;}
  return false;
}
const reindexSnapshotFields = ['slug','title','html','css','size','editorial_type','topics'];
function reindexGuard(balloon) {
  const sql=`EXISTS (SELECT 1 FROM balloons WHERE id=? AND site_id=? AND status='published' AND ${reindexSnapshotFields.map(field=>`${field} IS ?`).join(' AND ')})`;
  return {sql,args:[balloon.id,balloon.site_id,...reindexSnapshotFields.map(field=>balloon[field]??null)]};
}
async function reindexSnapshot(env,site,balloon) {
  const copy=structuredCopy(balloon,'standard-v1'),topics=String(balloon.topics||defaultContext).split(',').map(topic=>topic.trim()).filter(validMetadataToken),guard=reindexGuard(balloon);
  const statements=[env.DB.prepare(`DELETE FROM smart_delivery_items WHERE balloon_id=? AND ${guard.sql}`).bind(balloon.id,...guard.args)];
  if(copy.headline&&copy.body)for(const topic of topics)statements.push(env.DB.prepare(`INSERT INTO smart_delivery_items (balloon_id,site_key,slug,editorial_type,topic,headline,body) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(balloon.id,site.site_key,balloon.slug,balloon.editorial_type||defaultEditorialType,topic,copy.headline,copy.body,...guard.args));
  const results=await env.DB.batch(statements),changed=results.reduce((total,result)=>total+Number(result?.meta?.changes??result?.changes??0),0);
  return {applied:changed>0,indexed:Boolean(copy.headline&&copy.body&&topics.length)};
}
async function reindexPublishedBalloon(env,site,balloonId) {
  for(let attempt=0;attempt<3;attempt++){
    const balloon=await env.DB.prepare('SELECT * FROM balloons WHERE id=? AND site_id=?').bind(balloonId,site.id).first();
    if(!balloon||balloon.status!=='published')return false;
    const result=await reindexSnapshot(env,site,balloon);
    if(result.applied)return result.indexed;
  }
  return false;
}
async function createSession(env, user) { const value=token(16); await env.CONBAL_KV.put(`s:${value}`,JSON.stringify({id:user.id,email:user.email}),{expirationTtl:604800}); return value; }
async function googleAuth(request, env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail('Google login is not configured yet', 503);
  const callback=googleCallbackUrl(url);
  if (url.pathname === '/api/auth/google') {
    const inviteCode=request.method==='POST' ? (await body(request)).inviteCode : null;
    const state=token(24), inviteAuthorized=!env.SIGNUP_INVITE_CODE||inviteCode===env.SIGNUP_INVITE_CODE;
    await env.CONBAL_KV.put(`oauth:${state}`,JSON.stringify({inviteAuthorized}),{expirationTtl:600});
    const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callback,response_type:'code',scope:'openid email profile',state,prompt:'select_account'});
    const headers={'set-cookie':oauthStateCookie(state,600)};
    return request.method==='POST' ? json({location:auth.toString()},{headers}) : new Response(null,{status:302,headers:{...headers,location:auth.toString()}});
  }
  const code=url.searchParams.get('code'), state=url.searchParams.get('state'), expectedState=cookies(request).conbal_oauth_state;
  const oauthState=!code||!state||!expectedState||state!==expectedState?null:await env.CONBAL_KV.get(`oauth:${state}`,'json'); if(!oauthState) return fail('Google login expired or was invalid',400); await env.CONBAL_KV.delete(`oauth:${state}`);
  const tokens=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:callback,grant_type:'authorization_code'})}); if(!tokens.ok)return fail('Google could not complete sign-in',502);
  let tokenData; try { tokenData=await tokens.json(); } catch { return fail('Google returned an invalid sign-in response',502); } if(typeof tokenData.access_token!=='string'||!tokenData.access_token)return fail('Google returned an invalid sign-in response',502);
  const profileResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${tokenData.access_token}`}}); if(!profileResponse.ok)return fail('Google could not retrieve your profile',502); let profile; try { profile=await profileResponse.json(); } catch { return fail('Google returned an invalid profile',502); }
  const email=typeof profile.email==='string' ? profile.email.trim().toLowerCase() : ''; if(typeof profile.sub!=='string'||!profile.sub||!validEmail(email)||profile.email_verified!==true)return fail('Google did not provide a verified email',403);
  let user=await env.DB.prepare('SELECT id,email FROM users WHERE google_id=?').bind(profile.sub).first();
  if(!user){
    const existing=await env.DB.prepare('SELECT id,email,google_id FROM users WHERE email=?').bind(email).first();
    if(existing?.google_id && existing.google_id!==profile.sub)return fail('This email is linked to another Google account',409);
    if(existing){
      await env.DB.prepare('UPDATE users SET google_id=? WHERE id=? AND google_id IS NULL').bind(profile.sub,existing.id).run();
      user=await env.DB.prepare('SELECT id,email FROM users WHERE google_id=?').bind(profile.sub).first();
      if(!user)return fail('Your Google account could not be linked; please try again',409);
    } else {
      if(!oauthState.inviteAuthorized)return fail('A valid invite code is required',403);
      user={id:id(),email};
      try{await env.DB.prepare('INSERT INTO users (id,email,password_hash,google_id) VALUES (?,?,?,?)').bind(user.id,user.email,`google:${token(24)}`,profile.sub).run()}catch(error){if(isGoogleConflict(error))return fail('Your Google account could not be linked; please try again',409);throw error;}
    }
  }
  const s=await createSession(env,user); const headers=new Headers({location:`${new URL(callback).origin}/admin/`}); headers.append('set-cookie',cookie(s,604800)); headers.append('set-cookie',oauthStateCookie('',0)); return new Response(null,{status:302,headers});
}

async function recordDeliveries(env, siteKey, delivered) {
  const ids = new Set(delivered.map(item => item.value.balloonId).filter(value => typeof value === 'string' && value));
  const legacy = delivered.filter(item => !item.value.balloonId);
  if (legacy.length) {
    const placeholders=legacy.map(() => '?').join(',');
    const rows=(await env.DB.prepare(`SELECT b.id,b.slug FROM balloons b JOIN sites s ON s.id=b.site_id WHERE s.site_key=? AND b.slug IN (${placeholders})`).bind(siteKey,...legacy.map(item=>item.slug)).all()).results;
    const bySlug=new Map(rows.map(row=>[row.slug,row.id]));
    await Promise.all(legacy.map(item=>{const balloonId=bySlug.get(item.slug);if(!balloonId)return null;ids.add(balloonId);return env.CONBAL_KV.put(`b:${siteKey}:${item.slug}`,JSON.stringify({...item.value,balloonId}));}));
  }
  if (!ids.size) return;
  const values=[...ids]; const placeholders=values.map(()=>'(?)').join(',');
  await env.DB.prepare(`WITH delivered(balloon_id) AS (VALUES ${placeholders}) INSERT INTO balloon_delivery_counts (balloon_id,delivery_count,updated_at) SELECT delivered.balloon_id,1,strftime('%Y-%m-%dT%H:%M:%SZ','now') FROM delivered JOIN balloons ON balloons.id=delivered.balloon_id WHERE 1 ON CONFLICT(balloon_id) DO UPDATE SET delivery_count=balloon_delivery_counts.delivery_count+1,updated_at=excluded.updated_at`).bind(...values).run();
}
async function analytics(env, user, selectedSiteId) {
  let selectedSite=null;
  if(selectedSiteId) selectedSite=await ownerSite(env,user,selectedSiteId);
  const sites=(await env.DB.prepare("SELECT s.id AS site_id,s.name,COALESCE(SUM(c.delivery_count),0) AS calls,MAX(c.updated_at) AS last_called_at FROM sites s LEFT JOIN balloons b ON b.site_id=s.id LEFT JOIN balloon_delivery_counts c ON c.balloon_id=b.id WHERE s.user_id=? GROUP BY s.id,s.name ORDER BY s.created_at DESC").bind(user.id).all()).results.map(site=>({...site,calls:Number(site.calls)||0}));
  const account={calls:sites.reduce((sum,site)=>sum+site.calls,0),last_called_at:sites.map(site=>site.last_called_at).filter(Boolean).sort().at(-1)||null};
  if(!selectedSite)return {account,sites,selected_site:null};
  const balloons=(await env.DB.prepare("SELECT b.id AS balloon_id,b.slug,COALESCE(c.delivery_count,0) AS calls,c.updated_at AS last_called_at FROM balloons b LEFT JOIN balloon_delivery_counts c ON c.balloon_id=b.id WHERE b.site_id=? ORDER BY b.updated_at DESC").bind(selectedSite.id).all()).results.map(balloon=>({...balloon,calls:Number(balloon.calls)||0}));
  const site=sites.find(item=>item.site_id===selectedSite.id)||{site_id:selectedSite.id,name:selectedSite.name,calls:0,last_called_at:null};
  return {account,sites,selected_site:{...site,balloons}};
}

function randomIndex(max) {
  const upperBound=0x100000000-(0x100000000%max); const value=new Uint32Array(1);
  do { crypto.getRandomValues(value); } while(value[0]>=upperBound);
  return value[0]%max;
}
function randomOrder(items) { const ordered=[...items]; for(let index=ordered.length-1;index>0;index--){const swap=randomIndex(index+1);[ordered[index],ordered[swap]]=[ordered[swap],ordered[index]];} return ordered; }
function sampleExcludes(url) {
  const raw=url.searchParams.get('exclude_slugs');
  if(raw===null)return new Set();
  const slugs=raw.split(',');
  if(!slugs.length||slugs.length>30||slugs.some(slug=>!validSlug(slug)))importError('Invalid sample excludes');
  return new Set(slugs);
}
function sampleRequest(url) {
  const raw=url.searchParams.get('slots'); if(!raw||raw.length>4096) importError('Invalid sample slots'); let slots;
  try { slots=JSON.parse(raw); } catch { importError('Invalid sample slots'); }
  if(!Array.isArray(slots)||slots.length<1||slots.length>8)importError('Sample requests need 1 to 8 slots');
  const ids=new Set(); const cleaned=slots.map(slot=>{
    if(!slot||typeof slot!=='object'||Array.isArray(slot)||typeof slot.id!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(slot.id)||ids.has(slot.id)||!fixedSizes.has(slot.size)||!Array.isArray(slot.topics)||slot.topics.length<1||slot.topics.length>8||!Array.isArray(slot.editorial_types)||slot.editorial_types.length<1||slot.editorial_types.length>editorialTypes.size)importError('Invalid sample slot');
    const topics=[...new Set(slot.topics)]; const types=[...new Set(slot.editorial_types)]; const layout=slot.layout;
    if(!topics.every(validMetadataToken)||!types.every(type=>editorialTypes.has(type))||(layout!==undefined&&!sampleLayouts.has(layout))||(layout!==undefined&&containerNativeLayouts.has(layout)&&slot.size!=='responsive'))importError('Invalid sample slot');
    ids.add(slot.id); return {id:slot.id,size:slot.size,topics,editorial_types:types,...(layout===undefined?{}:{layout})};
  });
  const nonce=url.searchParams.get('nonce'); if(nonce!==null&&(!/^[A-Za-z0-9_-]{1,128}$/.test(nonce)))importError('Invalid sample nonce');
  return {slots:cleaned,excludedSlugs:sampleExcludes(url)};
}
async function sampleCandidates(env, siteKey, slot) {
  const placeholders=slot.editorial_types.map(()=>'?').join(',');
  return (await env.DB.prepare(`SELECT b.id,b.slug,b.size,b.editorial_type,b.topics FROM balloons b JOIN sites s ON s.id=b.site_id WHERE s.site_key=? AND b.status='published' AND b.size=? AND b.editorial_type IN (${placeholders})`).bind(siteKey,slot.size,...slot.editorial_types).all()).results;
}
function matchesTopics(candidate, topics) { const candidateTopics=String(candidate.topics||defaultContext).split(','); return topics.some(topic=>candidateTopics.includes(topic)); }
async function sampleDelivery(request, env, url, context, siteKey) {
  if(request.method!=='GET')return fail('Method not allowed',405);
  const {slots,excludedSlugs}=sampleRequest(url), selectedIds=new Set(), delivered=[], output=Object.create(null);
  for(const slot of slots){
    const candidates=await sampleCandidates(env,siteKey,slot);
    const contextual=candidates.filter(candidate=>!selectedIds.has(candidate.id)&&matchesTopics(candidate,slot.topics));
    const fallback=candidates.filter(candidate=>!selectedIds.has(candidate.id)&&!contextual.some(item=>item.id===candidate.id)&&matchesTopics(candidate,[defaultContext]));
    let selected=null, value=null;
    const available=[
      ...randomOrder(contextual.filter(candidate=>!excludedSlugs.has(candidate.slug))),
      ...randomOrder(fallback.filter(candidate=>!excludedSlugs.has(candidate.slug))),
      ...randomOrder(contextual.filter(candidate=>excludedSlugs.has(candidate.slug))),
      ...randomOrder(fallback.filter(candidate=>excludedSlugs.has(candidate.slug))),
    ];
    for(const candidate of available){
      const payload=await env.CONBAL_KV.get(`b:${siteKey}:${candidate.slug}`,'json');
      if(!payload||payload.size!==candidate.size)continue;
      selected=candidate; value=payload; break;
    }
    if(!selected||!value)continue;
    selectedIds.add(selected.id); delivered.push({slug:selected.slug,value}); output[slot.id]={slug:selected.slug,size:selected.size,editorial_type:selected.editorial_type,html:value.html,css:value.css||'',...(slot.layout===undefined?{}:{layout:slot.layout})};
  }
  if(delivered.length){const work=recordDeliveries(env,siteKey,delivered).catch(error=>console.error('delivery counter failed',error));if(context?.waitUntil)context.waitUntil(work);else await work;}
  return json({slots:output},{headers:{'access-control-allow-origin':'*','cache-control':'no-store, max-age=0'}});
}
function plainObject(value) { return Boolean(value)&&typeof value==='object'&&!Array.isArray(value); }
function exactKeys(value, allowed) { return Object.keys(value).every(key=>allowed.has(key)); }
async function structuredJsonBody(request) {
  const contentLength=Number(request.headers.get('content-length')||0);
  if(contentLength>maxStructuredBytes)importError('Smart-delivery request is too large',413);
  const reader=request.body?.getReader();if(!reader)importError('Expected a JSON body');
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxStructuredBytes){await reader.cancel();importError('Smart-delivery request is too large',413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder().decode(bytes);
  try{return JSON.parse(text);}catch{importError('Expected a JSON body');}
}
function structuredRequest(data) {
  if(!plainObject(data)||!exactKeys(data,new Set(['contract','page_view_id','repeat_policy','exclude_slugs','slots']))||data.contract!=='2.0'||typeof data.page_view_id!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(data.page_view_id)||data.repeat_policy!=='omit'||!Array.isArray(data.slots)||data.slots.length<1||data.slots.length>8)importError('Invalid smart-delivery request');
  const excluded=data.exclude_slugs===undefined?[]:data.exclude_slugs;
  if(!Array.isArray(excluded)||excluded.length>30||excluded.some(slug=>!validSlug(slug))||new Set(excluded).size!==excluded.length)importError('Invalid excluded slugs');
  const ids=new Set();
  const slots=data.slots.map(slot=>{
    if(!plainObject(slot)||!exactKeys(slot,new Set(['id','role','topics','editorial_types','budget']))||typeof slot.id!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(slot.id)||ids.has(slot.id)||!structuredRoles.has(slot.role)||!structuredBudgets.has(slot.budget))importError('Invalid smart-delivery slot');
    if(!Array.isArray(slot.topics)||slot.topics.length<1||slot.topics.length>8||!slot.topics.every(validMetadataToken)||!Array.isArray(slot.editorial_types)||slot.editorial_types.length<1||slot.editorial_types.length>editorialTypes.size||!slot.editorial_types.every(type=>editorialTypes.has(type)))importError('Invalid smart-delivery slot');
    const topics=[...new Set(slot.topics)], types=[...new Set(slot.editorial_types)];
    if(topics.length!==slot.topics.length||types.length!==slot.editorial_types.length)importError('Invalid smart-delivery slot');
    ids.add(slot.id);
    return {id:slot.id,role:slot.role,topics,editorial_types:types,budget:slot.budget};
  });
  return {contract:data.contract,pageViewId:data.page_view_id,repeatPolicy:data.repeat_policy,excludedSlugs:new Set(excluded),slots};
}
function decodeEntities(value) {
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…'};
  return value.replace(/&(?:#(x[0-9a-f]+|\d+)|([a-z][a-z0-9]+));/gi,(entity,numeric,name)=>{
    if(name)return named[name.toLowerCase()]??entity;
    const code=numeric[0].toLowerCase()==='x'?Number.parseInt(numeric.slice(1),16):Number.parseInt(numeric,10);
    return Number.isInteger(code)&&code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'�';
  });
}
function htmlParts(value) {
  const source=String(value||''), unsafe=new Set(['script','style','noscript','template','svg']), rawText=new Set(['script','style']), captures=new Set(['p','span','div','strong','h1','h2','h3','h4','h5','h6']);
  const stack=[], headings=[], strong=[], bodies=[], visible=[];
  const clean=text=>decodeEntities(text).replace(/\s+/g,' ').trim();
  const finish=frame=>{const text=clean(frame.text);if(!text)return;if(/^h[1-6]$/.test(frame.name))headings.push(text);else if(frame.name==='strong')strong.push(text);else if(['p','span','div'].includes(frame.name))bodies.push(text);};
  for(let index=0;index<source.length;){
    if(source.startsWith('<!--',index)){const end=source.indexOf('-->',index+4);index=end<0?source.length:end+3;continue;}
    if(source[index]!=='<'){
      const end=source.indexOf('<',index), raw=source.slice(index,end<0?source.length:end);
      if(!stack.some(frame=>frame.unsafe)){visible.push(raw);for(const frame of stack)if(captures.has(frame.name))frame.text+=` ${raw}`;}
      index=end<0?source.length:end;continue;
    }
    let quote='', end=index+1;
    for(;end<source.length;end++){const char=source[end];if(quote){if(char===quote)quote='';continue;}if(char==='"'||char==="'"){quote=char;continue;}if(char==='>')break;}
    if(end>=source.length)break;
    const raw=source.slice(index+1,end).trim(), closing=raw.startsWith('/'), match=raw.match(/^\/?\s*([a-z][a-z0-9-]*)/i), name=match?.[1]?.toLowerCase();
    index=end+1;if(!name)continue;
    if(!closing&&unsafe.has(name)){
      if(rawText.has(name)){const close=new RegExp(`<\\/\\s*${name}\\s*>`,'ig');close.lastIndex=index;const found=close.exec(source);index=found?close.lastIndex:source.length;continue;}
      let depth=1,cursor=index;
      while(depth>0&&cursor<source.length){const open=source.indexOf('<',cursor);if(open<0){cursor=source.length;break;}if(source.startsWith('<!--',open)){const commentEnd=source.indexOf('-->',open+4);cursor=commentEnd<0?source.length:commentEnd+3;continue;}let nestedQuote='',nestedEnd=open+1;for(;nestedEnd<source.length;nestedEnd++){const char=source[nestedEnd];if(nestedQuote){if(char===nestedQuote)nestedQuote='';continue;}if(char==='"'||char==="'"){nestedQuote=char;continue;}if(char==='>')break;}if(nestedEnd>=source.length){cursor=source.length;break;}const nestedRaw=source.slice(open+1,nestedEnd).trim(),nestedClosing=nestedRaw.startsWith('/'),nestedName=nestedRaw.match(/^\/?\s*([a-z][a-z0-9-]*)/i)?.[1]?.toLowerCase();if(nestedName===name){if(nestedClosing)depth--;else if(!nestedRaw.endsWith('/'))depth++;}cursor=nestedEnd+1;}
      index=cursor;continue;
    }
    if(closing){
      const at=stack.map(frame=>frame.name).lastIndexOf(name);if(at<0)continue;
      const removed=stack.splice(at);for(const frame of removed.reverse())finish(frame);continue;
    }
    if(name==='br'||name==='hr'){visible.push(' ');for(const frame of stack)if(captures.has(frame.name))frame.text+=' ';continue;}
    if(!raw.endsWith('/'))stack.push({name,text:'',unsafe:false});
  }
  for(const frame of stack.reverse())finish(frame);
  return {all:clean(visible.join(' ')),bodies,headings,strong};
}
function htmlText(value) { return htmlParts(value).all; }
function storedText(value) { return decodeEntities(String(value||'')).replace(/\s+/g,' ').trim(); }
function structuredCopy(candidate, budgetName) {
  const budget=structuredBudgets.get(budgetName);
  const limit=(text,max)=>text.slice(0,max).replace(/[\uD800-\uDBFF]$/,'').trim();
  if(typeof candidate.headline==='string'&&typeof candidate.body==='string')return {headline:limit(candidate.headline,budget.headline),body:limit(candidate.body,budget.body)};
  const parts=htmlParts(candidate.html), headline=parts.headings[0]||parts.strong[0]||storedText(candidate.title), fragments=parts.bodies
    .filter(text=>text&&text!==headline&&!text.includes(headline)&&!/^(?:\d{1,3}|iB|竹)$/i.test(text)&&!/^(?:(?:iBamboo\s+)?field note|field guide\s*\/\s*iBamboo|bamboo fact(?:\s*[·/]\s*\d+)?)$/i.test(text)), bodyText=fragments.filter(text=>text.length>=12).sort((left,right)=>right.length-left.length)[0]||'';
  return {headline:limit(headline,budget.headline),body:limit(bodyText,budget.body)};
}
function generatedSchema() {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slot_id: { type: 'string' },
            headline: { type: 'string' },
            body: { type: 'string' },
            editorial_type: { type: 'string', enum: [...editorialTypes] },
            topics: { type: 'array', items: { type: 'string' } },
            source_urls: { type: 'array', items: { type: 'string' } },
          },
          required: ['slot_id', 'headline', 'body', 'editorial_type', 'topics', 'source_urls'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  };
}
function generationPrompt(profile) {
  const slotBrief = profile.slots.map(slot => `${slot.id}: ${slot.role}, ${slot.budget}`).join('; ');
  const sourceList = profile.source_urls.map((url, index) => `${index + 1}. ${url}`).join('\n');
  return `Create exactly one visitor-facing content balloon draft for each requested slot. These are helpful facts or practical notes that belong on the page, not advertisements. Never mention Conbal, content balloons, prompts, AI, implementation, or this instruction. Do not invent claims beyond the page excerpt; if a claim is uncertain, make the note a careful observation or a tip. Use concise, plain language and avoid repeating the page title. Return one item for every slot ID, with the slot IDs unchanged. Use only source URLs from the allowed list; if the page itself is the only source, cite that page URL.\n\nPage title: ${profile.title}\nPage kind: ${profile.kind}\nPage topics: ${profile.topics.join(', ')}\nRequested slots: ${slotBrief}\nAllowed source URLs:\n${sourceList}\n\nPage excerpt:\n${profile.excerpt}`;
}
async function generateWithOpenAI(env, profile) {
  if (!env.OPENAI_API_KEY) generationFailure('Page-aware generation is not configured. Add the OPENAI_API_KEY Worker secret.', 503);
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: Math.max(900, profile.slots.length * 260),
      input: [
        { role: 'system', content: 'You are a careful editorial assistant. Produce structured JSON only.' },
        { role: 'user', content: generationPrompt(profile) },
      ],
      text: { format: { type: 'json_schema', name: 'conbal_page_balloons', schema: generatedSchema(), strict: true } },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('OpenAI generation failed', response.status, detail.slice(0, 500));
    generationFailure('The content generator could not complete this draft job', 502);
  }
  let result;
  try { result = await response.json(); } catch { generationFailure('The content generator returned invalid JSON', 502); }
  if (result.status === 'incomplete') generationFailure('The content generator stopped before completing the draft job', 502);
  if (typeof result.output_text !== 'string' || !result.output_text.trim()) generationFailure('The content generator returned no draft content', 502);
  let parsed;
  try { parsed = JSON.parse(result.output_text); } catch { generationFailure('The content generator returned malformed draft JSON', 502); }
  return { model, items: parsed?.items };
}
function generatedSlug(value, jobId, index) {
  const base = String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'page-note';
  return `${base}-${jobId.slice(0, 8)}-${index + 1}`.slice(0, 80);
}
function validateGeneratedItems(items, profile) {
  if (!Array.isArray(items) || items.length !== profile.slots.length) generationFailure('The content generator returned the wrong number of drafts', 502);
  const slots = new Map(profile.slots.map(slot => [slot.id, slot]));
  const allowedSources = new Set(profile.source_urls);
  const seenSlots = new Set(); const seenCopy = new Set(); const cleaned = [];
  for (const item of items) {
    if (!plainObject(item) || !['slot_id', 'headline', 'body', 'editorial_type', 'topics', 'source_urls'].every(key => Object.hasOwn(item, key))) generationFailure('The content generator returned an invalid draft shape', 502);
    const slot = slots.get(item.slot_id);
    if (!slot || seenSlots.has(item.slot_id)) generationFailure('The content generator returned invalid slot assignments', 502);
    if (typeof item.headline !== 'string' || typeof item.body !== 'string' || !item.headline.trim() || !item.body.trim() || item.headline.length > structuredBudgets.get(slot.budget).headline || item.body.length > structuredBudgets.get(slot.budget).body) generationFailure('The content generator exceeded a copy budget', 502);
    if (/\bconbal\b|content balloon|implementation|prompt|artificial intelligence|\bai\b/i.test(`${item.headline} ${item.body}`) || /<[^>]+>/.test(`${item.headline} ${item.body}`)) generationFailure('The content generator returned implementation-facing copy', 502);
    const topics = [...new Set(Array.isArray(item.topics) ? item.topics.map(value => String(value).trim().toLowerCase()).filter(Boolean) : [])];
    if (!topics.length || topics.length > 8 || !topics.every(validMetadataToken)) generationFailure('The content generator returned invalid topics', 502);
    if (!editorialTypes.has(item.editorial_type)) generationFailure('The content generator returned an invalid editorial type', 502);
    const sources = [...new Set(Array.isArray(item.source_urls) ? item.source_urls : [])];
    if (!sources.length || sources.length > 3 || !sources.every(source => typeof source === 'string' && allowedSources.has(source))) generationFailure('The content generator returned an invalid source citation', 502);
    const copyKey = `${item.headline.trim().toLowerCase()}\u0000${item.body.trim().toLowerCase()}`;
    if (seenCopy.has(copyKey)) generationFailure('The content generator returned duplicate drafts', 502);
    seenSlots.add(item.slot_id); seenCopy.add(copyKey);
    cleaned.push({ slot, headline: item.headline.trim(), body: item.body.trim(), editorial_type: item.editorial_type, topics: topics.join(','), source_urls: sources });
  }
  return cleaned;
}
function renderGeneratedBalloon(item) {
  const label = generationLabels[item.editorial_type] || 'A useful note';
  return `<article class="conbal-generated-card"><p class="conbal-generated-label">${htmlEscape(label)}</p><h2>${htmlEscape(item.headline)}</h2><p>${htmlEscape(item.body)}</p></article>`;
}
const generatedBalloonCss = '.conbal-generated-card{box-sizing:border-box;border:1px solid #d8dfeb;border-radius:18px;padding:20px;background:#fff;color:#172033;font:inherit;line-height:1.45}.conbal-generated-card h2{margin:6px 0 8px;font-size:1.2rem;line-height:1.15}.conbal-generated-card p{margin:0}.conbal-generated-label{color:#47713d;text-transform:uppercase;letter-spacing:.12em;font-size:.68rem;font-weight:700}';
function generationProfileFromJob(job) { try { return JSON.parse(job.profile_json); } catch { generationFailure('Generation profile is invalid', 500); } }
function safeJobError(error) { return String(error?.message || error || 'Generation failed').slice(0, 500); }
async function runGenerationJob(env, jobId) {
  const job = await env.DB.prepare('SELECT * FROM generation_jobs WHERE id=?').bind(jobId).first();
  if (!job) return;
  try {
    const claimed = await env.DB.prepare("UPDATE generation_jobs SET status='running' WHERE id=? AND status='queued'").bind(jobId).run();
    if (claimed?.meta?.changes === 0 || claimed?.changes === 0) return;
    const profile = generationProfileFromJob(job);
    const generated = await generateWithOpenAI(env, profile);
    const items = validateGeneratedItems(generated.items, profile);
    const site = await env.DB.prepare('SELECT * FROM sites WHERE id=?').bind(job.site_id).first();
    if (!site) generationFailure('Site not found', 404);
    const balloons = items.map((item, index) => ({ id: id(), site_id: site.id, slug: generatedSlug(item.headline, job.id, index), title: item.headline, html: renderGeneratedBalloon(item), css: generatedBalloonCss, size: 'responsive', editorial_type: item.editorial_type, topics: item.topics, status: 'draft' }));
    const statements = [];
    balloons.forEach((balloon, index) => {
      statements.push(env.DB.prepare('INSERT INTO balloons (id,site_id,slug,title,html,css,size,editorial_type,topics,status) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(balloon.id, balloon.site_id, balloon.slug, balloon.title, balloon.html, balloon.css, balloon.size, balloon.editorial_type, balloon.topics, balloon.status));
      statements.push(env.DB.prepare('INSERT INTO generation_items (job_id,balloon_id,source_urls) VALUES (?,?,?)').bind(job.id, balloon.id, JSON.stringify(items[index].source_urls)));
    });
    statements.push(env.DB.prepare("UPDATE generation_jobs SET status='complete',completed_count=?,provider='openai',model=?,completed_at=datetime('now'),error=NULL WHERE id=?").bind(balloons.length, generated.model, job.id));
    await env.DB.batch(statements);
  } catch (error) {
    console.error('page-aware generation failed', error);
    await env.DB.prepare("UPDATE generation_jobs SET status='failed',error=?,completed_at=datetime('now') WHERE id=?").bind(safeJobError(error), job.id).run().catch(() => {});
  }
}
async function generationJobView(env, user, jobId) {
  const job = await env.DB.prepare('SELECT * FROM generation_jobs WHERE id=? AND user_id=?').bind(jobId, user.id).first();
  if (!job) throw Object.assign(new Error('Generation job not found'), { status: 404 });
  const rows = (await env.DB.prepare('SELECT gi.balloon_id,gi.source_urls,b.slug,b.title,b.status FROM generation_items gi JOIN balloons b ON b.id=gi.balloon_id WHERE gi.job_id=? ORDER BY b.updated_at DESC').bind(job.id).all()).results;
  return { id: job.id, status: job.status, page_url: job.page_url, page_kind: job.page_kind, page_title: job.page_title, requested_count: job.requested_count, completed_count: job.completed_count, provider: job.provider, model: job.model, error: job.error, created_at: job.created_at, completed_at: job.completed_at, profile: publicPageProfile(generationProfileFromJob(job)), items: rows.map(row => ({ ...row, source_urls: JSON.parse(row.source_urls || '[]') })) };
}
async function structuredInventory(env,siteKey,slots) {
  const excluded=slots[0]?.excludedSlugs||new Set(), fetchLimit=maxStructuredCandidatesPerSlot+excluded.size, statements=[];
  for(const slot of slots){const placeholders=slot.editorial_types.map(()=>'?').join(',');for(const topic of new Set([...slot.topics.filter(value=>value!==defaultContext),defaultContext]))statements.push(env.DB.prepare(`SELECT i.balloon_id AS id,i.slug,i.headline,i.body,i.editorial_type,i.topic AS topics FROM smart_delivery_items i JOIN balloons b ON b.id=i.balloon_id AND b.status='published' WHERE i.site_key=? AND i.topic=? AND i.editorial_type IN (${placeholders}) ORDER BY i.balloon_id LIMIT ${fetchLimit}`).bind(siteKey,topic,...slot.editorial_types));}
  const rows=(await env.DB.batch(statements)).flatMap(result=>result.results||[]), merged=new Map();
  for(const row of rows){if(excluded.has(row.slug))continue;const current=merged.get(row.id);if(current){current.topics=`${current.topics},${row.topics}`;}else merged.set(row.id,{...row});}
  return [...merged.values()];
}
function stableRank(pageViewId,slotId,slug) {
  const input=`${pageViewId}\u0000${slotId}\u0000${slug}`;let hash=2166136261;
  for(let index=0;index<input.length;index++){hash^=input.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return hash>>>0;
}
function structuredCandidateScore(pageViewId,slot,candidate) {
  if(!slot.editorial_types.includes(candidate.editorial_type))return null;
  const requested=new Set(slot.topics.filter(topic=>topic!==defaultContext));
  const candidateTopics=new Set(String(candidate.topics||defaultContext).split(',').map(topic=>topic.trim()).filter(Boolean));
  const relevance=[...requested].reduce((score,topic)=>score+(candidateTopics.has(topic)?1:0),0);
  if(relevance===0&&!candidateTopics.has(defaultContext))return null;
  const tie=(0xffffffff-stableRank(pageViewId,slot.id,candidate.slug))/0x100000000;
  return 1e9+relevance*1e6+tie;
}
function maximumWeightAssignments(weights) {
  const rows=weights.length, columns=weights[0]?.length||0, u=Array(rows+1).fill(0), v=Array(columns+1).fill(0), p=Array(columns+1).fill(0), way=Array(columns+1).fill(0);
  for(let row=1;row<=rows;row++){
    p[0]=row;let column0=0;const min=Array(columns+1).fill(Infinity), used=Array(columns+1).fill(false);
    do{used[column0]=true;const row0=p[column0];let delta=Infinity,column1=0;
      for(let column=1;column<=columns;column++)if(!used[column]){const current=-weights[row0-1][column-1]-u[row0]-v[column];if(current<min[column]){min[column]=current;way[column]=column0;}if(min[column]<delta){delta=min[column];column1=column;}}
      for(let column=0;column<=columns;column++)if(used[column]){u[p[column]]+=delta;v[column]-=delta;}else min[column]-=delta;
      column0=column1;
    }while(p[column0]!==0);
    do{const column1=way[column0];p[column0]=p[column1];column0=column1;}while(column0!==0);
  }
  const assignment=Array(rows).fill(-1);for(let column=1;column<=columns;column++)if(p[column])assignment[p[column]-1]=column-1;return assignment;
}
async function structuredDigest(pageViewId,slotId,slug) {
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(`${pageViewId}\u0000${slotId}\u0000${slug}`));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function structuredDelivery(request,env,context,siteKey) {
  if(request.method!=='POST')return fail('Method not allowed',405);
  const parsed=structuredRequest(await structuredJsonBody(request)), slots=[...parsed.slots].sort((left,right)=>left.id.localeCompare(right.id)).map(slot=>({...slot,excludedSlugs:parsed.excludedSlugs})), inventory=(await structuredInventory(env,siteKey,slots)).filter(candidate=>!parsed.excludedSlugs.has(candidate.slug)).sort((left,right)=>left.slug.localeCompare(right.slug)), delivered=[], output=Object.create(null), copies=new Map(), copyCache=new Map();
  const weights=slots.map((slot,row)=>[
    ...inventory.map((candidate,column)=>{const score=structuredCandidateScore(parsed.pageViewId,slot,candidate);if(score===null)return -1e12;const cacheKey=`${candidate.id}:${slot.budget}`;if(!copyCache.has(cacheKey))copyCache.set(cacheKey,structuredCopy(candidate,slot.budget));const copy=copyCache.get(cacheKey);if(!copy?.headline||!copy?.body)return -1e12;copies.set(`${row}:${column}`,copy);return score;}),
    ...Array.from({length:slots.length},()=>0),
  ]);
  const assigned=maximumWeightAssignments(weights);
  for(let row=0;row<slots.length;row++){
    const column=assigned[row];if(column<0||column>=inventory.length||weights[row][column]<0)continue;
    const slot=slots[row],selected=inventory[column],copy=copies.get(`${row}:${column}`);if(!copy)continue;
    delivered.push({slug:selected.slug,value:{balloonId:selected.id}});
    output[slot.id]={assignment_id:`v2_${(await structuredDigest(parsed.pageViewId,slot.id,selected.slug)).slice(0,32)}`,slug:selected.slug,role:slot.role,budget:slot.budget,editorial_type:selected.editorial_type,content:copy};
  }
  if(delivered.length){const work=recordDeliveries(env,siteKey,delivered).catch(error=>console.error('delivery counter failed',error));if(context?.waitUntil)context.waitUntil(work);else await work;}
  return json({assignments:output},{headers:{'access-control-allow-origin':'*','cache-control':'no-store, max-age=0'}});
}
function structuredCors(response) { const headers=new Headers(response.headers);headers.set('access-control-allow-origin','*');headers.set('access-control-allow-methods','POST, OPTIONS');headers.set('access-control-allow-headers','content-type');headers.set('cache-control','no-store, max-age=0');return new Response(response.body,{status:response.status,statusText:response.statusText,headers}); }
async function v2Delivery(request,env,url,context) {
  try{
    const parts=url.pathname.split('/').filter(Boolean);
    if(parts.length!==4||parts[0]!=='v2'||parts[1]!=='b'||parts[3]!=='sample'||!validSiteKey(parts[2]))return structuredCors(fail('Not found',404));
    if(request.method==='OPTIONS')return structuredCors(new Response(null,{status:204,headers:{'access-control-max-age':'86400'}}));
    return structuredCors(await structuredDelivery(request,env,context,parts[2]));
  }catch(error){return structuredCors(fail(error.message||'Server error',error.status||500));}
}
async function delivery(request, env, url, context) {
  const parts = url.pathname.split('/').filter(Boolean); const siteKey = parts[1];
  if(parts.length===3&&parts[2]==='_sample'){if(!validSiteKey(siteKey))return fail('Not found',404);return sampleDelivery(request,env,url,context,siteKey);}
  if (request.method !== 'GET') return fail('Method not allowed', 405);
  const slugs = [...new Set((parts[2] || '').split(',').filter(validSlug))].slice(0, 30);
  if (parts.length !== 3 || !validSiteKey(siteKey) || !slugs.length) return fail('Not found', 404);
  const values = await Promise.all(slugs.map(slug => env.CONBAL_KV.get(`b:${siteKey}:${slug}`, 'json')));
  const delivered=slugs.map((slug,i)=>({slug,value:values[i]})).filter(item=>item.value);
  const data=Object.fromEntries(delivered.map(({slug,value})=>[slug,{html:value.html,css:value.css||'',size:value.size}]));
  if(delivered.length){const work=recordDeliveries(env,siteKey,delivered).catch(error=>console.error('delivery counter failed',error));if(context?.waitUntil)context.waitUntil(work);else await work;}
  // Multi-balloon responses cannot be safely invalidated by Cache API when one
  // balloon changes, so always read the current published values from KV.
  return json(data, { headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
}

async function api(request, env, url, context) {
  const path = url.pathname, method = request.method;
  if (path === '/api/health') return json({ ok: Boolean(env.DB && env.CONBAL_KV) });
  if ((path === '/api/auth/google' && (method === 'GET' || method === 'POST')) || (path === '/api/auth/google/callback' && method === 'GET')) return googleAuth(request,env,url);
  if ((path === '/api/signup' || path === '/api/login') && (method === 'POST' || method === 'GET')) return fail('Google sign-in is the only supported login method', 410);
  if (path === '/api/logout' && method === 'POST') { const s = cookies(request).conbal_session; if (s) await env.CONBAL_KV.delete(`s:${s}`); return json({ ok: true }, { headers: { 'set-cookie': cookie('', 0) } }); }
  const user = await requireUser(request, env);
  if (path === '/api/me' && method === 'GET') return json({ user });
  if (path === '/api/sites' && method === 'GET') return json((await env.DB.prepare('SELECT * FROM sites WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all()).results);
  if (path === '/api/analytics' && method === 'GET') return json(await analytics(env,user,url.searchParams.get('site_id')));
  if (path === '/api/sites' && method === 'POST') { const { name, origin_url } = await body(request); if (typeof name !== 'string' || !name.trim() || name.length > 120) return fail('Enter a site name'); let origin = null; if (origin_url !== undefined && origin_url !== null && origin_url !== '') { try { origin = canonicalOrigin(validatePageUrl(origin_url)); } catch (error) { return fail(error.message, error.status || 400); } } const site = { id: id(), name: name.trim(), site_key: token(9), origin_url: origin }; await env.DB.prepare('INSERT INTO sites (id,user_id,name,site_key,origin_url) VALUES (?,?,?,?,?)').bind(site.id,user.id,site.name,site.site_key,site.origin_url).run(); return json(site,{status:201}); }
  let match = path.match(/^\/api\/sites\/([^/]+)$/);
  if (match && method === 'PATCH') { const site=await ownerSite(env,user,match[1]), {name,origin_url}=await body(request); if(typeof name !== 'string'||!name.trim()||name.length>120)return fail('Enter a site name'); let origin=site.origin_url; if(origin_url !== undefined) { if(origin_url === null || origin_url === '') origin=null; else { try { origin=canonicalOrigin(validatePageUrl(origin_url)); } catch (error) { return fail(error.message,error.status || 400); } } } await env.DB.prepare('UPDATE sites SET name=?,origin_url=? WHERE id=?').bind(name.trim(),origin,site.id).run(); return json({ok:true}); }
  if (match && method === 'DELETE') { const site=await ownerSite(env,user,match[1]); const bs=(await env.DB.prepare('SELECT slug FROM balloons WHERE site_id=?').bind(site.id).all()).results; await Promise.all(bs.map(b=>env.CONBAL_KV.delete(`b:${site.site_key}:${b.slug}`))); await env.DB.batch([env.DB.prepare('DELETE FROM generation_items WHERE job_id IN (SELECT id FROM generation_jobs WHERE site_id=?)').bind(site.id),env.DB.prepare('DELETE FROM generation_jobs WHERE site_id=?').bind(site.id),env.DB.prepare('DELETE FROM smart_delivery_items WHERE site_key=?').bind(site.site_key),env.DB.prepare('DELETE FROM balloon_delivery_counts WHERE balloon_id IN (SELECT id FROM balloons WHERE site_id=?)').bind(site.id),env.DB.prepare('DELETE FROM balloons WHERE site_id=?').bind(site.id),env.DB.prepare('DELETE FROM sites WHERE id=?').bind(site.id)]); return json({ok:true}); }
  match = path.match(/^\/api\/sites\/([^/]+)\/page-profile$/);
  if (match) { if (method !== 'POST') return fail('Method not allowed',405); const site=await ownerSite(env,user,match[1]); try { const { page_url } = await body(request); const profile=await buildPageProfile(page_url,site); if (!site.origin_url) { await env.DB.prepare('UPDATE sites SET origin_url=? WHERE id=? AND user_id=? AND origin_url IS NULL').bind(profile.origin,site.id,user.id).run(); } return json({profile:publicPageProfile(profile)}); } catch (error) { return fail(error.message || 'Unable to analyze page',error.status || 500); } }
  match = path.match(/^\/api\/sites\/([^/]+)\/generation-jobs$/);
  if (match && method === 'POST') { const site=await ownerSite(env,user,match[1]); if (!sameOriginRequest(request,url)) return fail('Generation requests must come from the Conbal dashboard',403); if (!env.OPENAI_API_KEY) return fail('Page-aware generation is not configured. Add the OPENAI_API_KEY Worker secret.',503); const usage=await env.DB.prepare("SELECT SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) AS active,SUM(CASE WHEN created_at >= datetime('now','-1 hour') THEN 1 ELSE 0 END) AS recent FROM generation_jobs WHERE site_id=?").bind(site.id).first(); if (Number(usage?.active) > 0) return fail('A generation job is already running for this site',409); if (Number(usage?.recent) >= generationMaxRecentJobs) return fail('This site has reached its hourly draft-generation limit',429); let profile; try { const { page_url } = await body(request); profile=await buildPageProfile(page_url,site); } catch (error) { return fail(error.message || 'Unable to analyze page',error.status || 400); } if (!profile.slots.length) return fail('This page does not have enough readable content for a useful draft yet',422); if (!site.origin_url) await env.DB.prepare('UPDATE sites SET origin_url=? WHERE id=? AND user_id=? AND origin_url IS NULL').bind(profile.origin,site.id,user.id).run(); const job={id:id(),user_id:user.id,site_id:site.id,status:'queued',page_url:profile.url,page_kind:profile.kind,page_title:profile.title,page_fingerprint:profile.fingerprint,requested_count:profile.slots.length,completed_count:0,profile_json:JSON.stringify(profile),provider:'openai',model:env.OPENAI_MODEL || 'gpt-4o-mini'}; try { await env.DB.prepare('INSERT INTO generation_jobs (id,user_id,site_id,status,page_url,page_kind,page_title,page_fingerprint,requested_count,completed_count,profile_json,provider,model) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(job.id,job.user_id,job.site_id,job.status,job.page_url,job.page_kind,job.page_title,job.page_fingerprint,job.requested_count,job.completed_count,job.profile_json,job.provider,job.model).run(); } catch (error) { if (/idx_generation_active_site|UNIQUE constraint failed: generation_jobs.site_id/i.test(String(error?.message || error))) return fail('A generation job is already running for this site',409); throw error; } const work=runGenerationJob(env,job.id); if (context?.waitUntil) context.waitUntil(work); else await work; return json({job_id:job.id,status:'queued',profile:publicPageProfile(profile)},{status:202}); }
  match = path.match(/^\/api\/generation-jobs\/([^/]+)$/);
  if (match && method === 'GET') return json(await generationJobView(env,user,match[1]));
  match = path.match(/^\/api\/sites\/([^/]+)\/balloons\/metadata\/import$/);
  if (match) { if(method !== 'POST') return fail('Method not allowed',405); const site=await ownerSite(env,user,match[1]); const metadata=csvMetadataRows(await csvBody(request)); const balloons=(await env.DB.prepare('SELECT * FROM balloons WHERE site_id=?').bind(site.id).all()).results, bySlug=new Map(balloons.map(balloon=>[balloon.slug,balloon])); for(const item of metadata)if(!bySlug.has(item.slug))return fail(`Row ${item.sourceRow}: balloon slug "${item.slug}" does not exist for this site`,409); const updates=metadata.map(({sourceRow,...item})=>({...item,balloon:bySlug.get(item.slug)})); try{await env.DB.batch(updates.map(update=>env.DB.prepare("UPDATE balloons SET editorial_type=?,topics=?,updated_at=datetime('now') WHERE id=?").bind(update.editorial_type,update.topics,update.balloon.id)));await Promise.all(updates.filter(update=>update.balloon.status==='published').map(update=>publish(env,{...update.balloon,...update,site_key:site.site_key})));}catch(error){console.error('balloon metadata import failed',error);return fail('Unable to update balloon metadata',500);} return json({updated:updates.length}); }
  match = path.match(/^\/api\/sites\/([^/]+)\/balloons\/reindex$/);
  if (match) { if(method!=='POST')return fail('Method not allowed',405);const site=await ownerSite(env,user,match[1]),balloons=(await env.DB.prepare("SELECT id FROM balloons WHERE site_id=? AND status='published' ORDER BY id").bind(site.id).all()).results;let indexed=0;for(const balloon of balloons)if(await reindexPublishedBalloon(env,site,balloon.id))indexed++;return json({indexed,skipped:balloons.length-indexed,total:balloons.length}); }
  match = path.match(/^\/api\/sites\/([^/]+)\/balloons\/publish-all$/);
  if (match) { if(method !== 'POST') return fail('Method not allowed',405); const site=await ownerSite(env,user,match[1]); const drafts=(await env.DB.prepare("SELECT * FROM balloons WHERE site_id=? AND status='draft'").bind(site.id).all()).results; if(drafts.length>maxImportRows)return fail(`Publish at most ${maxImportRows} draft balloons at a time`,413); const written=[]; try{await Promise.all(drafts.map(async balloon=>{await publish(env,{...balloon,site_key:site.site_key});written.push(balloon.slug);}));if(drafts.length)await env.DB.batch(drafts.map(balloon=>env.DB.prepare("UPDATE balloons SET status='published',updated_at=datetime('now') WHERE id=?").bind(balloon.id)));}catch(error){await Promise.allSettled(written.map(slug=>env.CONBAL_KV.delete(`b:${site.site_key}:${slug}`)));console.error('balloon bulk publish failed',error);return fail('Unable to publish balloons',500);} return json({published:drafts.length}); }
  match = path.match(/^\/api\/sites\/([^/]+)\/balloons\/import$/);
  if (match) { if(method !== 'POST') return fail('Method not allowed',405); const site=await ownerSite(env,user,match[1]); const imported=csvImportRows(await csvBody(request)); const existing=(await env.DB.prepare('SELECT slug FROM balloons WHERE site_id=?').bind(site.id).all()).results.map(row=>row.slug); const existingSlugs=new Set(existing); for(const balloon of imported)if(existingSlugs.has(balloon.slug))return fail(`Row ${balloon.sourceRow}: a balloon with slug "${balloon.slug}" already exists for this site`,409); const balloons=imported.map(({sourceRow,...balloon})=>({id:id(),site_id:site.id,...balloon,status:'draft'})); try{await env.DB.batch(balloons.map(balloon=>env.DB.prepare("INSERT INTO balloons (id,site_id,slug,title,html,css,size,editorial_type,topics,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(balloon.id,balloon.site_id,balloon.slug,balloon.title,balloon.html,balloon.css,balloon.size,balloon.editorial_type,balloon.topics,balloon.status)));}catch(error){if(isBalloonSlugConflict(error))return fail('A balloon with one of these slugs was created concurrently; no balloons were imported',409);console.error('balloon import failed',error);return fail('Unable to import balloons; no changes were made',500);} return json({imported:balloons.length,items:balloons},{status:201}); }
  match = path.match(/^\/api\/sites\/([^/]+)\/balloons$/);
  if (match && method === 'GET') { const site=await ownerSite(env,user,match[1]); return json((await env.DB.prepare("SELECT b.*,(SELECT j.page_url FROM generation_items gi JOIN generation_jobs j ON j.id=gi.job_id WHERE gi.balloon_id=b.id ORDER BY gi.generated_at DESC LIMIT 1) AS generated_from FROM balloons b WHERE b.site_id=? ORDER BY b.updated_at DESC").bind(site.id).all()).results); }
  if (match && method === 'POST') { const site=await ownerSite(env,user,match[1]); const b={id:id(),site_id:site.id,...cleanBalloon(await body(request))}; try { await env.DB.prepare('INSERT INTO balloons (id,site_id,slug,title,html,css,size,editorial_type,topics) VALUES (?,?,?,?,?,?,?,?,?)').bind(b.id,b.site_id,b.slug,b.title,b.html,b.css,b.size,b.editorial_type,b.topics).run(); } catch{return fail('That slug already exists for this site',409)} return json(b,{status:201}); }
  match = path.match(/^\/api\/balloons\/([^/]+)(?:\/(publish|unpublish))?$/);
  if (match) { const balloon=await ownerBalloon(env,user,match[1]); if(match[2]==='publish'&&method==='POST'){await publish(env,balloon);await env.DB.prepare("UPDATE balloons SET status='published',updated_at=datetime('now') WHERE id=?").bind(balloon.id).run();return json({ok:true})} if(match[2]==='unpublish'&&method==='POST'){await env.CONBAL_KV.delete(`b:${balloon.site_key}:${balloon.slug}`);await env.DB.batch([env.DB.prepare('DELETE FROM smart_delivery_items WHERE balloon_id=?').bind(balloon.id),env.DB.prepare("UPDATE balloons SET status='draft',updated_at=datetime('now') WHERE id=?").bind(balloon.id)]);return json({ok:true})} if(!match[2]&&method==='PATCH'){const b=cleanBalloon({...balloon,...await body(request)});try{await env.DB.prepare("UPDATE balloons SET title=?,slug=?,html=?,css=?,size=?,editorial_type=?,topics=?,updated_at=datetime('now') WHERE id=?").bind(b.title,b.slug,b.html,b.css,b.size,b.editorial_type,b.topics,balloon.id).run()}catch{return fail('That slug already exists for this site',409)}if(balloon.status==='published'){await env.CONBAL_KV.delete(`b:${balloon.site_key}:${balloon.slug}`);await publish(env,{...balloon,...b})}return json({ok:true})} if(!match[2]&&method==='DELETE'){await env.CONBAL_KV.delete(`b:${balloon.site_key}:${balloon.slug}`);await env.DB.batch([env.DB.prepare('DELETE FROM smart_delivery_items WHERE balloon_id=?').bind(balloon.id),env.DB.prepare('DELETE FROM balloon_delivery_counts WHERE balloon_id=?').bind(balloon.id),env.DB.prepare('DELETE FROM balloons WHERE id=?').bind(balloon.id)]);return json({ok:true})} }
  return fail('Not found', 404);
}
function secure(response) { const h=new Headers(response.headers);h.set('x-content-type-options','nosniff');h.set('strict-transport-security','max-age=31536000; includeSubDomains');return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h}); }
export default { async fetch(request, env, context) { const url=new URL(request.url), host=request.headers.get('host') || url.host; if (host==='www.conbal.us' || (host==='conbal.us' && url.protocol==='http:')) { url.protocol='https:';url.hostname='conbal.us';return Response.redirect(url,301); } try { let response; if(url.pathname.startsWith('/v2/b/'))response=await v2Delivery(request,env,url,context); else if(url.pathname.startsWith('/b/'))response=await delivery(request,env,url,context); else if(url.pathname.startsWith('/api/'))response=await api(request,env,url,context); else response=await env.ASSETS.fetch(request); return secure(response); } catch(error) { return secure(fail(error.message||'Server error',error.status||500)); } } };
