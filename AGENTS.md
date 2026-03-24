# AGENTS

This workspace is operated by a coding agent through shell access.

## Primary rule

Do not hand-write raw curl requests against the API unless necessary. Prefer the helper scripts in `scripts/api/`.

## Use these first

- `./scripts/api/health.sh`
- `./scripts/api/products-list.sh`
- `./scripts/api/product-create.sh <json-file>`
- `./scripts/api/product-update.sh <product-id> <json-file>`
- `./scripts/api/stock-list.sh`
- `./scripts/api/stock-create.sh <json-file>`
- `./scripts/api/stock-update.sh <stock-unit-id> <json-file>`
- `./scripts/api/orders-list.sh`
- `./scripts/api/order-create.sh <json-file>`
- `./scripts/api/conversations-list.sh`
- `./scripts/api/message-create.sh <json-file>`

## Working pattern

1. Inspect the current data with a list script.
2. Write a JSON payload to `/tmp/...json`.
3. Apply the change with the matching create or update script.
4. Verify by listing again.

## Environment

- `.env` in repo root contains the API token and service URLs.
- Scripts load `.env` automatically.
- Default API target is `http://127.0.0.1:4000`.

## Safety

- Prefer updating existing records instead of creating duplicates.
- When creating products, use stable SKUs and slugs.
- When creating orders, verify the referenced customer, product, and stock unit IDs first.
- Verify the result after each mutation.
