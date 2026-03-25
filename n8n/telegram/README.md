# TechnoStore Telegram Operator Workflow

This workflow moves the Telegram operator chatbot entrypoint into n8n while keeping the app API as the trusted data and command layer.

## What it does

- Receives Telegram webhook updates in n8n
- Validates the Telegram webhook secret and allowed chat list in the workflow
- Handles:
  - text
  - audio via Groq transcription
  - images via base64 handoff
- Calls the app API for:
  - Telegram customer/conversation/message persistence
  - safe operator command drafting/confirmation
- Calls Ollama only when the app says the turn is general chat, not a direct deterministic reply
- Sends the final reply back to Telegram
- Persists the outbound reply to the app database

## Required n8n env vars

- `WEBHOOK_URL`
  Example: `https://n8n.technostoresalta.com/`
- `N8N_HOST`
  Example: `n8n.technostoresalta.com`
- `N8N_PROTOCOL`
  Example: `https`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_ALLOWED_CHAT_IDS`
  Example: `5249536569`
- `OPENCLAW_API_BASE_URL`
  Example: `https://api.technostoresalta.com`
- `OPENCLAW_API_TOKEN`
  Must match `API_BEARER_TOKEN` in the app
- `OLLAMA_BASE_URL`
  Example: `http://45.55.53.53:11434`
- `OLLAMA_MODEL`
  Example: `qwen3.5:cloud`
- `GROQ_API_KEY`
  Optional, but required for audio transcription

## App env vars you can stop relying on for Telegram

If Telegram is fully moved to n8n, these app env vars are no longer the active Telegram entrypoint:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_CHAT_IDS`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_BASE_URL`

They can stay in the app env, but Telegram should point to n8n, not to the app webhook.

## Workflow file

- `TechnoStore_Telegram_Operator_v1.json`

## Import

From the repo root on the VPS host:

```bash
./scripts/import-n8n-telegram-operator.sh
```

## Telegram webhook target

After the workflow is imported and published, point Telegram to:

```txt
https://n8n.technostoresalta.com/webhook/technostore-telegram-operator-v1
```

Use the same `TELEGRAM_WEBHOOK_SECRET` value when registering the webhook.

## Notes

- The app still owns the trusted operator logic and DB writes.
- n8n owns the Telegram entrypoint, media preprocessing, and execution visibility.
- This is the pragmatic split for easier debugging without re-implementing the whole trust layer inside n8n.
