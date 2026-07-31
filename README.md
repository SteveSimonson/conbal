# Conbal

Conbal delivers owner-authored HTML/CSS content balloons to any site. Cloudflare D1 holds users, sites, and drafts; KV holds authenticated sessions and published balloon payloads.

## Deploy

1. Install dependencies with `npm install`.
2. Create one D1 database and one KV namespace, then replace both `REPLACE_WITH_*` values in `wrangler.jsonc`. Do not commit real IDs or `.dev.vars`.
3. Run the schema once against the intended D1 database:

   ```sh
   npx wrangler d1 execute conbal-db --remote --file=schema.sql
   ```

4. Optionally create `.dev.vars` from `.dev.vars.example` and set `SIGNUP_INVITE_CODE` to restrict account creation.
5. Run `npm run validate`; it intentionally fails while the binding IDs are placeholders.
6. Deploy with `npm run deploy`, then verify `/api/health`, signup, login, site creation, balloon publishing, and delivery from `/b/<site-key>/<slug>`.

The public balloon endpoint, site keys, and owner-provided balloon markup are intentionally public. Treat the HTML/CSS as trusted only when it is authored by the site owner.

## Local development

Use `npm run dev` after providing local D1/KV bindings in Wrangler. `npm run preview` runs against remote bindings and can mutate real service data, so use a dedicated preview D1 database and KV namespace.
