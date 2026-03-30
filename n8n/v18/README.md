# TechnoStore v18 n8n Workflows

These exports are the v18 workflow set generated from the existing v17 flows.

## What changed

- Replaced `SUPABASE_URL` with `OPENCLAW_API_BASE_URL`
- Replaced `SUPABASE_KEY` with `OPENCLAW_API_TOKEN`
- Removed `apikey` headers from API calls
- Kept `Authorization: Bearer ...` for the app API
- Updated workflow names from `v17` to `v18`
- Updated the entry webhook path from `techno-sales-v17` to `techno-sales-v18`
- Updated AI turn logging from `workflow_version: 'v17'` to `workflow_version: 'v18'`

## Important note

These v18 workflows do **not** use Supabase anymore, but they still use the app's compatibility API layer under `/rest/v1/...`.

That means:

- n8n remains your orchestration layer
- the app API remains the write/read bridge
- the actual source of truth is your new Postgres database

This is the safest migration path because the existing workflow logic stays intact while the data lands in the new schema.

## Required n8n env vars

- `OPENCLAW_API_BASE_URL`
  Example: `http://api:4000`
- `OPENCLAW_API_TOKEN`
  Example: your API bearer token
- `GEMINI_MODEL_SALES`
  Example: `models/gemini-2.5-flash`

## Required n8n credentials

- `ManyChat API`
- `Groq Whisper`
- `Google Gemini` chat model credential used by the sales responder

## Import order

Import all of these:

- `TechnoStore_v18_context_builder.json`
- `TechnoStore_v18_router.json`
- `TechnoStore_v18_info_responder.json`
- `TechnoStore_v18_sales_responder.json`
- `TechnoStore_v18_validator.json`
- `TechnoStore_v18_state_update.json`
- `TechnoStore_v18_entry.json`

## Automated deploy from the VPS host

Use this first:

```bash
node ./scripts/deploy-n8n-v18.mjs
```

What it does:

- backs up the currently imported v18 workflows to `n8n/backups/v18/<timestamp>`
- unpublishes the current v18 set
- removes duplicate exact-name v18 workflows
- imports the 6 child workflows first
- patches the entry workflow with the real child workflow IDs
- imports the entry workflow last
- publishes the full v18 set in the right order

If your n8n container name is not auto-detected:

```bash
N8N_CONTAINER_NAME=n8n-n8n-1 node ./scripts/deploy-n8n-v18.mjs
```

Optional dry run:

```bash
node ./scripts/deploy-n8n-v18.mjs --dry-run
```

## Raw CLI import from the VPS host

If n8n runs in Docker on the VPS, use:

```bash
./scripts/import-n8n-v18.sh
```

Optional override if the container name is not auto-detected:

```bash
N8N_CONTAINER_NAME=n8n-n8n-1 ./scripts/import-n8n-v18.sh
```

The raw import script only copies/imports JSON files. It does **not** archive old workflows, relink child workflow IDs, or publish the set.

## Current scope

- ManyChat / WhatsApp entry flow: included
- Product/context lookup from new Postgres-backed app: included
- Customer state updates in new Postgres-backed app: included
- AI turn logging in new Postgres-backed app: included
- Telegram workflow: not included yet
