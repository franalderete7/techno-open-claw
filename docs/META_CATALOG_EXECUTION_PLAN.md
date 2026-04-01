# Meta Catalog Execution Plan

Date: April 1, 2026
Scope: TechnoStore product catalog, feed delivery, event matching, and ad workflow integration

## Executive Summary

Meta Catalog is worth doing for TechnoStore, but only if we treat it as an operational system, not just an export.

The catalog itself is only the first layer. The real value comes from:

- a clean product feed with stable IDs
- public product URLs and public image URLs
- matching site/server events that reference the same product IDs
- product sets and labels that let us segment Apple, Samsung, used, premium, financing, and margin bands

For TechnoStore, the correct v1 path is:

1. Use the current app database as the source of truth.
2. Export a Meta-compatible feed from the API.
3. Load that feed into one Commerce catalog through Commerce Manager.
4. Make `sku` the canonical catalog item ID everywhere.
5. Add Meta Pixel plus Conversions API events that send the same IDs and deduplicate correctly.
6. Build product sets for brand, condition, price band, and financing.

My recommendation is to start with a feed-driven integration first, not a full write-to-Graph batch sync. It is simpler, easier to debug, safer operationally, and a better fit for your current stack.

## Why This Matters

Meta's official docs describe the Product Catalog as the catalog object a business can use to deliver ads with dynamic ads, and they explicitly state that you can associate pixels and apps with a product catalog and display products in ads based on those signals.

That matters because TechnoStore is not selling generic awareness. You want product-led demand:

- "show this iPhone to people who viewed this iPhone"
- "retarget Apple visitors with Apple inventory"
- "promote premium in-stock products with margin room"
- "separate new vs used vs refurbished inventory"

Meta also documents that its Pixel standard events such as `ViewContent`, `Search`, `AddToCart`, and `Purchase` can carry `content_ids` and `contents`, and for Advantage+ catalog ads those product identifiers are required on key events. If the event IDs do not match your catalog IDs, the catalog becomes much less useful.

## What Meta Catalog Should Power For TechnoStore

### Immediate goals

- Apple product ads
- Collection ads with a cover creative plus catalog items
- Retargeting for people who viewed specific products
- Brand-segmented product sets: Apple, Samsung, Xiaomi
- Margin-aware and financing-aware product sets

### Later goals

- Advantage+ catalog ads
- Automated retargeting by brand and price band
- Creative overlays and custom labels for profitability, urgency, and financing
- Better ad reporting tied back to actual inventory and orders

## Current Repo Readiness

The repo is already in good shape for a first Meta catalog rollout.

### Existing data we can use

Current product APIs and schema already expose the fields we need for a strong v1 feed:

- `sku`
- `slug`
- `brand`
- `model`
- `title`
- `description`
- `category`
- `condition`
- `price_amount`
- `promo_price_ars`
- `currency_code`
- `active`
- `in_stock`
- `image_url`
- `color`
- `ram_gb`
- `storage_gb`
- `network`
- `delivery_days`
- `battery_health`

Relevant code:

- `apps/api/src/index.ts`
- `apps/web/lib/api.ts`
- `apps/web/lib/storefront.ts`
- `db/migrations/001_initial_schema.sql`

### Existing Meta groundwork

The API already has Meta ads configuration and Graph access wiring:

- `apps/api/src/meta-ads.ts`
- `apps/api/src/routes/meta-ads-api.ts`
- `apps/api/src/config.ts`

Meta env/config already exists:

- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `META_BUSINESS_ID`
- `META_API_VERSION`
- `META_GRAPH_API_BASE`

### Current gap

There is no catalog feed, no catalog diagnostics workflow, and no Pixel/CAPI event layer yet. That is the missing piece.

## Recommended Architecture

### Source of truth

TechnoStore app database remains the source of truth.

Do not manage catalog items manually inside Meta unless there is an emergency. Manual edits create drift.

### Recommended v1 delivery model

Use a scheduled feed loaded from TechnoStore.

Recommended flow:

1. Product data lives in Postgres.
2. API builds a Meta-compatible TSV feed from active sellable products.
3. Meta Commerce Manager fetches that feed on a schedule.
4. Pixel and CAPI events reference the same item IDs.
5. Meta diagnostics are reviewed regularly.

This is better than writing items directly through the Graph API in v1 because:

- feed behavior is easier to inspect
- feed failures are easier to fix
- Meta officially supports product feeds and scheduled fetches
- it reduces the risk of partial write drift

### Canonical identity rule

Use `sku` as the canonical catalog product ID everywhere.

That means:

- Meta feed `id` should equal `sku`
- Meta feed `retailer_id` should equal `sku`
- Pixel `content_ids` should contain `sku`
- Pixel `contents[].id` should equal `sku`
- CAPI event payload should use the same product ID
- order attribution and reporting should always map back to `sku`

