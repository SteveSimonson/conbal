const encoder = new TextEncoder();
const fixedSizes = new Set(['responsive', '300x250', '336x280', '728x90', '160x600', '320x100']);
const json = (data, init = {}) => new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) } });
const fail = (error, status = 400) => json({ error }, { status });
const id = () => crypto.randomUUID();
const token = (bytes = 18) => { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); };
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = value => Uint8Array.from(atob(value), x => x.charCodeAt(0));

async function hashPassword(password, saved) {
  const iterations = 210000;
  const salt = saved ? unb64(saved.split('.')[1]) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, key, 256);
  return `pbkdf2:${iterations}.${b64(salt)}.${b64(bits)}`;
}
async function verifyPassword(password, stored) { return (await hashPassword(password, stored)) === stored; }
function cookies(request) { return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v[0])); }
async function body(request) { try { return await request.json(); } catch { throw new Error('Expected a JSON body'); } }
function validEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validSlug(slug) { return typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug); }
function validSiteKey(siteKey) { return typeof siteKey === 'string' && /^[A-Za-z0-9_-]{12}$/.test(siteKey); }
function cookie(value, age = 0) { return `conbal_session=${encodeURIComponent(value || '')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
async function session(request, env) { const value = cookies(request).conbal_session; if (!value) return null; const data = await env.CONBAL_KV.get(`s:${value}`, 'json'); if (!data) return null; await env.CONBAL_KV.put(`s:${value}`, JSON.stringify(data), { expirationTtl: 604800 }); return data; }
async function requireUser(request, env) { const s = await session(request, env); if (!s) throw Object.assign(new Error('Login required'), { status: 401 }); return s; }
async function ownerSite(env, user, siteId) { const site = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND user_id=?').bind(siteId, user.id).first(); if (!site) throw Object.assign(new Error('Site not found'), { status: 404 }); return site; }
async function ownerBalloon(env, user, balloonId) { const balloon = await env.DB.prepare('SELECT b.*, s.site_key FROM balloons b JOIN sites s ON s.id=b.site_id WHERE b.id=? AND s.user_id=?').bind(balloonId, user.id).first(); if (!balloon) throw Object.assign(new Error('Balloon not found'), { status: 404 }); return balloon; }
function cleanBalloon(data) {
  const { title, slug, html, css = '', size = 'responsive' } = data;
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || !validSlug(slug) || typeof html !== 'string' || html.length > 50000 || typeof css !== 'string' || css.length > 20000 || !fixedSizes.has(size)) throw new Error('Invalid balloon fields');
  return { title: title.trim(), slug, html, css, size };
}
async function publish(env, balloon) {
  const key = `b:${balloon.site_key}:${balloon.slug}`;
  await env.CONBAL_KV.put(key, JSON.stringify({ html: balloon.html, css: balloon.css, size: balloon.size }));
}

async function delivery(request, env, url) {
  if (request.method !== 'GET') return fail('Method not allowed', 405);
  const parts = url.pathname.split('/').filter(Boolean); const siteKey = parts[1]; const slugs = (parts[2] || '').split(',').filter(validSlug).slice(0, 30);
  if (parts.length !== 3 || !validSiteKey(siteKey) || !slugs.length) return fail('Not found', 404);
  const values = await Promise.all(slugs.map(slug => env.CONBAL_KV.get(`b:${siteKey}:${slug}`, 'json')));
  const data = Object.fromEntries(slugs.map((slug, i) => [slug, values[i]]).filter(([, value]) => value));
  // Multi-balloon responses cannot be safely invalidated by Cache API when one
  // balloon changes, so always read the current published values from KV.
  return json(data, { headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
}

async function api(request, env, url) {
  const path = url.pathname, method = request.method;
  if (path === '/api/health') return json({ ok: Boolean(env.DB && env.CONBAL_KV) });
  if (path === '/api/signup' && method === 'POST') {
    const { email, password, inviteCode } = await body(request); const normalized = String(email || '').trim().toLowerCase();
    if (!validEmail(normalized) || typeof password !== 'string' || password.length < 8) return fail('Use a valid email and password of at least 8 characters');
    if (env.SIGNUP_INVITE_CODE && inviteCode !== env.SIGNUP_INVITE_CODE) return fail('A valid invite code is required', 403);
    const user = { id: id(), email: normalized }; try { await env.DB.prepare('INSERT INTO users (id,email,password_hash) VALUES (?,?,?)').bind(user.id, user.email, await hashPassword(password)).run(); } catch { return fail('That email is already registered', 409); }
    const s = token(16); await env.CONBAL_KV.put(`s:${s}`, JSON.stringify(user), { expirationTtl: 604800 }); return json({ user }, { status: 201, headers: { 'set-cookie': cookie(s, 604800) } });
  }
  if (path === '/api/login' && method === 'POST') {
    const { email, password } = await body(request); const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(String(email || '').trim().toLowerCase()).first();
    if (!user || typeof password !== 'string' || !await verifyPassword(password, user.password_hash)) return fail('Invalid email or password', 401);
    const s = token(16); await env.CONBAL_KV.put(`s:${s}`, JSON.stringify({ id: user.id, email: user.email }), { expirationTtl: 604800 }); return json({ user: { id: user.id, email: user.email } }, { headers: { 'set-cookie': cookie(s, 604800) } });
  }
  if (path === '/api/logout' && method === 'POST') { const s = cookies(request).conbal_session; if (s) await env.CONBAL_KV.delete(`s:${s}`); return json({ ok: true }, { headers: { 'set-cookie': cookie('', 0) } }); }
  const user = await requireUser(request, env);
  if (path === '/api/me' && method === 'GET') return json({ user });
  if (path === '/api/sites' && method === 'GET') return json((await env.DB.prepare('SELECT * FROM sites WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all()).results);
  if (path === '/api/sites' && method === 'POST') { const { name } = await body(request); if (typeof name !== 'string' || !name.trim() || name.length > 120) return fail('Enter a site name'); const site = { id: id(), name: name.trim(), site_key: token(9) }; await env.DB.prepare('INSERT INTO sites (id,user_id,name,site_key) VALUES (?,?,?,?)').bind(site.id,user.id,site.name,site.site_key).run(); return json(site,{status:201}); }
  let match = path.match(/^\/api\/sites\/([^/]+)$/);
  if (match && method === 'PATCH') { const site=await ownerSite(env,user,match[1]), {name}=await body(request); if(typeof name !== 'string'||!name.trim()||name.length>120)return fail('Enter a site name'); await env.DB.prepare('UPDATE sites SET name=? WHERE id=?').bind(name.trim(),site.id).run(); return json({ok:true}); }
  if (match && method === 'DELETE') { const site=await ownerSite(env,user,match[1]); const bs=(await env.DB.prepare('SELECT slug FROM balloons WHERE site_id=?').bind(site.id).all()).results; await Promise.all(bs.map(b=>env.CONBAL_KV.delete(`b:${site.site_key}:${b.slug}`))); await env.DB.batch([env.DB.prepare('DELETE FROM balloons WHERE site_id=?').bind(site.id),env.DB.prepare('DELETE FROM sites WHERE id=?').bind(site.id)]); return json({ok:true}); }
  match = path.match(/^\/api\/sites\/([^/]+)\/balloons$/);
  if (match && method === 'GET') { const site=await ownerSite(env,user,match[1]); return json((await env.DB.prepare('SELECT * FROM balloons WHERE site_id=? ORDER BY updated_at DESC').bind(site.id).all()).results); }
  if (match && method === 'POST') { const site=await ownerSite(env,user,match[1]); const b={id:id(),site_id:site.id,...cleanBalloon(await body(request))}; try { await env.DB.prepare('INSERT INTO balloons (id,site_id,slug,title,html,css,size) VALUES (?,?,?,?,?,?,?)').bind(b.id,b.site_id,b.slug,b.title,b.html,b.css,b.size).run(); } catch{return fail('That slug already exists for this site',409)} return json(b,{status:201}); }
  match = path.match(/^\/api\/balloons\/([^/]+)(?:\/(publish|unpublish))?$/);
  if (match) { const balloon=await ownerBalloon(env,user,match[1]); if(match[2]==='publish'&&method==='POST'){await publish(env,balloon);await env.DB.prepare("UPDATE balloons SET status='published',updated_at=datetime('now') WHERE id=?").bind(balloon.id).run();return json({ok:true})} if(match[2]==='unpublish'&&method==='POST'){await env.CONBAL_KV.delete(`b:${balloon.site_key}:${balloon.slug}`);await env.DB.prepare("UPDATE balloons SET status='draft',updated_at=datetime('now') WHERE id=?").bind(balloon.id).run();return json({ok:true})} if(!match[2]&&method==='PATCH'){const b=cleanBalloon(await body(request));try{await env.DB.prepare("UPDATE balloons SET title=?,slug=?,html=?,css=?,size=?,updated_at=datetime('now') WHERE id=?").bind(b.title,b.slug,b.html,b.css,b.size,balloon.id).run()}catch{return fail('That slug already exists for this site',409)}if(balloon.status==='published'){await env.CONBAL_KV.delete(`b:${balloon.site_key}:${balloon.slug}`);await publish(env,{...balloon,...b})}return json({ok:true})} if(!match[2]&&method==='DELETE'){await env.CONBAL_KV.delete(`b:${balloon.site_key}:${balloon.slug}`);await env.DB.prepare('DELETE FROM balloons WHERE id=?').bind(balloon.id).run();return json({ok:true})} }
  return fail('Not found', 404);
}
function secure(response) { const h=new Headers(response.headers);h.set('x-content-type-options','nosniff');h.set('strict-transport-security','max-age=31536000; includeSubDomains');return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h}); }
export default { async fetch(request, env) { const url=new URL(request.url), host=request.headers.get('host') || url.host; if (host==='www.conbal.us' || (host==='conbal.us' && url.protocol==='http:')) { url.protocol='https:';url.hostname='conbal.us';return Response.redirect(url,301); } try { let response; if(url.pathname.startsWith('/b/'))response=await delivery(request,env,url); else if(url.pathname.startsWith('/api/'))response=await api(request,env,url); else response=await env.ASSETS.fetch(request); return secure(response); } catch(error) { return secure(fail(error.message||'Server error',error.status||500)); } } };
