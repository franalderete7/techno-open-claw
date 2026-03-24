# techno-open-claw

Greenfield operator stack for TechnoStore.

This repo is intentionally separate from the old app. It starts from zero:

- no Supabase dependency
- no n8n dependency
- no data migration requirement
- no tag systems
- no legacy CRM baggage

## Target architecture

- PostgreSQL on the VPS
- Fastify API on the VPS
- OpenClaw on the VPS
- Ollama on the VPS using `qwen3.5:cloud`
- Telegram as the operator interface
- read-only Next.js UI included in `apps/web`
- storefront stays on `puntotechno.com`

## Core idea

Everything operational happens through chat and tools:

- create and update products
- change stock
- inspect conversations
- create and inspect orders
- later manage ads

The backend is the source of truth and OpenClaw calls backend tools.

## Current scope

This first scaffold includes:

- base Docker Compose
- PostgreSQL schema
- protected Fastify API
- read-only Next.js app
- deploy script
- VPS setup docs
- credential inventory

It does not yet include:

- Telegram channel handler
- OpenClaw runtime config
- Meta Ads integration
- iOS app

## Quick start

1. Copy `.env.example` to `.env`
2. Fill the required values from [docs/CREDENTIALS.md](./docs/CREDENTIALS.md)
3. Start Postgres:

```bash
docker compose up -d postgres
```

4. Apply schema:

```bash
./scripts/migrate.sh
```

5. Start API and web:

```bash
docker compose up -d api web
```

6. Verify:

```bash
curl http://127.0.0.1:4000/health
```

## Repo apps

- `apps/api`: backend and tool surface
- `apps/web`: read-only Next.js viewer

## Operator layer

The repo now includes shell wrappers for the API in `scripts/api/` and a usage guide in [`docs/OPERATOR_PLAYBOOK.md`](./docs/OPERATOR_PLAYBOOK.md). These are the simplest stable surface for OpenClaw to use when operating products, stock, orders, and conversations.

## Next build steps

1. OpenClaw config and workspace instructions
2. Product and stock updates via chat
3. Order operations via chat
4. Outbound Telegram replies from backend flows
5. Meta Ads tool layer
