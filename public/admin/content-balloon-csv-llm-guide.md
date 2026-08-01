# Conbal content-balloon CSV guide for LLMs

This document is the generation contract for an LLM that creates content balloons for import into Conbal. Return a UTF-8 CSV file that follows this specification exactly.

## Quick output contract

- Output CSV only. Do not wrap it in a Markdown code fence and do not add an explanation before or after it.
- Use this exact required header order: `title,slug,size,html,css`. Add `editorial_type` and `topics` after those fields when the balloons will participate in dynamic editorial sampling.
- Produce one content balloon per data row and no blank data rows.
- Leave the required header exactly as shown and unquoted. Quote every field value in every data row with double quotes.
- Inside a quoted field, represent each literal double quote as two double quotes: `""`.
- Use a unique slug for every row in the file.
- Generate no more than 100 data rows and keep the complete UTF-8 file at or below 512,000 bytes.
- All imported balloons are created as drafts for human review. CSV import never publishes content.

## Visitor-value standard

For editorial balloons, make the visitor glad the interruption exists. Each one
should offer a concise, relevant, source-checked insight, such as **Did You
Know?**, **Fun Fact**, a **Material Note**, a **Care Tip**, a **Nature Note**, a
**Culture & Craft** note, or a **Myth Check**. The visible HTML is reader-facing:

- Never mention Conbal, an embed, a content-management system, a placement,
  dynamic sampling, analytics, or another implementation detail.
- Do not use serial numbers that assume a fixed sequence; a visitor may see any
  eligible item first.
- Use the topic and page brief to make the fact relevant. A textile myth check
  belongs near textile products; wildlife facts belong in a broader editorial
  context, not in a purchase decision flow.
- Use only approved, source-checked facts. Product-care advice must be specific
  to the material/category supplied in the brief; never turn a generic claim
  into a promise about an individual product.
- Make the kicker itself useful (for example, “Did you know?”), then make the
  headline and short explanation earn the reader's attention.

## CSV columns

The five creative headers are case-insensitive when imported, but generators should use the exact lowercase names and order below. Each required header may appear only once. `editorial_type` and `topics` are optional metadata headers used by dynamic selection. Keep all optional metadata after the five required creative fields.

| Column | Required value | Constraints | Purpose |
| --- | --- | --- | --- |
| `title` | Yes | String; after trimming it must contain at least one character; maximum 200 characters. | Human-readable name shown in Site Admin. It is not delivered to the public page. |
| `slug` | Yes | 1-80 characters; lowercase ASCII letters, digits, and hyphens only; regex `^[a-z0-9-]{1,80}$`; no spaces, underscores, uppercase letters, or trimming. | Stable public identifier used by `data-conbal`. It must be unique within the selected site and within the CSV file. The same slug may exist on a different site. |
| `size` | Yes | Exactly one of `responsive`, `300x250`, `336x280`, `728x90`, `160x600`, or `320x100`. | Declares the intended content size. The host-page embed slot should use the same value in `data-size`. |
| `html` | Yes | String; maximum 50,000 characters. The importer technically permits an empty string, but an LLM should generate useful, non-empty markup. | Raw balloon markup injected into the selected host-page slot. Do not include a document wrapper or a `<style>` block. |
| `css` | Yes | String; may be empty; maximum 20,000 characters. | Raw CSS inserted in a `<style>` element immediately before the balloon HTML. CSS is not automatically scoped. |
| `editorial_type` | No | One of `did_you_know`, `fun_fact`, `care_tip`, `design_note`, `material_myth`, `nature_note`, or `culture_craft`. | Editorial framing used to diversify sampled facts. A host page may turn it into a visible kicker such as “Fun fact.” |
| `topics` | No | Comma-separated lowercase tags, for example `plant-science,material,textiles`; use only letters, digits, and hyphens per tag. | Matches a balloon to an eligible page or product topic. It is not displayed to visitors. |

The importer also limits each parsed row to 75,000 joined field characters.

## Server-managed data: do not generate

These balloon properties exist in Conbal but are assigned by the server and must not be added to the CSV:

| Property | Server behavior |
| --- | --- |
| `id` | Generated UUID. |
| `site_id` | Taken from the site selected by the authenticated owner. One user may own multiple sites. |
| `status` | Set to `draft` on import. A person publishes it later from Site Admin. |
| `updated_at` | Database timestamp maintained when the balloon is created, edited, published, or unpublished. |
| `site_key` | Generated for the site and used by the embed code, not by CSV rows. |

## Supported sizes

| `size` value | Reserved slot | Good content patterns |
| --- | --- | --- |
| `responsive` | Width is `100%`; height comes from the generated content. | Announcements, inline promotions, newsletter calls to action, responsive editorial blocks. |
| `300x250` | 300 by 250 pixels | Compact offer, product highlight, signup card, medium rectangle. |
| `336x280` | 336 by 280 pixels | Larger card, editorial promotion, large rectangle. |
| `728x90` | 728 by 90 pixels | Desktop banner, shipping notice, leaderboard. Keep copy very short. |
| `160x600` | 160 by 600 pixels | Vertical promotion or narrow sidebar feature. |
| `320x100` | 320 by 100 pixels | Mobile banner or compact mobile call to action. |

