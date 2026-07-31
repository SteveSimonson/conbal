const encoder = new TextEncoder();
const fixedSizes = new Set(['responsive', '300x250', '336x280', '728x90', '160x600', '320x100']);
const maxImportBytes = 512000;
const maxImportRows = 100;
const maxImportRowChars = 75000;
const json = (data, init = {}) => new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) } });
const fail = (error, status = 400) => json({ error }, { status });
const id = () => crypto.randomUUID();
const token = (bytes = 18) => { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); };
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = value => Uint8Array.from(atob(value), x => x.charCodeAt(0));

async function hashPassword(password, saved) {
  const iterations = saved ? Number(saved.match(/^pbkdf2:(\d+)\./)?.[1]) : 100000;
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 500000) throw new Error('Unsupported password hash');
  const salt = saved ? unb64(saved.split('.')[1]) : crypto.getRandomValues(new Uint8Array(16));
  const passwordBytes = encoder.encode(password);
  const key = await crypto.subtle.importKey('raw', passwordBytes.buffer, { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt: salt.buffer }, key, 256);
  return `pbkdf2:${iterations}.${b64(salt)}.${b64(bits)}`;
}
async function verifyPassword(password, stored) { return (await hashPassword(password, stored)) === stored; }
function cookies(request) { return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v[0])); }
async function body(request) { try { return await request.json(); } catch { throw new Error('Expected a JSON body'); } }
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
  if(rows.length>maxImportRows) importError(`CSV may contain at most ${maxImportRows} balloon rows`,413); const slugs=new Set(); const balloons=[];
  rows.forEach((row,rowIndex)=>{const number=rowIndex+2;if(row.join('').length>maxImportRowChars)importError(`Row ${number}: row is too large`,413);if(row.length>headers.length)importError(`Row ${number}: has more columns than the header`);const data=Object.fromEntries(required.map(name=>[name,row[indexes[name]] ?? '']));let balloon;try{balloon=cleanBalloon(data);}catch(error){importError(`Row ${number}: ${error.message}`);}if(slugs.has(balloon.slug))importError(`Row ${number}: duplicate slug "${balloon.slug}" in this file`);slugs.add(balloon.slug);balloons.push({...balloon,sourceRow:number});});
  if(!balloons.length) importError('CSV must include at least one balloon row'); return balloons;
}
function validEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validSlug(slug) { return typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug); }
function validSiteKey(siteKey) { return typeof siteKey === 'string' && /^[A-Za-z0-9_-]{12}$/.test(siteKey); }
function isEmailConflict(error) { return /UNIQUE constraint failed: users\.email/i.test(String(error?.message || error)); }
function isBalloonSlugConflict(error) { return /UNIQUE constraint failed: balloons\.site_id, balloons\.slug/i.test(String(error?.message || error)); }
function cookie(value, age = 0) { return `conbal_session=${encodeURIComponent(value || '')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
function oauthStateCookie(value, age = 0) { return `conbal_oauth_state=${encodeURIComponent(value || '')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
function googleCallbackUrl(url) { return ['localhost', '127.0.0.1'].includes(url.hostname) ? `${url.origin}/api/auth/google/callback` : 'https://conbal.us/api/auth/google/callback'; }
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
  const email=typeof profile.email==='string' ? profile.email.trim().toLowerCase() : ''; if(typeof profile.sub!=='string'||!profile.sub||!validEmail(email)||profile.email_verified!==true)return fail('Google did not provide a verified email',403); let user=await env.DB.prepare('SELECT id,email FROM users WHERE google_id=?').bind(profile.sub).first(); if(!user){ if(!oauthState.inviteAuthorized)return fail('A valid invite code is required',403); user={id:id(),email}; try{await env.DB.prepare('INSERT INTO users (id,email,password_hash,google_id) VALUES (?,?,?,?)').bind(user.id,user.email,await hashPassword(token(24)),profile.sub).run()}catch{return fail('An account already exists with this email; sign in with email first',409)} } const s=await createSession(env,user); const headers=new Headers({location:`${new URL(callback).origin}/admin/`}); headers.append('set-cookie',cookie(s,604800)); headers.append('set-cookie',oauthStateCookie('',0)); return new Response(null,{status:302,headers});
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
  if ((path === '/api/auth/google' && (method === 'GET' || method === 'POST')) || (path === '/api/auth/google/callback' && method === 'GET')) return googleAuth(request,env,url);
  if (path === '/api/signup' && method === 'POST') {
    const { email, password, inviteCode } = await body(request); const normalized = String(email || '').trim().toLowerCase();
    if (!validEmail(normalized) || typeof password !== 'string' || password.length < 8) return fail('Use a valid email and password of at least 8 characters');
    if (env.SIGNUP_INVITE_CODE && inviteCode !== env.SIGNUP_INVITE_CODE) return fail('A valid invite code is required', 403);
    const user = { id: id(), email: normalized };
    let passwordHash;
    try { passwordHash = await hashPassword(password); } catch (error) { console.error('password hash failed', error); return fail('Unable to secure the account', 500); }
    try { await env.DB.prepare('INSERT INTO users (id,email,password_hash) VALUES (?,?,?)').bind(user.id, user.email, passwordHash).run(); } catch (error) { if (isEmailConflict(error)) return fail('That email is already registered', 409); console.error('signup insert failed', error); return fail('Unable to create the account', 500); }
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
  match = path.match(/^\/api\/sites\/([^/]+)\/balloons\/import$/);
  if (match) { if(method !== 'POST') return fail('Method not allowed',405); const site=await ownerSite(env,user,match[1]); const imported=csvImportRows(await csvBody(request)); const existing=(await env.DB.prepare('SELECT slug FROM balloons WHERE site_id=?').bind(site.id).all()).results.map(row=>row.slug); const existingSlugs=new Set(existing); for(const balloon of imported)if(existingSlugs.has(balloon.slug))return fail(`Row ${balloon.sourceRow}: a balloon with slug "${balloon.slug}" already exists for this site`,409); const balloons=imported.map(({sourceRow,...balloon})=>({id:id(),site_id:site.id,...balloon,status:'draft'})); try{await env.DB.batch(balloons.map(balloon=>env.DB.prepare("INSERT INTO balloons (id,site_id,slug,title,html,css,size,status) VALUES (?,?,?,?,?,?,?,?)").bind(balloon.id,balloon.site_id,balloon.slug,balloon.title,balloon.html,balloon.css,balloon.size,balloon.status)));}catch(error){if(isBalloonSlugConflict(error))return fail('A balloon with one of these slugs was created concurrently; no balloons were imported',409);console.error('balloon import failed',error);return fail('Unable to import balloons; no changes were made',500);} return json({imported:balloons.length,items:balloons},{status:201}); }
  match = path.match(/^\/api\/sites\/([^/]+)\/balloons$/);
  if (match && method === 'GET') { const site=await ownerSite(env,user,match[1]); return json((await env.DB.prepare('SELECT * FROM balloons WHERE site_id=? ORDER BY updated_at DESC').bind(site.id).all()).results); }
  if (match && method === 'POST') { const site=await ownerSite(env,user,match[1]); const b={id:id(),site_id:site.id,...cleanBalloon(await body(request))}; try { await env.DB.prepare('INSERT INTO balloons (id,site_id,slug,title,html,css,size) VALUES (?,?,?,?,?,?,?)').bind(b.id,b.site_id,b.slug,b.title,b.html,b.css,b.size).run(); } catch{return fail('That slug already exists for this site',409)} return json(b,{status:201}); }
  match = path.match(/^\/api\/balloons\/([^/]+)(?:\/(publish|unpublish))?$/);
  if (match) { const balloon=await ownerBalloon(env,user,match[1]); if(match[2]==='publish'&&method==='POST'){await publish(env,balloon);await env.DB.prepare("UPDATE balloons SET status='published',updated_at=datetime('now') WHERE id=?").bind(balloon.id).run();return json({ok:true})} if(match[2]==='unpublish'&&method==='POST'){await env.CONBAL_KV.delete(`b:${balloon.site_key}:${balloon.slug}`);await env.DB.prepare("UPDATE balloons SET status='draft',updated_at=datetime('now') WHERE id=?").bind(balloon.id).run();return json({ok:true})} if(!match[2]&&method==='PATCH'){const b=cleanBalloon(await body(request));try{await env.DB.prepare("UPDATE balloons SET title=?,slug=?,html=?,css=?,size=?,updated_at=datetime('now') WHERE id=?").bind(b.title,b.slug,b.html,b.css,b.size,balloon.id).run()}catch{return fail('That slug already exists for this site',409)}if(balloon.status==='published'){await env.CONBAL_KV.delete(`b:${balloon.site_key}:${balloon.slug}`);await publish(env,{...balloon,...b})}return json({ok:true})} if(!match[2]&&method==='DELETE'){await env.CONBAL_KV.delete(`b:${balloon.site_key}:${balloon.slug}`);await env.DB.prepare('DELETE FROM balloons WHERE id=?').bind(balloon.id).run();return json({ok:true})} }
  return fail('Not found', 404);
}
function secure(response) { const h=new Headers(response.headers);h.set('x-content-type-options','nosniff');h.set('strict-transport-security','max-age=31536000; includeSubDomains');return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h}); }
export default { async fetch(request, env) { const url=new URL(request.url), host=request.headers.get('host') || url.host; if (host==='www.conbal.us' || (host==='conbal.us' && url.protocol==='http:')) { url.protocol='https:';url.hostname='conbal.us';return Response.redirect(url,301); } try { let response; if(url.pathname.startsWith('/b/'))response=await delivery(request,env,url); else if(url.pathname.startsWith('/api/'))response=await api(request,env,url); else response=await env.ASSETS.fetch(request); return secure(response); } catch(error) { return secure(fail(error.message||'Server error',error.status||500)); } } };
