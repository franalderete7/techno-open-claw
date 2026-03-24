# Migration Handoff

Last updated: 2026-03-24

This file is the operational handoff for continuing the migration from the old TechnoStore stack into `techno-open-claw`.

## Why this repo exists

The old stack became too fragmented and operationally expensive to maintain:

- frontend on Vercel
- data on Supabase
- workflow logic in n8n
- WhatsApp orchestration in giant workflow JSON files
- too much prompt logic in workflow nodes
- manual imports and re-imports for production changes

The new direction is:

- one VPS-first operator stack
- PostgreSQL as source of truth
- Fastify backend for business logic
- read-only Next.js UI
- Ollama on the VPS using `qwen3.5:cloud`
- OpenClaw as the operator shell
- Telegram as the easiest first operator channel
- no dependency on Supabase or n8n for the new core

## Old stack summary

Old project path:
- `/Users/aldegol/Documents/Apps/techno-store`

Main old characteristics:
- Next.js storefront/admin app
- Supabase-backed schema and auth patterns
- n8n automations for AI/customer workflows
- ManyChat / WhatsApp routing

Important note:
- No data migration from Supabase is required for `techno-open-claw`.
- The new stack starts from zero.
- Old workflows can remain available as legacy references, but they are not the preferred future path.

## New stack summary

New project path on local machine:
- `/Users/aldegol/Documents/Apps/techno-open-claw`

New project path on VPS:
- `/srv/techno-open-claw`

Main components:
- PostgreSQL in Docker
- Fastify API in Docker
- read-only Next.js UI in Docker
- Ollama installed on host machine
- OpenClaw installed on host machine
- Telegram operator access

## Database design

The new schema is intentionally minimal:

- `customers`
- `conversations`
- `messages`
- `products`
- `stock_units`
- `orders`
- `order_items`
- `settings`
- `audit_logs`

Migration files:
- `db/migrations/001_initial_schema.sql`
- `db/migrations/002_updated_at_triggers.sql`

This is the core structure. There are no tags, CRM classification systems, or workflow-specific state tables in the new stack.

## Current repo state

Key repo files:
- `README.md`
- `AGENTS.md`
- `docs/CREDENTIALS.md`
- `docs/API.md`
- `docs/OPERATOR_PLAYBOOK.md`
- `scripts/api/*`
- `apps/api/src/index.ts`
- `apps/api/src/telegram.ts`

API already includes:
- health route
- protected CRUD routes for products, stock, customers, conversations, messages, orders, settings
- Telegram webhook ingestion route at `POST /webhooks/telegram`

Operator shell helpers already exist in:
- `scripts/api/`

These scripts are the preferred low-friction tool surface for an agent operating via shell.

## Current VPS state

Host:
- DigitalOcean droplet
- hostname: `n8n-server`
- public IP observed during setup: `45.55.53.53`

Verified working on VPS:
- Docker installed
- Docker Compose installed
- Postgres container running
- API container running
- Web container running
- `curl http://127.0.0.1:4000/health` returns success
- `curl -I http://127.0.0.1:3000` returns success
- Ollama installed on host
- `ollama run qwen3.5:cloud` responds successfully
- OpenClaw installed
- Telegram bot token configured in `.env`
- Telegram allowed chat id configured for Francisco: `5249536569`

## Important env and auth notes

The following values are self-generated and must exist in `.env`:
- `POSTGRES_PASSWORD`
- `DATABASE_URL` (must match the password above)
- `API_BEARER_TOKEN`
- `INTERNAL_API_BEARER_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

The following external credential is already expected in `.env` when Telegram is used:
- `TELEGRAM_BOT_TOKEN`

The following env pattern is already in place for shell scripts:
- scripts automatically load `.env`
- default API target is `http://127.0.0.1:4000`

## What was fixed during setup

