# Architecture

## Goal

Operate the business from Telegram and tools, not from a heavy admin UI.

## Runtime

- PostgreSQL on the VPS
- Fastify API on the VPS
- OpenClaw on the VPS
- Ollama on the VPS using `qwen3.5:cloud`
- Telegram as the main operator channel
- read-only Next.js UI in `apps/web`

## Domains

- `puntotechno.com`: storefront
- `aldegol.com`: VPS host
- recommended later:
  - `ops.aldegol.com`: operator UI
  - `api.aldegol.com`: backend API

## Data model

Only the operational core:

- `customers`
- `conversations`
- `messages`
- `products`
- `stock_units`
- `orders`
- `order_items`
- `settings`
- `audit_logs`

## Why this stays simple

- no tags
- no CRM tag definitions
- no workflow payload tables
- no visual automation engine
- no direct database access from clients

## Access model

Everything talks to the API:

- OpenClaw tools -> API
- Telegram flow -> API
- SwiftUI app later -> API
- read-only Next.js UI later -> API

Postgres stays private.
