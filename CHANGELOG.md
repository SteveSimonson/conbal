# Changelog

All notable production changes to Conbal are recorded here.

## [0.1.0] - 2026-08-18

### Added

- **Shared Smart Delivery v2 renderer**: automatic integrations can use site-level topics and a deliberately bounded one-to-eight slot density, defaulting to four.
- **Release contract**: Conbal now records one product version across `package.json`, `version.js`, and this changelog.

### Fixed

- **Container-safe placement**: automatic notes break out of cards, grids, flex rows, lists, heroes, CTAs, multi-column regions, and narrow containers before insertion.
- **No unstyled flash**: structured text remains hidden until the scoped Conbal stylesheet loads; style, delivery, validation, and timeout failures leave no page geometry behind.
- **Responsive containment**: shared cards constrain grid tracks and long text so host pages do not gain horizontal overflow.

### Operations

- No database migration is required.
- Deploy the Cloudflare Worker and static assets together so `embed.js` and `embed.css` remain compatible.
