# n8n → PostgreSQL Integration Guide

## Goal
Modify existing n8n workflows to save data to **our PostgreSQL database** instead of Supabase.

## Why Keep n8n?
- Already configured with ManyChat credentials
- Visual workflow builder is great for debugging
- Can trigger on webhooks, timers, etc.
- We keep the logic, just change the database destination

## Architecture
```
ManyChat → n8n webhook → Process logic → PostgreSQL (our DB) → Respond
Telegram  → n8n webhook → Process logic → PostgreSQL (our DB) → Respond
```

## Database Connection in n8n

### 1. Add PostgreSQL Node

In n8n workflow:
1. Add node → Search "PostgreSQL"
2. Configure credentials:
   - Host: `techno-open-claw-postgres` (Docker network) OR `127.0.0.1` (localhost)
   - Port: `5432`
   - Database: `techno_open_claw`
   - User: `techno`
   - Password: `Jeronimo32` (from your .env)
   - SSL: false

### 2. Save Conversation

**Node: PostgreSQL - Insert Conversation**
```sql
INSERT INTO conversations (
  customer_id,
  channel,
  channel_thread_key,
  status,
  title,
  last_message_at
)
VALUES (
  {{ $json.customer_id }},
  {{ $json.channel }},
  {{ $json.thread_key }},
  'open',
  {{ $json.title }},
  NOW()
)
RETURNING id;
```

### 3. Save Message

**Node: PostgreSQL - Insert Message**
```sql
INSERT INTO messages (
  conversation_id,
  direction,
  sender_kind,
  message_type,
  text_body,
  media_url,
  transcript,
  payload
)
VALUES (
  {{ $json.conversation_id }},
  {{ $json.direction }},
  {{ $json.sender_kind }},
  {{ $json.message_type }},
  {{ $json.text }},
  {{ $json.media_url }},
  {{ $json.transcript }},
  {{ $json.payload | json }}
);
```

### 4. Save/Update Customer

**Node: PostgreSQL - Upsert Customer**
```sql
INSERT INTO customers (
  external_ref,
  first_name,
  last_name,
  phone,
  email,
  notes
)
VALUES (
  {{ $json.external_ref }},
  {{ $json.first_name }},
  {{ $json.last_name }},
  {{ $json.phone }},
  {{ $json.email }},
  {{ $json.notes }}
)
ON CONFLICT (external_ref)
DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  phone = EXCLUDED.phone,
  notes = EXCLUDED.notes,
  updated_at = NOW();
```

### 5. Log Audit Event

**Node: PostgreSQL - Insert Audit**
```sql
INSERT INTO audit_logs (
  actor_type,
  action,
  entity_type,
  entity_id,
  metadata,
  created_at
)
VALUES (
  'tool',
  'message_received',
  'conversation',
  {{ $json.conversation_id }},
  {{ $json.metadata | json }},
  NOW()
);
```

## Example Workflow Structure

```
Webhook (ManyChat/Telegram)
  ↓
Code Node (Parse message, extract data)
  ↓
PostgreSQL (Upsert customer)
  ↓
PostgreSQL (Insert conversation if new)
  ↓
PostgreSQL (Insert message)
  ↓
AI Agent (Generate response)
  ↓
PostgreSQL (Insert outbound message)
  ↓
HTTP Request (Send reply via ManyChat/Telegram)
  ↓
PostgreSQL (Insert audit log)
```

## Testing

### 1. Test PostgreSQL Connection
In n8n:
- Create test workflow
- Add PostgreSQL node
- Run query: `SELECT NOW();`
- Should return current timestamp

### 2. Test Message Flow
Send test message → Check DB:
```bash
docker exec techno-open-claw-postgres psql -U techno -d techno_open_claw \
  -c "SELECT * FROM messages ORDER BY created_at DESC LIMIT 5;"
```

### 3. Check Conversations
```bash
docker exec techno-open-claw-postgres psql -U techno -d techno_open_claw \
  -c "SELECT * FROM conversations ORDER BY created_at DESC LIMIT 5;"
```

## Migration Steps

### Step 1: Export Current n8n Workflows
```bash
# In n8n UI: Settings → Export workflow
# Save as JSON backup
```

### Step 2: Modify Each Workflow
For each v17 workflow:
1. Replace Supabase nodes with PostgreSQL nodes
2. Update SQL queries to match our schema
3. Test with sample data

### Step 3: Update Webhook URLs
Point ManyChat/Telegram to n8n webhooks (not our app):
- ManyChat: `https://your-domain.com/webhooks/manychat` → n8n
- Telegram: `https://api.telegram.org/botXXX/setWebhook?url=...` → n8n

### Step 4: Monitor
Watch logs and DB for first 24h:
```bash
# Watch API logs
docker logs -f techno-open-claw-api

# Watch DB inserts
watch -n 1 'docker exec techno-open-claw-postgres psql -U techno -d techno_open_claw -c "SELECT COUNT(*) FROM messages;"'
```

## Benefits of This Approach

✅ **Keep n8n** - Visual debugging, already configured
✅ **Our database** - All data in one place (PostgreSQL on VPS)
✅ **Easy to modify** - Change workflow logic in n8n UI
✅ **Audit trail** - Every action logged
✅ **No Supabase** - Fully self-hosted

## Files to Update

1. **n8n workflows** - Replace Supabase with PostgreSQL nodes
2. **Webhook URLs** - Point to n8n instead of our app
3. **Environment** - Ensure PostgreSQL credentials in n8n

---

**Ready to implement?** I can help modify your existing v17 workflows to use PostgreSQL!
