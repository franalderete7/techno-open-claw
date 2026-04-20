# AGENTS

This workspace is operated by a coding agent through shell access.

## Primary rule

Do not hand-write raw curl requests against the API unless necessary. Prefer the helper scripts in `scripts/api/`.

## Use these first

- `./scripts/api/health.sh`
- `./scripts/api/conversations-list.sh`
- `./scripts/api/message-create.sh <json-file>`
- `./scripts/api/settings-list.sh` / `./scripts/api/settings-put.sh <key> <json-file>`

## n8n

- Generate workflow JSON: `node ./scripts/generate-n8n-v20.mjs` → `n8n/v20/TechnoStore_v20.json`
- Deploy to Docker n8n: `node ./scripts/deploy-n8n-v20.mjs` (optional `--dry-run`)
- Webhook path: `techno-sales-v20` (configure ManyChat → n8n URL).
- Price list for the bot: edit `data/techno-pricelist-abril.md` or set `TECHNO_PRICELIST_PATH` on the API.

## Working pattern

1. Inspect the current data with a list script.
2. Write a JSON payload to `/tmp/...json`.
3. Apply the change with the matching script.
4. Verify by listing again.

## Environment

- `.env` in repo root contains the API token and service URLs.
- Scripts load `.env` automatically.
- Default API target is `http://127.0.0.1:4000`.
- Optional: `TECHNO_BOT_STORE_JSON` — TIENDA block for the v20 bot.
- The `public.settings` table is kept (migration 016 does not drop it).

## Safety

- Prefer updating existing records instead of creating duplicates.
- Verify the result after each mutation.
