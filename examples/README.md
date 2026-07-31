# Conbal live examples

`demo-balloons.json` is the source of truth for the permanent balloons shown on
the public homepage. They belong to a dedicated system-owned demo site so live
example calls never mix with customer analytics.

Operational rules:

- Keep the public site key and slugs stable; the homepage embeds them directly.
- Provision the site once, then update the D1 balloon rows and corresponding KV
  delivery values together when creative changes.
- Store `balloonId`, `html`, `css`, and `size` in KV. The delivery endpoint strips
  the internal ID before returning public JSON.
- Never attach the examples to a customer account and never put credentials or
  Cloudflare resource IDs in this directory.
- After publishing, verify all three slugs through `/b/CONBALDEMO01/...` and load
  `/` at desktop and mobile widths.
