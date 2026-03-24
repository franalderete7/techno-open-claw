# TechnoStore v17 → App-Native Migration Summary

**Date:** 2026-03-24  
**Status:** Complete - Core logic migrated from n8n workflows to backend code

## What Was Reverse-Engineered from v17

### Active n8n Workflows (Production)

1. **TechnoStore - v17 State Update** (`DICGvMxJ4G19Pe2052uez`)
   - Applies state deltas to customer records
   - Updates: tags, lead_score, funnel_stage, intent_key
   - Merges tag arrays, removes duplicates
   - Calculates lead_score with clamping (0-100)

2. **TechnoStore - v17 Validator** (`u35r-7F_twFTPb_L4DEbG`)
   - Response validation rules
   - Strips unexpected URLs (only allows store URL)
   - Enforces 1100 character limit
   - Filters allowed actions: `attach_store_url`, `attach_product_images`, `share_store_location`, `no_reply`
   - Builds final_state_delta with intent/funnel/lead_score

3. **TechnoStore - v17 Context Builder** (`BY00FFywXd4eTgLBY_Kg-`)
   - Calls Supabase RPC `v17_build_turn_context`
   - Fetches: recent messages (6), candidate products (8), store settings
   - Normalizes context structure

4. **TechnoStore - v17 Router** (`kIB7QWGbk-c10wipEkuR1`)
   - Intent classification based on keywords
   - Routes: `exact_product_quote`, `brand_catalog`, `generic_sales`, `store_info`, `storefront_order`
   - Detects: city, budget_range, payment_method, matched_products

5. **Main Orchestrator Workflow**
   - Ties all sub-workflows together
   - Uses Gemini AI for response generation
   - ManyChat/WhatsApp ingestion
   - Audio transcription (Groq Whisper)
   - 8s debounce + latest-message check
   - State delta application
   - Outbound response delivery

### Key Business Logic Patterns

- **Customer identification:** By subscriber_id (ManyChat) or phone
- **Conversation threading:** By channel + thread_key
- **Message deduplication:** RPC check for latest message
- **Product matching:** By brand/model mentions in text
- **Intent detection:** Keyword-based classification
- **Funnel stages:** greeting → browsing → interested → closing
- **Lead scoring:** Incremental deltas (5-15 points per interaction)
- **Tagging:** Array-based tag management with add/remove lists

## What Was Built (App-Native)

### New Backend Module: `sales-agent.ts`

**Location:** `/srv/techno-open-claw/apps/api/src/sales-agent.ts`

**Functions:**

1. `fetchTurnContext()` - Database context building
   - Fetches/creates customer by external_ref
   - Fetches/creates conversation by channel_thread_key
   - Loads recent messages (6)
   - Loads candidate products (8)
   - Loads store settings

2. `routeTurn()` - Intent classification
   - Keyword-based product mention detection
   - Route classification (5 routes)
   - City detection (Salta, Buenos Aires, etc.)

3. `generateResponse()` - AI response generation
   - Uses Ollama qwen3.5:cloud (on VPS)
   - System prompt for sales assistant role
   - Context-aware prompt building
   - Fallback response on AI failure

4. `validateResponse()` - Response validation
   - 1100 character limit enforcement
   - URL stripping (only store URL allowed)
   - Action filtering
   - State delta building
   - Tag assignment based on intent

5. `applyStateDelta()` - Customer state updates
   - Tag merging (add/remove)
   - Lead score calculation with clamping
   - Notes field for structured metadata
   - Audit logging

6. `processTurn()` - Complete turn processing
   - Debounce check (latest message)
   - Context → Route → AI → Validate → Apply
   - Returns: should_reply, reply_text, customer_id, conversation_id

7. `transcribeAudio()` - Groq Whisper transcription
   - Downloads from Telegram
   - Uploads to Groq API
   - Returns transcript text

### New Webhook Handler: `telegram-webhook.ts`

**Location:** `/srv/techno-open-claw/apps/api/src/telegram-webhook.ts`

**Replaces:** Inline webhook handler in `index.ts`

**Flow:**
1. Parse Telegram update
2. Check allowlist
3. Infer message type
4. Transcribe audio if needed
5. Call `processTurn()` from sales-agent
6. Save inbound message
7. Send reply via Telegram Bot API

## Architecture Comparison

| Aspect | Old (n8n v17) | New (App-Native) |
|--------|---------------|------------------|
| Workflow engine | n8n visual workflows | TypeScript backend code |
| AI model | Gemini API | Ollama qwen3.5:cloud (VPS) |
| Audio transcription | Groq Whisper (n8n node) | Groq Whisper (backend function) |
| Database | Supabase PostgreSQL | Self-hosted PostgreSQL |
| Message storage | Supabase tables | Local messages table |
| Customer storage | Supabase customers | Local customers table |
| State management | Workflow JSON state | Database notes field |
| Response validation | Workflow code node | validateResponse() function |
| Routing | Workflow router node | routeTurn() function |
| Deployment | n8n container + workflows | API container + code |

## Migration Benefits

1. **Auditable:** All logic in version-controlled code, not workflow JSON
2. **Testable:** Unit tests can be written for each function
3. **Debuggable:** Stack traces, logs, breakpoints
4. **Maintainable:** No workflow import/export cycles
5. **Self-hosted:** No Supabase dependency
6. **Cost control:** Ollama on VPS vs. Gemini API calls
7. **Simpler:** Single codebase, no workflow orchestration layer

## What's Not Yet Implemented

- ManyChat integration (legacy, can bridge later if needed)
- WhatsApp direct integration (was via ManyChat)
- Storefront order handoff RPC calls
- Advanced product image attachment actions
- Payment method detection
- Budget range detection
- Tag definitions table (currently in notes field)

## Next Steps

1. **Test the flow:** Send Telegram message, verify AI reply
2. **Add products:** Populate product catalog for testing
3. **Monitor logs:** Watch for errors in turn processing
4. **Extend detection:** Improve city/brand/payment detection
5. **Add tests:** Unit tests for routeTurn, validateResponse
6. **Bridge legacy:** Optional ManyChat → backend bridge if needed

## Commands to Verify

```bash
# Check API health
curl http://127.0.0.1:4000/health

# List products
./scripts/api/products-list.sh

# Create test product
cat > /tmp/product.json <<'JSON'
{
  "sku": "iphone-15-128-black",
  "brand": "Apple",
  "model": "iPhone 15",
  "title": "iPhone 15 128GB Black",
  "condition": "new",
  "price_amount": 1121280,
  "currency_code": "ARS",
  "active": true
}
JSON
./scripts/api/product-create.sh /tmp/product.json

# Check conversations
./scripts/api/conversations-list.sh

# Check messages
docker exec techno-open-claw-postgres psql -U techno -d techno_open_claw \
  -c "SELECT id, direction, sender_kind, message_type, text_body, created_at FROM messages ORDER BY created_at DESC LIMIT 10;"
```

## Files Changed

- `apps/api/src/config.ts` - Added GROQ_API_KEY
- `apps/api/src/telegram.ts` - Added getTelegramFileUrl()
- `apps/api/src/index.ts` - Wired handleTelegramWebhook
- `apps/api/src/telegram-webhook.ts` - New modular webhook handler
- `apps/api/src/sales-agent.ts` - New core sales agent module
- `docs/V17_MIGRATION_SUMMARY.md` - This document