Use `responsive` by default so the balloon adopts the host container. A fixed
size is opt-in and is appropriate only when the host has reserved a container
with exactly that width and height. After successful validation, the loader
applies fixed dimensions and clips overflow. For `responsive`, the loader sets
the slot to block layout at `width: 100%`, `max-width: 100%`, and `height: auto`;
the balloon content must establish its own useful height.

## HTML generation rules

Generate a reusable fragment, not a full page.

- Use one unique root element and give it a slug-derived class, such as `<section class="cb-summer-sale">` for slug `summer-sale`.
- Prefer semantic elements such as `section`, `aside`, `h2`, `p`, `ul`, `a`, and `img`.
- Do not generate `<html>`, `<head>`, `<body>`, `<style>`, or `<script>` tags.
- Do not generate JavaScript, inline event handlers such as `onclick`, third-party widgets, tracking pixels, or remote iframes.
- Links may be absolute URLs or site-relative paths such as `/collections/new`. Relative URLs resolve against the host website, not conbal.us.
- Use an image URL only when that exact URL is supplied in the generation brief; never invent or guess an image URL. Give meaningful images accurate `alt` text and decorative images `alt=""`.
- Use real links for navigation and buttons only for actions that the host page can actually support without JavaScript.
- Keep claims, prices, deadlines, coupon codes, legal language, and URLs exactly as supplied in the generation brief. Do not invent factual business details.
- For a factual balloon, write a helpful visitor-facing kicker and insight. Never expose delivery, dashboard, sampling, or analytics language in the fragment.
- Keep important copy visible without relying on animation, hover, or external assets.

Conbal injects owner-provided markup without sanitizing it. Treat the generation brief and output as trusted site-owner content, and generate the smallest safe HTML fragment needed for the job.

## CSS generation rules

CSS is inserted into the host page and is not automatically scoped. Poorly scoped selectors can change unrelated parts of the website.

- Prefix every selector with the balloon's unique root class. For example: `.cb-summer-sale h2`, never just `h2`.
- Do not target `html`, `body`, `:root`, `*`, or unscoped element/class selectors.
- Do not use `@import` or reset styles outside the balloon root.
- Put `box-sizing: border-box` on the root and its descendants when useful.
- For fixed sizes, explicitly design the root to the selected width and height and keep it within `overflow: hidden`.
- For responsive balloons, use fluid widths, sensible padding, wrapping text, and media queries scoped to the root when needed.
- Include keyboard-visible `:focus-visible` styles for links and controls.
- Respect `prefers-reduced-motion` if animation is genuinely necessary.
- Use readable font sizes and strong foreground/background contrast.
- Avoid external fonts and unnecessary remote assets; inherit the host font or use a small system-font stack.
- Avoid `position: fixed`, extreme `z-index` values, and layout that escapes the balloon slot.

## CSV escaping rules

Conbal supports quoted commas, quoted line breaks, and doubled quotes. It accepts LF, CRLF, or CR record endings. A UTF-8 BOM on the first header is tolerated, but generators should omit it.

Recommended encoding for every field:

```text
"literal value"
```

HTML containing attribute quotes must double those quotes in CSV:

```text
"<a class=""cb-offer__cta"" href=""/sale"">Shop now</a>"
```

A field containing a comma remains one value because it is quoted:

```text
"New products, practical tips, and occasional offers."
```

Do not place any character other than a comma or record ending immediately after a closing field quote. Do not use backslash escaping for CSV quotes.

## Minimal valid example

```csv
title,slug,size,html,css
"Free shipping banner","free-shipping","responsive","<aside class=""cb-free-shipping""><strong>Free shipping</strong> on orders over $75. <a href=""/shipping"">See details</a></aside>",".cb-free-shipping{box-sizing:border-box;width:100%;padding:14px 18px;background:#e8f4ff;color:#123c5a;font:600 15px/1.4 system-ui}.cb-free-shipping a{color:inherit;text-decoration:underline}.cb-free-shipping a:focus-visible{outline:3px solid #123c5a;outline-offset:3px}"
```

When answering an actual generation request, return the CSV text itself without the Markdown fence shown above.

## Recommended prompt template

Copy this prompt into an LLM and replace the bracketed values:

