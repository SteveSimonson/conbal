# Smart Delivery v2

Smart Delivery v2 returns structured copy for host-owned components. It never
returns balloon HTML, CSS, colors, typography, spacing, or other presentation
instructions. The existing `/b/...` routes remain the v1 API and are unchanged.

## Endpoint

```http
POST /v2/b/{siteKey}/sample
Content-Type: application/json
```

The endpoint is public, returns JSON, permits cross-origin reads, and sends
`Cache-Control: no-store`. A valid request has this shape:

```json
{
  "contract": "2.0",
  "page_view_id": "01JY8T0WRQQV9JXE2R7NP6N73N",
  "repeat_policy": "omit",
  "exclude_slugs": ["recent-balloon"],
  "slots": [
    {
      "id": "article-note-1",
      "role": "inline-note",
      "topics": ["home", "bamboo"],
      "editorial_types": ["did_you_know", "care_tip"],
      "budget": "compact-v1"
    }
  ]
}
```

Top-level and slot fields are closed: unknown fields are rejected. The
requirements are:

- `contract` is exactly `2.0`.
- `page_view_id` is 1–128 URL-safe identifier characters (`A-Z`, `a-z`,
  `0-9`, `.`, `_`, `:`, or `-`). Reuse it for every retry of one page view.
- `repeat_policy` is exactly `omit`. v2 never forces a repeated balloon.
- `exclude_slugs` is optional. When present, it is a unique array of at most
  30 valid Conbal slugs.
- `slots` contains 1–8 entries with unique `id` values.
- `role` is `inline-note`, `section-break`, `grid-tile`, or `aside-note`.
- `topics` contains 1–8 unique lowercase topic tokens.
- `editorial_types` contains unique values from Conbal's supported editorial
  types: `did_you_know`, `fun_fact`, `care_tip`, `design_note`,
  `material_myth`, `nature_note`, and `culture_craft`.
- `budget` is `compact-v1` or `standard-v1`.

## Copy budgets

Budget identifiers are versioned so their limits cannot silently change:

| Budget | Headline | Body |
| --- | ---: | ---: |
| `compact-v1` | 48 characters | 110 characters |
| `standard-v1` | 72 characters | 180 characters |

Conbal enforces these limits using JavaScript string length, matching the host
validator, and avoids leaving a split surrogate pair at a truncation boundary.
Hosts must still handle ordinary text wrapping inside their own components.

## Shared automatic renderer

Hosts that do not need hand-selected placements can use the shared v2 renderer:

```html
<script
  defer
  src="https://conbal.us/embed.js"
  data-conbal-site="YOUR_SITE_KEY"
  data-conbal-topics="site-topic,another-site-topic"
  data-conbal-max-slots="4"
  data-conbal-auto>
</script>
```

`data-conbal-topics` is optional and site-scoped: each topic only needs to be
relevant to the host site, not to every route. The loader adds `general`, keeps
assignments unique, and defaults to at most four placements. The loader chooses
safe semantic block boundaries and breaks out of cards, grids, flex rows,
heroes, CTAs, lists, and narrow containers. It creates hidden placeholders,
requests this v2 endpoint, waits for the external scoped stylesheet, validates
the returned role, budget, slug, and copy lengths, and only then reveals text
through DOM `textContent`. Delivery, validation, timeout, or stylesheet failure
removes the placeholder without reserving page geometry.

Applications with their own components should call the endpoint directly and
keep `data-conbal-managed="true"` on their host root if `embed.js` is also
present. The API response contains no presentation instructions; automatic and
managed hosts use the same v2 delivery semantics.

## Response

```json
{
  "assignments": {
    "article-note-1": {
      "assignment_id": "v2_1f552a610718523f44991eb10b0f8bd3",
      "slug": "why-bamboo-bends",
      "role": "inline-note",
      "budget": "compact-v1",
      "editorial_type": "did_you_know",
      "content": {
        "headline": "Bamboo bends without giving up strength",
        "body": "Its long fibers distribute stress along the culm instead of concentrating it at one point."
      }
    }
  }
}
```

Assignment values contain plain content only. `assignment_id` is a stable,
opaque identifier derived from the page-view ID, slot ID, and selected slug.
The host owns the component, role layout, colors, spacing, typography,
accessibility markup, and responsive
behavior. Render `content.headline` and `content.body` as text, not with
`innerHTML`.

The `assignments` object can contain fewer entries than requested, including zero.
An absent entry is the intentional fail-closed result when published inventory
cannot satisfy its editorial filters, topic fallback, uniqueness, and repeat
constraints. Hosts should leave that component collapsed or render their own
fallback.

## Selection behavior

Only balloons whose D1 status is `published` and whose `editorial_type` is
allowed by the slot are candidates. Selection proceeds as follows:

1. Remove every slug in `exclude_slugs` and every slug already assigned in
   this deck.
2. Prefer candidates with exact topic-token matches. More requested topic
   matches rank ahead of fewer matches.
3. Use `general` candidates only as the fallback pool.
4. Solve the requested deck as one assignment problem, so a flexible slot
   cannot consume the only relevant candidate for a more specific slot.
5. Within the same relevance tier, use a stable rank derived from
   `page_view_id`, slot ID, and candidate slug.

Publishing precomputes safe structured copy and writes one indexed lookup row
per balloon topic. Delivery therefore never scans or reparses the site's raw
HTML. Each requested topic performs a bounded indexed lookup of at most 16
candidates (plus enough headroom for the request's explicit exclusions), and
the deck optimizer works only on those small plain-text rows. The whole request
is capped at 32 KiB and the stream is cancelled as soon as it crosses that
bound. Retrying an equivalent request with the same page-view ID produces the
same unique assignments even if D1 returns rows in a different order.
Inventory or request changes can, appropriately, change the deck.

Existing published inventory can be indexed after migration with the
authenticated owner operation `POST /api/sites/{siteId}/balloons/reindex`.
Normal publish, edit, metadata-import, unpublish, and delete operations maintain
the index automatically after that one-time backfill.

## Source-to-text conversion

When a balloon is published or reindexed, Conbal removes markup, comments, and
non-content blocks such as `script`, `style`, `template`, `noscript`, and `svg`
without evaluating them. The first visible heading or strong headline is used;
when neither exists, the balloon's D1 title is the fallback. Template labels,
serial numbers, and marks are excluded while the longest body-copy fragment
becomes the body. Only the resulting bounded plain text enters the indexed v2
table. The legacy published KV HTML/CSS payload continues to serve v1 and is
never exposed by v2.

## Errors

Malformed JSON or a contract validation failure returns `400` with a JSON
`error`; oversized bodies return `413`. Unsupported methods return `405`;
malformed paths and site keys return `404`. All v2 responses include the CORS
headers needed for host sites to read success and failure. Valid requests return
`200` even when the deck is empty.
