# Credentials

This is the exact credential inventory for `techno-open-claw`.

## Required now

### PostgreSQL

These are not third-party credentials. You choose them.

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`

### API auth

You generate these yourself.

- `API_BEARER_TOKEN`
- `INTERNAL_API_BEARER_TOKEN`

Recommendation:
- keep `INTERNAL_API_BEARER_TOKEN` equal to `API_BEARER_TOKEN` for now
- generate a long random token with `openssl rand -hex 32`

## Required soon

### Telegram

Needed for the operator chat flow.

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_CHAT_IDS`

Optional but recommended if using webhooks:
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_BASE_URL`

How to get them:
- Create the bot with `@BotFather`
- Save the bot token
- DM the bot, then read your numeric Telegram `from.id`
- Put allowed IDs as a comma-separated list in `TELEGRAM_ALLOWED_CHAT_IDS`

Example:

```env
TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321
```

## Required on the VPS

### Ollama Cloud

For `qwen3.5:cloud`, the main requirement is authenticating Ollama on the VPS.

- Ollama account login on the VPS via `ollama signin`

You do not currently need a separate app env var in this repo for that login flow.

Related runtime config:
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`

### GitHub deploy access

For a private repo, recommend an SSH deploy key on the VPS.

- `GITHUB_REPO_SSH_URL`
- `GITHUB_DEPLOY_KEY_PATH`

Alternative:
- GitHub personal access token for HTTPS pulls

### Cloudflare Tunnel

Optional, but recommended for exposing the API, web UI, and OpenClaw safely.

- `CLOUDFLARE_TUNNEL_TOKEN`

Hostnames you can wire later:
- `CLOUDFLARE_TUNNEL_HOST_API`
- `CLOUDFLARE_TUNNEL_HOST_WEB`
- `CLOUDFLARE_TUNNEL_HOST_OPENCLAW`

## Later phase only

### Meta Ads

Only needed when the ads tool layer is built.

- `META_ADS_ACCESS_TOKEN`
- `META_AD_ACCOUNT_IDS`

If you later want controlled ad actions, the backend should use one restricted token and an allowlist of account IDs.

## Recommended order

1. Set DB and API tokens now.
2. Create the Telegram bot and collect your chat IDs.
3. Prepare GitHub deploy access for the VPS.
4. Set up Cloudflare Tunnel.
5. Add Meta Ads token only when the ads tools are implemented.
