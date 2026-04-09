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
- iOS app

## Quick start

1. Copy `.env.example` to `.env`
2. Fill the required values from [docs/CREDENTIALS.md](./docs/CREDENTIALS.md)
3. Start everything:

```bash
docker compose up -d
```

4. Verify:

```bash
curl http://127.0.0.1:4000/health
```

## Repo apps

- `apps/api`: backend and tool surface
- `apps/web`: read-only Next.js viewer

## Operator layer

The repo now includes shell wrappers for the API in `scripts/api/` and a usage guide in [`docs/OPERATOR_PLAYBOOK.md`](./docs/OPERATOR_PLAYBOOK.md). These are the simplest stable surface for OpenClaw to use when operating products, stock, orders, and conversations.

For project history, current VPS status, and next migration steps, see [`docs/MIGRATION_HANDOFF.md`](./docs/MIGRATION_HANDOFF.md).

## Next build steps

1. OpenClaw config and workspace instructions
2. Product and stock updates via chat
3. Order operations via chat
4. Outbound Telegram replies from backend flows
5. Admin and storefront polish