This rule is non-negotiable. If IDs drift, retargeting and catalog ads break.

## Recommended Feed Strategy

### Start with one primary commerce catalog

Use one main commerce catalog for the store, not one catalog per brand.

Inside that catalog, create product sets such as:

- Apple
- Samsung
- Xiaomi
- New
- Used
- Refurbished
- Premium over a chosen ARS threshold
- Financing eligible
- In-stock fast movers

This keeps ad operations simpler while preserving segmentation power.

### Start with one primary feed

Use one primary feed first.

Only add supplementary feeds later if you specifically need to override titles, labels, or campaign metadata without changing source product data.

Meta's Product Feed reference also distinguishes:

- a full recurring `schedule` that replaces the feed contents
- an `update_schedule` for update-style refreshes such as price and availability changes

Recommendation:

- v1: use one `PRIMARY_FEED` with a full recurring schedule
- v2: add an update-only feed if stock and price churn becomes operationally painful

### Feed format

For v1, generate TSV.

Why TSV first:

- Meta's Product Item reference includes a TSV feed example
- Meta's product feed creation example uses a scheduled URL to a sample TSV feed
- TSV is easy for us to generate, diff, and debug

XML/RSS is also supported, but it adds noise with no real advantage for this project.

## TechnoStore Field Mapping

This mapping is the recommended TechnoStore implementation based on Meta's official Product Item reference and the current app schema.

| Meta field | TechnoStore source | Recommendation |
| --- | --- | --- |
| `id` | `products.sku` | Use `sku` exactly |
| `retailer_id` | `products.sku` | Duplicate `sku` here too for consistency |
| `title` / `name` | `products.title` | Keep commercial but exact |
| `description` | `products.description` | Fill whenever possible |
| `brand` | `products.brand` | Required for clean segmentation |
| `condition` | `products.condition` | Normalize to Meta values |
| `availability` | `in_stock` + stock counts | `in stock` or `out of stock` |
| `price` | `price_amount` and/or `promo_price_ars` + `currency_code` | If both exist and promo is lower, keep base price in `price` |
| `sale_price` | `promo_price_ars` | Use only when promo price is truly promotional and lower than base price |
| `link` / `url` | storefront product URL | Build from `storefront_url` + product path |
| `image_link` / `image_url` | `products.image_url` | Must be public HTTPS |
| `product_type` | derived taxonomy | Example: `Electronics > Smartphones > Apple` |
| `category` | `products.category` | Use if clean, otherwise derive |
| `color` | `products.color` | Good for segmentation |
| `inventory` | stock count | Optional but recommended when reliable |
| `mobile_link` | same as `link` | Use same PDP URL unless app deep linking exists |
| `custom_label_0` | brand tier | Example: `apple`, `samsung`, `xiaomi` |
| `custom_label_1` | margin band | Example: `high_margin`, `mid_margin` |
| `custom_label_2` | stock urgency | Example: `low_stock`, `healthy_stock` |
| `custom_label_3` | condition tier | Example: `new`, `used_like_new`, `refurbished` |
| `custom_label_4` | financing status | Example: `financing_yes`, `financing_no` |

### Condition mapping

TechnoStore currently uses:

- `new`
- `used`
- `like_new`
- `refurbished`

Meta supports richer condition values. Recommended mapping:

- `new` -> `new`
- `refurbished` -> `refurbished`
- `like_new` -> `used_like_new`
- `used` -> `used`

If you later create better grading internally, you can graduate `used` into `used_good` or `used_fair`.

## Product Modeling Rules

This part is important for TechnoStore specifically.

Meta catalog ads work best when each item is a stable sellable offer with a stable image, stable price, and stable landing page.

That means:

- one item should not represent multiple real-world conditions
- one item should not mix different battery health states
- one item should not mix multiple finishes if the image only shows one

### Recommendation

For sealed/new inventory:

- one catalog item per real sellable SKU/model/color/storage combination

For used/refurbished inventory:

- either create distinct sellable SKUs when condition materially differs
- or exclude messy inventory from catalog ads until the offer is standardized

If a used iPhone has special battery health, cosmetic marks, or a one-off price, that should be a distinct product offer if you want to advertise it reliably.

## Execution Plan

### Phase 0: Business Setup

Goal: make sure ownership and permissions are correct before we build anything.

Tasks:

1. Confirm the Business Manager that owns the ad account.
2. Create or confirm one commerce catalog under that business.
3. Confirm the account used for API access can manage the catalog.
4. Confirm the correct Pixel will be associated to the catalog.
5. Decide the production public domain for product URLs.

Exit criteria:

- one business
- one main commerce catalog
- one confirmed Pixel/dataset strategy
- one public domain for product pages

### Phase 1: Feed MVP

Goal: export a clean Meta-compatible TSV feed from the current app.