1. Created the greenfield repo and base docs.
2. Built the minimal Postgres schema.
3. Built the Fastify API.
4. Built the read-only Next.js web app.
5. Added Telegram webhook ingestion to the backend.
6. Added operator shell scripts in `scripts/api/`.
7. Added `AGENTS.md` for agent behavior in this workspace.
8. Fixed the web Dockerfile so builds succeed without a `public/` directory.
9. Configured git SSH access on the VPS with a deploy key.
10. Installed Ollama and verified `qwen3.5:cloud` is usable from the VPS.
11. Installed OpenClaw and completed onboarding enough to reach the Telegram bot interaction stage.

## Current blocker

OpenClaw Telegram chat is not yet replying to messages even though:
- the bot receives Telegram messages
- messages show delivered in Telegram
- OpenClaw/TUI was reachable during onboarding

This means the next debugging target is OpenClaw runtime/channel behavior, not infrastructure.

Most likely checks to run:

```bash
openclaw status
openclaw gateway status
openclaw channels status --probe
openclaw pairing list telegram
openclaw channels logs --channel telegram --lines 200
openclaw logs --follow --local-time
```

Potential likely causes:
- Telegram DM pairing is pending
- channel delivery is off
- gateway daemon is running but channel is not active
- model/channel routing did not finish cleanly during onboarding

## Preferred way for the agent to operate this repo

Do not hand-write raw curl by default.

Use:
- `AGENTS.md`
- `docs/OPERATOR_PLAYBOOK.md`
- `scripts/api/*`

Expected pattern:
1. inspect current data
2. write JSON payload in `/tmp/...json`
3. call the matching helper script
4. verify result

Examples:

```bash
./scripts/api/health.sh
./scripts/api/products-list.sh
./scripts/api/stock-list.sh
./scripts/api/orders-list.sh
./scripts/api/conversations-list.sh
```

## Recommended next sequence

### Phase 1: Make OpenClaw reply in Telegram

On VPS:

```bash
openclaw status
openclaw gateway status
openclaw channels status --probe
openclaw pairing list telegram
openclaw channels logs --channel telegram --lines 200
openclaw logs --follow --local-time
```

If pairing code exists:

```bash
openclaw pairing approve telegram <CODE>
```

If using TUI and expecting Telegram delivery, ensure delivery is enabled in that session.

### Phase 2: Verify agent can operate backend through scripts

Prompt the agent to read:
- `AGENTS.md`
- `docs/OPERATOR_PLAYBOOK.md`

First task:
- run health
- list products

Second task:
- create a test inactive product
- verify by listing again

### Phase 3: Expand useful operator actions

Next backend improvements to build:
- outbound Telegram response helper from backend flows
- product search improvements
- stock reservation flows
- order update helpers
- customer lookup helpers

### Phase 4: Decide what to do about legacy n8n

Recommendation:
- keep legacy n8n only as optional glue if needed
- do not return core business logic to n8n
- if ManyChat still matters later, make it call the backend instead of embedding logic in workflows

## Commands already known to work on VPS

```bash
cd /srv/techno-open-claw
curl http://127.0.0.1:4000/health
curl -I http://127.0.0.1:3000
ollama run qwen3.5:cloud
```

Docker lifecycle:

```bash
docker compose up -d postgres
./scripts/migrate.sh
docker compose up -d --build api web
```

Git pull after deploy-key fix:

```bash
cd /srv/techno-open-claw
git pull
```

## Suggested first prompt for Qwen/OpenClaw

Use this as a serious first operational prompt inside the workspace:

```text
Read AGENTS.md and docs/OPERATOR_PLAYBOOK.md in /srv/techno-open-claw. Use only the scripts in scripts/api for operations unless there is a clear reason not to. First verify health, then list products, stock, orders, and conversations, and summarize what exists.
```

## Suggested second prompt for Qwen/OpenClaw

```text
Create one inactive test product through the helper scripts, verify it exists, then delete nothing and summarize exactly what changed.
```

## Final architectural recommendation

The right long-term direction is:
- keep `techno-open-claw` as the new source of truth
- keep agent logic in the app/backend + agent workspace
- keep OpenClaw as the operator shell
- keep Telegram as the first operational channel
- keep n8n out of the critical path
- only bridge old systems into the backend when strictly necessary
