# Conbal

Conbal delivers owner-authored HTML/CSS content balloons to any site. Cloudflare D1 holds users, sites, and drafts; KV holds authenticated sessions and published balloon payloads.

## Deploy

1. Install dependencies with `npm install`.
2. Create one D1 database and one KV namespace, then replace both `REPLACE_WITH_*` values in `wrangler.jsonc`. Do not commit real IDs or `.dev.vars`.
3. For a new database, run the schema once against the intended D1 database:

   ```sh
   npx wrangler d1 execute conbal-db --remote --file=schema.sql
   ```

   For an existing pre-Google-login database, apply the upgrade instead:

   ```sh
   npx wrangler d1 execute conbal-db --remote --file=migrations/001_google_oauth.sql
   ```

4. Optionally create `.dev.vars` from `.dev.vars.example` and set `SIGNUP_INVITE_CODE` to restrict account creation.
5. Run `npm run validate`; it intentionally fails while the binding IDs are placeholders.
6. Deploy with `npm run deploy`, then verify `/api/health`, signup, login, site creation, balloon publishing, and delivery from `/b/<site-key>/<slug>`.

## Google login

Create an External web OAuth client in Google Auth Platform. Use `https://conbal.us` as the authorized JavaScript origin and `https://conbal.us/api/auth/google/callback` as the authorized redirect URI. Publish the OAuth app when it is ready for users.

Store the credentials as encrypted Worker secrets; never put their values in Wrangler config, `.dev.vars.example`, or Git:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

The login page sends an invite code to Conbal over `POST`, not in a URL. When `SIGNUP_INVITE_CODE` is configured, existing Google-linked accounts can still sign in, while new Google users must supply the valid code.

The public balloon endpoint, site keys, and owner-provided balloon markup are intentionally public. Treat the HTML/CSS as trusted only when it is authored by the site owner.

## Local development

Use `npm run dev` after providing local D1/KV bindings in Wrangler. `npm run preview` runs against remote bindings and can mutate real service data, so use a dedicated preview D1 database and KV namespace.