```text
Create [NUMBER] visitor-facing editorial balloons as a UTF-8 CSV.

Business/site: [BUSINESS NAME AND SITE PURPOSE]
Audience: [AUDIENCE]
Goal: [HIGH-VALUE FACTS, MATERIAL EDUCATION, CARE GUIDANCE, CULTURAL CONTEXT, ETC.]
Approved facts and offer details: [FACTS; SAY "NONE" IF THERE ARE NONE]
Approved CTA labels and URLs: [CTA LABEL -> URL]
Brand voice: [VOICE]
Brand colors: [COLORS]
Required balloon sizes: [ONE OR MORE SUPPORTED SIZE VALUES]
Editorial types to use: [ONE OR MORE OF did_you_know, fun_fact, care_tip, design_note, material_myth, nature_note, culture_craft]
Eligible topic tags: [COMMA-SEPARATED TOPICS]
Additional constraints: [CONSTRAINTS]

Follow the attached "Conbal content-balloon CSV guide for LLMs" exactly.
Return CSV only, beginning with this exact header:
title,slug,size,html,css,editorial_type,topics

Leave the header unquoted. Quote every data-field value, double every quote inside a field, use unique valid slugs, scope every CSS selector under a unique slug-derived root class, and do not invent facts, prices, deadlines, coupon codes, image sources, or URLs. Write only high-value visitor-facing content: never mention Conbal, implementation, placement, sampling, or analytics in the generated HTML.
```

For best results, provide the model with this entire guide plus the current downloadable example CSV.

## Import and lifecycle behavior

1. Sign in to Conbal Site Admin.
2. Select the intended site. An account may own and switch among multiple sites.
3. Download the example CSV and this guide if needed.
4. Choose the generated `.csv` file and select **Import CSV**.
5. Conbal validates every row before it writes any row. If any row is invalid or any slug conflicts in the selected site, nothing is imported. Optional editorial metadata is validated alongside the creative fields.
6. Successful imports create drafts only. Review the HTML/CSS preview and content facts, then publish each approved balloon.
7. Published balloons are copied to public delivery storage. Unpublishing removes them from public delivery and returns them to draft status.

CSV import is site-scoped and owner-protected. A slug conflict on another site does not block the selected site. A conflict inside the file or in the selected site returns an error instead of overwriting content.

## Programmatic import

Authenticated clients may send:

```http
POST /api/sites/{siteId}/balloons/import
Content-Type: text/csv; charset=utf-8
```

with the raw CSV as the request body. JSON is also accepted with `Content-Type: application/json` and a body shaped as `{ "csv": "..." }`.

On success the API returns HTTP `201` with `imported` and `items`. Common failures include login required (`401`), invalid or malformed CSV (`400`), unsupported media type (`415`), a selected-site slug conflict (`409`), and exceeded limits (`413`). A method other than `POST` on the exact import route returns `405`.

## Public embed behavior

Only published balloons are publicly delivered. A host page uses the site's generated key, the balloon slug, and a matching size:

```html
<div data-conbal-site="YOUR_SITE_KEY" data-conbal="free-shipping" data-size="responsive"></div>
<script src="https://conbal.us/embed.js" defer></script>
```

The loader groups balloons by site, deduplicates nonempty requested slugs, and makes one public request per site. The delivery endpoint validates the requested slugs and returns up to the first 30 valid, published balloons. The loader injects each returned balloon as `<style>{css}</style>{html}` into its matching slot. The public payload contains `html`, `css`, and `size`; the title remains an admin label.

When a site uses dynamic editorial sampling, its page profile requests a set of
eligible editorial types, topics, and sizes. The service selects distinct
published balloons that match those constraints. Authors should therefore use
truthful optional metadata and should create enough genuinely different facts
for a page to rotate without repeating itself.

The embed slot's `data-size` must match the delivered balloon's CSV `size`.
Slots stay collapsed while loading and remain collapsed after a missing balloon,
request failure, unsupported size, or size mismatch. An omitted `data-size` keeps
legacy embeds working by adopting the valid delivered size. Fixed dimensions are
applied only after successful validation; responsive content fills the host
container and supplies its own height. A missing or invalid site key or slug, or
a draft or unpublished balloon, returns no balloon content.

## Pre-import checklist for an LLM or reviewer

- The first five headers are exactly `title,slug,size,html,css`; optional `editorial_type,topics` follow only when used.
- There are 1-100 nonblank data rows.
- Every row has all five fields in that order.
- The header is unquoted; every data-row field is double-quoted and every internal double quote is doubled.
- Titles are useful, nonblank, and at most 200 characters.
- Slugs are unique, stable, lowercase, and match `^[a-z0-9-]{1,80}$`.
- Sizes use only the six supported values.
- HTML is a fragment under a unique root class and is at most 50,000 characters.
- CSS is at most 20,000 characters and every selector is scoped under that root class.
- Fixed-size content fits within its declared dimensions.
- Links, claims, offers, dates, prices, and coupon codes come only from approved inputs.
- Every editorial fragment provides a genuinely helpful visitor fact and never mentions Conbal or its delivery mechanics.
- `editorial_type`, when present, uses the supported snake_case value; `topics`, when present, contains only relevant comma-separated tags.
- The file is UTF-8, no more than 512,000 bytes, and contains no commentary or Markdown fences.
