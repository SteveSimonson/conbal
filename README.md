# Conbal

Conbal delivers owner-authored HTML/CSS content balloons to any site. Cloudflare D1 holds users, sites, and drafts; KV holds authenticated sessions and published balloon payloads.

## Deploy

1. Install dependencies with `npm install`.
2. Create one D1 database and one KV namespace, then replace both `REPLACE_WITH_*` values in `wrangler.jsonc`. Do not commit real IDs or `.dev.vars`.
3. For a new database, run the schema once against the intended D1 database:

   ```sh
   npx wrangler d1 execute conbal-db --remote --file=schema.sql
   ```

   Existing databases must apply every numbered migration they have not already received, in order. A database that predates Google login needs both upgrades:

   ```sh
   npx wrangler d1 execute conbal-db --remote --file=migrations/001_google_oauth.sql
   npx wrangler d1 execute conbal-db --remote --file=migrations/002_delivery_analytics.sql
   ```

   A database already upgraded through `002_delivery_analytics.sql` needs the
   dynamic editorial metadata upgrade before deploying the sampling Worker:

   ```sh
   npx wrangler d1 execute conbal-db --remote --file=migrations/003_balloon_sampling_metadata.sql
   ```

   A database upgraded through `003_balloon_sampling_metadata.sql` must create
   the bounded Smart Delivery index before the v2 Worker is deployed:

   ```sh
   npx wrangler d1 execute conbal-db --remote --file=migrations/004_smart_delivery_index.sql
   ```

4. Optionally create `.dev.vars` from `.dev.vars.example` and set `SIGNUP_INVITE_CODE` to restrict account creation.
5. Run `npm run validate`; it intentionally fails while the binding IDs are placeholders.
6. Deploy with `npm run deploy`. For every site that already has published
   inventory, sign in as its owner and call
   `POST /api/sites/<site-id>/balloons/reindex` once. Require `skipped: 0` and
   confirm `indexed` equals the published-balloon count. This backfill is
   mandatory; an empty result means v2 correctly has no indexed inventory.
7. Verify `/api/health`, Google login, site creation, balloon publishing, v1
   delivery from `/b/<site-key>/<slug>`, and a structured v2 request to
   `/v2/b/<site-key>/sample`. The v2 response must be `200`, CORS-readable, and
   contain plain-text assignments for known eligible inventory.

## Google login

Create an External web OAuth client in Google Auth Platform. Use `https://conbal.us` as the authorized JavaScript origin and `https://conbal.us/api/auth/google/callback` as the authorized redirect URI. Publish the OAuth app when it is ready for users. Conbal uses Google as its only sign-in method; the previous email/password endpoints return `410 Gone`.

Store the credentials as encrypted Worker secrets; never put their values in Wrangler config, `.dev.vars.example`, or Git:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

The login page sends an invite code to Conbal over `POST`, not in a URL. When `SIGNUP_INVITE_CODE` is configured, existing Google-linked accounts can still sign in, while new Google users must supply the valid code. Existing password-era accounts are linked automatically when the verified Google email matches; their sites and content remain attached to the same account.

## CSV imports and multiple sites

Each account can own multiple sites. The dashboard site selector keeps balloon creation, listing, and CSV imports scoped to the selected site.

Download `/admin/example-balloons.csv` from the dashboard and keep the required columns `title,slug,size,html,css`. The dashboard also provides `/admin/content-balloon-csv-llm-guide.md`, an exhaustive, downloadable generation contract and prompt template for other LLMs. Imports accept standard quoted CSV fields, including commas, doubled quotes, and embedded newlines. A file may contain up to 100 balloons and 512 KB; the whole import is validated before one atomic write. Imported balloons are always drafts and never overwrite or publish existing slugs.

Editorial libraries may add the optional `editorial_type` and `topics` columns.
The dashboard can also apply a metadata-only `slug,editorial_type,topics` CSV
to existing balloons, and can publish all reviewed drafts for the selected
site. Topic lists contain up to eight comma-separated lowercase tags; omitted
metadata defaults to `did_you_know` and `general`.

## Container-safe embeds

### Universal automatic integration

For a new site, the only required installation is one script tag. Create the
site in the Conbal dashboard, publish its editorial inventory, and paste the
site key into the tag:

