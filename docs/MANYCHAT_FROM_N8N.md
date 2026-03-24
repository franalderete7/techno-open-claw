# ManyChat Credentials from n8n Workflows

**Found:** Your n8n workflows have ManyChat configured, but credentials are **encrypted** (AES-256).

## What I Found in n8n Database

```
Workflow: TechnoStore - AI Sales Agent v15 (Orchestrator)
- ManyChat webhook: /webhooks/techno-sales
- ManyChat subscriber_id tracking
- ManyChat custom fields sync (lead_score, funnel_stage, tags, etc.)
- ManyChat send message nodes
- ManyChat tag management
```

## Encrypted Credentials (Can't Decrypt)

The n8n database stores encrypted credentials:
```
U2FsdGVkX1... (OpenSSL encrypted, need n8n encryption key to decrypt)
```

**Easiest Path:** Get fresh credentials from ManyChat dashboard

## How to Get ManyChat Credentials

### 1. ManyChat API Key
1. Go to https://manychat.com
2. Settings → API
3. Generate API Key (or copy existing)
4. Format: `mc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 2. ManyChat Account ID
1. Same API settings page
2. Account ID is shown
3. Format: UUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

### 3. Update .env File

```bash
# ManyChat (customer-facing WhatsApp sales bot)
MANYCHAT_API_KEY=mc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MANYCHAT_ACCOUNT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 4. Restart API

```bash
cd /srv/techno-open-claw
docker compose restart api
```

## ManyChat Webhook Setup

Once credentials are set:

1. **ManyChat → Settings → Automation**
2. **Add Webhook**
3. **URL:** `https://your-domain.com/webhooks/manychat`
4. **Events:** User messages, conversation updates
5. **Headers:**
   - `Authorization: Bearer YOUR_API_KEY`
   - `Content-Type: application/json`

## What the Old n8n Workflow Did

```
Customer WhatsApp → ManyChat → n8n webhook → 
  ↓
  1. Save message to Supabase
  2. 8s debounce + latest-message check
  3. Upsert customer profile
  4. Fetch context (messages, products, settings)
  5. Route intent (greeting, price, catalog, etc.)
  6. AI generate response (Gemini)
  7. Sync state to ManyChat fields
  8. Send reply via ManyChat → WhatsApp
```

## New Backend Implementation

Same flow, but in code:
- `apps/api/src/manychat.ts` - ManyChat API client
- `apps/api/src/sales-agent.ts` - Turn processing
- `apps/api/src/telegram-webhook.ts` - Internal dev chat
- PostgreSQL instead of Supabase

## Next Steps

1. **Get ManyChat API key + Account ID**
2. **Add to .env**
3. **Test webhook** with sample message
4. **Verify** customer state sync works
