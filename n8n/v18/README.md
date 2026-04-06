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
- `GROQ_MODEL_SALES`
  Example: `llama3-8b-8192`

## Required n8n credentials

- `ManyChat API`
- `Groq Whisper`
- `Groq account` chat model credential used by the sales responder

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
- unpublishes the current exact-name v18 set
- archives the current exact-name v18 set instead of deleting it
- imports the 6 child workflows first as a brand-new set
- patches the entry workflow with the real child workflow IDs
- imports the entry workflow last
- unarchives the newly imported workflows if needed
- publishes the full v18 set in the right order
- restarts n8n so webhook registrations refresh against the newly published set

If your n8n container name is not auto-detected:

```bash
N8N_CONTAINER_NAME=n8n-n8n-1 node ./scripts/deploy-n8n-v18.mjs
```

Optional dry run:

```bash
node ./scripts/deploy-n8n-v18.mjs --dry-run
```

Optional override if you explicitly do **not** want the post-deploy restart:

```bash
N8N_SKIP_RESTART=true node ./scripts/deploy-n8n-v18.mjs
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

### WhatsApp link previews (entry workflow)

The **Prepare WhatsApp Payload** node splits an outgoing text bubble into two messages **only when it contains exactly one** `http(s)` URL: copy first, then that URL alone in a follow-up message (better alignment with Meta’s “first URL in the body” preview behavior). Messages with several links stay a single bubble so catalog-style lists are not mangled.

For any text message that still contains a URL, the node also sets **`preview_url: true`** on that JSON object. Meta’s Cloud API uses that flag to ask WhatsApp to render a link preview; [their docs](https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages) state that if it is omitted, a plain clickable link is shown instead. **ManyChat’s public OpenAPI does not document this field** ([`sendContent` schema](https://api.manychat.com/swagger/compileJson?type=Page_API)), so their server may ignore it, strip it, or reject the request. If sends start failing with 400, remove `preview_url` from the node and re-import.

Re-import or paste the updated node if your live n8n copy predates this change. Rich previews also require [Open Graph requirements](https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/) on the target page.

## Current scope

- ManyChat / WhatsApp entry flow: included
- Product/context lookup from new Postgres-backed app: included
- Customer state updates in new Postgres-backed app: included
- AI turn logging in new Postgres-backed app: included
- Telegram workflow: not included yet
