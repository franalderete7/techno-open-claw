# ManyChat Webhook Setup

## Webhook URL

**Production:**
```
https://your-domain.com/webhooks/manychat
```

**Local Testing:**
```
http://127.0.0.1:4000/webhooks/manychat
```

## ManyChat Configuration

### 1. Add Webhook in ManyChat

1. Go to ManyChat dashboard
2. Settings → Automation → Webhooks
3. Add new webhook
4. **URL:** `https://your-domain.com/webhooks/manychat`
5. **Events:** 
   - User messages
   - New conversation
   - Conversation updates

### 2. Authentication Headers

```
Authorization: Bearer YOUR_MANYCHAT_API_KEY
Content-Type: application/json
```

### 3. Expected Payload

```json
{
  "subscriber_id": "661",
  "message": {
    "id": "msg_123",
    "text": "cuanto sale el iphone 15?",
    "type": "text"
  },
  "first_name": "Francisco",
  "phone": "+549387XXXXXXX",
  "was_audio": false
}
```

## What It Does

1. **Receives** customer message from ManyChat/WhatsApp
2. **Processes** through sales agent (same as Telegram)
3. **Saves** conversation to database
4. **Sends** AI reply back via ManyChat
5. **Syncs** customer state (lead_score, funnel_stage, tags)

## Replaces n8n Workflow

This webhook replaces your n8n v17 workflow:
- `TechnoStore - AI Sales Agent v17` (webhook: `/techno-sales`)

## Testing

```bash
# Test webhook locally
curl -X POST http://127.0.0.1:4000/webhooks/manychat \
  -H "Content-Type: application/json" \
  -d '{
    "subscriber_id": "test123",
    "message": {"text": "hola"},
    "first_name": "Test"
  }'
```

## Environment Variables

Required in `.env`:
```bash
MANYCHAT_API_KEY=mc_live_xxxxx
MANYCHAT_ACCOUNT_ID=uuid-xxxx
```