Implementation:

- add `apps/api/src/meta-catalog.ts`
- add `apps/api/src/routes/meta-catalog-api.ts`
- register routes from the API entrypoint

Recommended routes:

- `GET /v1/meta/catalog/feed.tsv`
- `GET /v1/meta/catalog/preview`
- `GET /v1/meta/catalog/health`

`feed.tsv` should be protected with a feed token in the query string or another fetch-safe mechanism. Meta scheduled feed fetches cannot rely on your internal bearer token pattern.

`preview` should return a JSON preview of the exact rows that would go to Meta.

`health` should report local pre-flight issues such as:

- missing image
- missing price
- missing title
- invalid public URL
- invalid condition mapping
- inactive products accidentally included

Exit criteria:

- feed URL is fetchable from the public internet
- preview output matches expected products
- no broken URLs or empty prices

### Phase 2: Catalog Load And Diagnostics

Goal: load the feed into Meta and clean the first real ingestion pass.

Tasks:

1. Create a product feed in Meta that fetches the TechnoStore TSV URL.
2. Run first ingestion manually.
3. Review catalog diagnostics in Meta.
4. Fix feed issues in the app, not by editing items manually in Meta.

Meta's diagnostics endpoint also exposes issue groupings such as:

- `ATTRIBUTES_MISSING`
- `ATTRIBUTES_INVALID`
- `IMAGE_QUALITY`
- `LOW_QUALITY_TITLE_AND_DESCRIPTION`
- `EVENT_SOURCE_ISSUES`

Exit criteria:

- feed imports successfully
- diagnostics are clean enough to launch
- catalog count matches expected eligible products

### Phase 3: Event Matching Layer

Goal: make the catalog useful for optimization and retargeting.

This is the highest leverage phase after the feed itself.

Meta officially recommends using Conversions API alongside the Meta Pixel, and their dedup documentation recommends deduplicating using `event_id` plus `event_name`.

Recommended event plan for TechnoStore:

- `ViewContent` on every product detail page
- `Search` on search results when users search products
- `Purchase` when an order is marked paid/fulfilled
- `Contact` on WhatsApp click
- `Lead` optionally when a qualified conversation starts

For catalog matching, the most important event first is `ViewContent`.

`ViewContent` payload should include:

- `content_ids: [sku]`
- `content_type: "product"`
- `contents: [{ id: sku, quantity: 1 }]`
- `currency`
- `value`

For redundant browser + server setup:

- browser Pixel sends the event with `eventID`
- server Conversions API sends the same event with `event_id`
- both use the same event name

Meta's dedup docs say `event_id` plus event name is the recommended approach, and that deduplication only works when the identifiers match.

Exit criteria:

- product page views arrive in Events Manager with correct `sku`
- server/browser events deduplicate correctly
- catalog event match quality is healthy

### Phase 4: Product Sets And Campaign Operations

Goal: organize the catalog for actual ad buying.

Create product sets such as:

- Apple
- Apple premium
- Apple entry
- Samsung
- Xiaomi
- Used devices
- Refurbished devices
- Financing eligible
- Fast movers
- Over ARS threshold

This is where custom labels start paying off. Ad ops becomes much easier when we can filter by:

- brand
- stock health
- margin
- condition
- financing

Exit criteria:

- product sets exist for the main commercial segments
- naming is stable and documented
- campaigns can be built without manual item picking

### Phase 5: Operational Workflow

Goal: make the system dependable.

Operational rules:

- product updates should update the feed source immediately
- stock changes should reflect in availability quickly
- image URLs should never silently break
- feed QA should run before ad launches
- diagnostics should be reviewed weekly at minimum

Recommended ownership:

- operations owns product accuracy
- engineering owns feed and event integrity
- ads/marketing owns product sets and campaign structure

## Recommended Workflow Integration In This Repo

### New backend module

Create a catalog service module:

- `apps/api/src/meta-catalog.ts`

Responsibilities:

- normalize TechnoStore product records into Meta feed rows
- build public product URLs
- normalize condition values
- compute availability
- compute price and sale price fields
- add custom labels
- expose local health diagnostics

### New API routes

Create:

- `apps/api/src/routes/meta-catalog-api.ts`

Suggested endpoints:

- `GET /v1/meta/catalog/feed.tsv`
- `GET /v1/meta/catalog/preview`
- `GET /v1/meta/catalog/health`

### Config additions

Recommended env additions for this rollout:

- `META_CATALOG_FEED_TOKEN` for feed URL protection
- `META_PIXEL_ID` for browser tracking
- `META_DATASET_ID` if your final Conversions API setup uses a separate dataset identifier
- `PUBLIC_API_BASE_URL` must resolve publicly so Meta can fetch the feed

### Frontend tracking layer

Add a small tracking layer in the web app:

- inject Meta Pixel on the storefront and PDPs
- fire `ViewContent` on product pages
- fire `Search` on site search
- fire `Contact` on WhatsApp click

Suggested files:

- `apps/web/app/layout.tsx`
- `apps/web/app/[sku]/page.tsx`
- `apps/web/lib/meta-pixel.ts`

### Server event layer

Add server-side CAPI events from the API when high-value business actions happen.

Examples:

- order paid -> `Purchase`
- order fulfilled -> optional confirmation event
- qualified inquiry -> optional `Lead`

Suggested module:

- `apps/api/src/meta-conversions.ts`

## Data Quality Rules

Only include products in the catalog when all of the following are true:

- `active = true`
- has a stable `sku`
- has a title
- has a public product URL
- has a public image URL
- has a non-null final sell price
- has a valid condition mapping

Recommended exclusions:

- placeholder items
- inactive products
- products with missing images
- products with unstable or one-off metadata not reflected in title/landing page

## Image Rules

Meta's catalog quality is heavily affected by image quality and consistency.

For TechnoStore:

- all feed images must be public HTTPS
- avoid mixed backgrounds for the same brand set when possible
- avoid banners or text baked into the primary catalog image
- keep product image and landing page image aligned

Since your phone images already live in Cloudinary, the right operational approach is:

- keep one stable Cloudinary URL per advertised product image
- avoid changing image crops every few days
- treat catalog primary images as system assets, not ad-hoc assets

## Sync Cadence

Meta's product feed examples show scheduled fetches, and that is the correct baseline here.

Practical recommendation:

- start with at least daily scheduled fetches
- for TechnoStore's inventory profile, move to multiple refreshes per day once the feed is stable
- regenerate feed output immediately when products or stock are updated

Important Meta feed behavior to account for:

- full recurring feed schedules can replace the feed contents
- Meta's Product Feed config also supports `deletion_enabled`, which controls whether products missing from a new feed are removed from the catalog

Recommendation:

- for the main feed, enable deletion behavior only when you are confident the exporter is correct
- until then, be conservative and test feed outputs carefully before relying on removal semantics

If used inventory turns over quickly, stale availability will waste ad spend. This is why availability logic matters as much as the creative.

## Risks To Watch

### ID mismatch risk

If catalog item IDs use one value and Pixel/CAPI events use another, dynamic retargeting performance will suffer.

### Used inventory inconsistency risk

If a single SKU hides multiple battery conditions, cosmetic states, or finishes, the ad promise and landing page can drift.

### Image drift risk

If Cloudinary URLs or transformations change often, catalog diagnostics and ad approval quality can degrade.

### Manual override risk

If staff starts editing items directly in Commerce Manager, the feed stops being the source of truth.

## Recommended 2-Week Rollout

### Week 1

1. Confirm business assets and catalog ownership.
2. Build feed exporter and preview route.
3. Normalize condition and availability mapping.
4. Load first feed with a limited Apple-first subset.
5. Fix diagnostics until the Apple subset is clean.

### Week 2

1. Add Pixel `ViewContent` on PDPs.
2. Add WhatsApp `Contact` tracking.
3. Add server-side `Purchase` events through CAPI.
4. Verify deduplication with shared event IDs.
5. Build Apple product sets and launch first catalog-driven tests.

## What I Would Do First

If we start implementation next, I would do this exact order:

1. Build `GET /v1/meta/catalog/preview`
2. Build `GET /v1/meta/catalog/feed.tsv`
3. Load only Apple products first
4. Fix diagnostics
5. Add `ViewContent` Pixel event on PDP
6. Add CAPI `Purchase`
7. Add custom labels and product sets

That sequence keeps complexity low and gets you to usable ad infrastructure fast.

## Source Notes

This plan uses Meta's official docs plus the current TechnoStore codebase. The field mapping and rollout structure are my implementation recommendation based on those sources and the repo's current schema.

Official sources checked on April 1, 2026:

- Meta Product Catalog reference: https://developers.facebook.com/docs/marketing-api/reference/product-catalog/
- Meta Product Item reference: https://developers.facebook.com/docs/marketing-api/reference/product-item/
- Meta Product Catalog Product Feeds reference: https://developers.facebook.com/docs/marketing-api/reference/product-catalog/product_feeds/
- Meta Product Catalog Data Sources reference: https://developers.facebook.com/docs/marketing-api/reference/product-catalog/data_sources/
- Meta Product Catalog Diagnostics reference: https://developers.facebook.com/docs/marketing-api/reference/product-catalog/diagnostics/
- Meta Conversions API overview: https://developers.facebook.com/docs/marketing-api/conversions-api/
- Meta deduplication guidance: https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/
- Meta Pixel reference: https://developers.facebook.com/docs/meta-pixel/reference
- Meta Collection Ads page: https://www.facebook.com/business/ads/collection-ad-format
