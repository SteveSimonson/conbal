# Conbal

Conbal is a multi-tenant content-balloon service. `workers/site.js` owns redirects, API/auth, and public delivery; `public/` contains the landing page, admin UI, and embed loader. D1 is the source of truth; KV holds sessions and published payloads.

## Rules

- Keep this dependency-free and use WebCrypto for password hashing.
- Never commit `.dev.vars` or Cloudflare IDs/secrets.
- Public `/b/*` payloads and `site_key`s are deliberately public. Balloon HTML is trusted owner content and is injected into the owner's site without sanitization.
- Run `npm install`, create D1/KV, replace the placeholder IDs, execute `schema.sql` remotely, then deploy. Verify signup through published delivery before release.
