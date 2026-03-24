# VPS Setup

## Assumptions

- the VPS already exists
- Docker and Docker Compose are installed
- this repo will be cloned onto the VPS
- Ollama will run on the VPS and use `qwen3.5:cloud`

## Repo location

Recommended:

```bash
cd /srv
git clone <repo-url> techno-open-claw
cd /srv/techno-open-claw
```

## Environment

```bash
cp .env.example .env
```

Then fill the required values from [docs/CREDENTIALS.md](./CREDENTIALS.md).

Minimum values to start the stack:

- `POSTGRES_PASSWORD`
- `API_BEARER_TOKEN`
- `INTERNAL_API_BEARER_TOKEN`

## Start services

```bash
docker compose up -d postgres
./scripts/migrate.sh
docker compose up -d api web
```

## Verify services

```bash
curl http://127.0.0.1:4000/health
```

Then open the web UI:

```bash
open http://127.0.0.1:3000
```

## Ollama

Install Ollama on the VPS, then:

```bash
ollama signin
ollama run qwen3.5:cloud
```

This keeps inference in the cloud while your tools run on the VPS.

## OpenClaw

Run OpenClaw on the VPS and point it to:

- Ollama: `http://127.0.0.1:11434`
- API: `http://127.0.0.1:4000`

## Telegram

When Telegram is wired in, you will need:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_CHAT_IDS`
- optionally `TELEGRAM_WEBHOOK_SECRET`
- optionally `TELEGRAM_WEBHOOK_BASE_URL`

After the API is running, verify and register the webhook:

```bash
./scripts/api/telegram-status.sh
./scripts/api/telegram-webhook-sync.sh
./scripts/api/telegram-status.sh
```

The expected target is:

```txt
${TELEGRAM_WEBHOOK_BASE_URL}/webhooks/telegram
```

## Cloudflare Tunnel

If you want clean exposure through `aldegol.com`, prepare:

- `CLOUDFLARE_TUNNEL_TOKEN`
- DNS hostnames for API, web, and OpenClaw

## Deployment flow

On later deploys:

```bash
git pull
./scripts/deploy.sh
```
