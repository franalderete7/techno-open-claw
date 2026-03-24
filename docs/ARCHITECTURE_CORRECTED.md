# Corrected Architecture: Internal Dev vs Customer Sales Bot

**Date:** 2026-03-24  
**Correction:** Telegram is for internal dev chat, ManyChat/WhatsApp is for customer sales

## Two Separate Channels

### 1. Telegram Bot (Internal Dev Chat) 🛠️

**Purpose:** You + partner chat with AI while coding (like levels.io)
- Chat with the AI model while at the gym
- Build features, debug, plan
- Direct access to VPS-hosted qwen3.5:cloud
- **Streaming responses** like ChatGPT
- Can push to GitHub, manage deployments

**Flow:**
```
You/Partner → Telegram → API → Ollama (streaming) → Telegram
                              ↓
                         GitHub push
                         Deploy commands
                         Code generation
```

**Features:**
- ✅ Streaming responses (token-by-token like ChatGPT)
- ✅ "Thinking..." indicator before streaming
- ✅ Code generation, debugging help
- ✅ GitHub integration (push commits, create PRs)
- ✅ Deployment commands
- ✅ Only you + partner (allowed chat IDs)

### 2. ManyChat + WhatsApp (Customer Sales Bot) 💬

**Purpose:** Customer-facing sales automation
- WhatsApp customers via ManyChat
- Product inquiries, pricing, orders
- CRM tagging, lead scoring, funnel stages
- Saves conversations to database

**Flow:**
```
Customer → WhatsApp → ManyChat → API → Ollama → ManyChat → WhatsApp
                                ↓
                          PostgreSQL (conversations, customers, state)
                          Product catalog
                          Order management
                          Lead scoring
```

**Features:**
- ✅ ManyChat API integration
- ✅ Customer state sync (lead_score, funnel_stage, tags)
- ✅ Product recommendations
- ✅ Order creation
- ✅ Conversation history in DB
- ✅ Audio transcription (Groq Whisper)

## What Changed

### Before (Wrong):
❌ Telegram = customer sales bot
❌ All logic in sales-agent for Telegram

### After (Correct):
✅ Telegram = internal dev chat (you + partner)
✅ ManyChat = customer sales bot
✅ Streaming for Telegram responses
✅ ManyChat CRM sync for customer state

## Environment Variables

```bash
# Telegram (internal dev)
TELEGRAM_BOT_TOKEN=8716114669:AAFaD1qWq0aqbEcTsxsexSlwryo5Zk-3iWA
TELEGRAM_ALLOWED_CHAT_IDS=5249536569,XXXXXXXXXX  # You + partner

# ManyChat (customer sales)
MANYCHAT_API_KEY=your_api_key
MANYCHAT_ACCOUNT_ID=your_account_id

# Ollama (VPS model)
OLLAMA_BASE_URL=http://172.17.0.1:11434
OLLAMA_MODEL=qwen3.5:cloud

# Audio transcription
GROQ_API_KEY=your_groq_key
```

## New Files

### `apps/api/src/telegram-streaming.ts`
- Streams AI responses token-by-token
- Uses Ollama streaming API
- Sends "thinking..." first, then streams
- Updates message every 3 tokens (rate limit safe)

### `apps/api/src/manychat.ts`
- ManyChat API client
- Fetch user data
- Send messages
- Update custom fields (CRM)
- Sync customer state (lead_score, funnel_stage, tags)
- Webhook handler for incoming messages

## Telegram Streaming Example

**User:** "build a product search endpoint"

**Response:**
```
🤔 Thinking... (appears instantly)

Then streams:
Ok, let's build a product search endpoint.

First, add a query param handler:

```typescript
app.get("/v1/products", async (request) => {
  const schema = z.object({
    q: z.string().trim().optional(),
    limit: z.number().default(50),
  });
  ...
});
```

Then add the SQL query with ILIKE...
```

Each word appears as generated, just like ChatGPT!

## ManyChat Customer Flow Example

**Customer:** "cuanto sale el iphone 15?"

**Flow:**
1. ManyChat webhook → API
2. Sales agent processes turn
3. AI generates response with product info
4. Sync state to ManyChat custom fields:
   - `lead_score: 10`
   - `funnel_stage: interested`
   - `last_intent: price_inquiry`
   - `tags: price_inquiry,hot_lead`
5. Send reply via ManyChat → WhatsApp

## Next Steps

1. **Get ManyChat credentials:**
   - Create ManyChat app
   - Get API key from settings
   - Add account ID
   - Update `.env`

2. **Test Telegram streaming:**
   - Send message
   - See "thinking..." appear
   - Watch response stream in real-time

3. **Add GitHub integration:**
   - Deploy key already configured
   - Add commands: `/commit`, `/push`, `/deploy`
   - Execute from Telegram chat

4. **ManyChat webhook setup:**
   - Configure ManyChat webhook URL
   - Point to `/webhooks/manychat`
   - Test incoming message flow

## Commands

```bash
# Check API logs
docker logs -f $(docker ps -q -f name=techno-open-claw-api)

# Test ManyChat config
curl http://127.0.0.1:4000/health

# Add ManyChat credentials
export MANYCHAT_API_KEY=xxx
export MANYCHAT_ACCOUNT_ID=yyy
docker compose restart api
```