```html
<script
  defer
  src="https://conbal.us/embed.js"
  data-conbal-site="YOUR_SITE_KEY"
  data-conbal-auto>
</script>
```

The automatic runtime reads the visible page title, headings, path, and text
density, then lets the page determine how many insertions it can support. It
starts with one useful insertion for a qualifying page, adds another roughly
every 360 words, and caps the result by the number of safe semantic anchors.
The v2 contract retains an eight-slot abuse/readability ceiling, but there is
no arbitrary minimum of three. It requests one fresh structured deck, remembers
recent slugs in the browser, and renders host-native text cards with no owner
HTML or CSS. It skips checkout, account, admin, navigation, forms, and pages
that are too short to benefit. If delivery fails or a slot cannot be filled,
that slot is removed and the host page is unchanged. For single-page
applications, route changes are observed automatically.

Automatic cards load their styles from `https://conbal.us/embed.css` and fetch
content from `https://conbal.us`; sites using a Content-Security-Policy should
allow that origin in both `style-src` and `connect-src` (for example,
`style-src 'self' https://conbal.us; connect-src 'self' https://conbal.us`).
The loader does not inject an inline style tag or inline style attributes for
automatic cards.

Use `data-conbal-managed="true"` on a host root when the site has its own
renderer and should opt out of automatic placement while keeping the same
loader available for explicit slots.

The existing explicit-slot integration remains supported:

Use `responsive` unless the host page has deliberately reserved an exact-size
container:

```html
<div data-conbal-site="YOUR_SITE_KEY" data-conbal="YOUR_SLUG" data-size="responsive"></div>
<script src="https://conbal.us/embed.js" defer></script>
```

The loader keeps a slot collapsed until it receives valid content whose size
matches `data-size`. Responsive content adopts the host container width and
controls its own height. Fixed sizes are opt-in: use one only when the host
container is exactly the declared width and height. A missing balloon, failed
request, invalid size, or size mismatch stays collapsed instead of reserving a
blank or misleading block. Legacy embeds that omit `data-size` adopt the valid
size declared by the delivered balloon.

## Dynamic editorial sampling

Adaptive pages can request one randomized deck per page load:

```http
GET /b/{siteKey}/_sample?nonce={requestId}&slots={urlEncodedJson}&exclude_slugs={commaSeparatedRecentSlugs}
```

`slots` is a JSON array of one to eight objects with `id`, `size`, `topics`,
and `editorial_types`. A slot may also include `layout` with one of `inline`,
`panel`, `product-card`, `banner`, `rail`, or `fixed`. Container-native
`inline`, `panel`, and `product-card` placements require `size: "responsive"`;
fixed-size content is rejected for those layouts. Conbal selects distinct
published balloons that match the exact requested size, prefers topic matches,
falls back to the `general` topic, and echoes a supplied `layout` in the slot
output. Omitting `layout` preserves the original response contract.

Selection uses server-side WebCrypto randomness, responses are `no-store`, and
the nonce prevents intermediaries from coalescing page-load requests. Hosts may
send up to 30 validated slugs in `exclude_slugs`; compatible unseen balloons
are preferred, while excluded items are considered only after the fresh pool
is exhausted. Missing candidates are omitted so host pages can fail closed.
The legacy explicit-slug endpoint remains unchanged.

For host-rendered, container-aware components, use the structured `POST`
contract documented in [`docs/SMART-DELIVERY-V2.md`](docs/SMART-DELIVERY-V2.md).
Smart Delivery v2 returns bounded headline/body text instead of owner HTML/CSS,
uses stable page-view assignments, and omits repeats when inventory runs out.

## Delivery analytics

Conbal counts each successfully returned published balloon once per public delivery request. Repeated instances of the same slug in one loader request count once; missing, draft, and unpublished balloons do not count. Balloon totals roll up additively by configured site and account. Recording is asynchronous and best-effort so analytics never delay content delivery. Counts are delivery calls—not unique people—and may include reloads, bots, and direct API clients.

The public balloon endpoint, site keys, and owner-provided balloon markup are intentionally public. Treat the HTML/CSS as trusted only when it is authored by the site owner.

## Local development

Use `npm run dev` after providing local D1/KV bindings in Wrangler. `npm run preview` runs against remote bindings and can mutate real service data, so use a dedicated preview D1 database and KV namespace.
