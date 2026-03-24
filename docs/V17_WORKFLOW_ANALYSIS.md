# TechnoStore v17 Workflow Analysis

**Date:** 2026-03-24  
**Source:** Published n8n workflows (7 active workflows)  
**Purpose:** Reverse-engineer business logic for migration to app/backend

---

## Executive Summary

The v17 architecture is a **modular, component-based WhatsApp sales agent** with:
- Deterministic routing (code-based, not AI)
- Dual responder strategy (AI for sales, deterministic for info)
- Validation layer before delivery
- State management for customer profiling
- Audio transcription support
- Debounce protection against duplicate messages

**Total:** 7 published workflows forming one pipeline

---

## Published v17 Workflows

| Workflow | ID | Purpose | Nodes |
|----------|-----|---------|-------|
| **AI Sales Agent v17** | `Zh2Tsqj-Iwj0HJF8borq3` | Main orchestrator | 26 |
| **Context Builder** | `BY00FFywXd4eTgLBY_Kg-` | Fetch/normalize turn context | 4 |
| **Router** | `kIB7QWGbk-c10wipEkuR1` | Intent classification & routing | 2 |
| **Sales Responder** | `VJ5MroOFh7FO3wmxU7GaL` | AI-powered sales responses | 5 |
| **Info Responder** | `sNSZb6O7LG-29Tn4twjvl` | Deterministic store info | 2 |
| **Validator** | `u35r-7F_twFTPb_L4DEbG` | Response validation & sanitization | 2 |
| **State Update** | `DICGvMxJ4G19Pe2052uez` | Customer state & audit logging | 6 |

---

## Pipeline Flow

```
Webhook (ManyChat/WhatsApp)
    ↓
Parse Input (extract subscriber_id, message, audio detection, storefront order detection)
    ↓
Is Audio? → Download + Groq Whisper Transcribe
    ↓
Merge Input (combine parsed + transcribed)
    ↓
Upsert Customer (API call)
    ↓
Save Incoming Message (API call)
    ↓
Wait 8s Debounce
    ↓
Check Is Latest (RPC call)
    ↓
Is Latest? IF → Continue or Skip
    ↓
Execute Context Builder (fetch customer profile, recent messages, products, store config)
    ↓
Execute Router (classify intent, set route_key)
    ↓
Use Info Responder? IF → route_key in [storefront_order, store_info]
    ↓    ↓
    │    Execute Info Responder (deterministic)
    │    ↓
    │    Execute Sales Responder (AI via Gemini)
    ↓
Execute Validator (sanitize, validate, fallback)
    ↓
Should Send? IF → not skipped
    ↓    ↓
    │    Prepare WhatsApp Payload
    │    ↓
    │    Send to WhatsApp (API call)
    │    ↓
    │    Build Sent State Input
    ↓
    Build Skipped State Input
    ↓
Execute State Update (customer updates, bot message log, AI turn log)
```

---

## Component Breakdown

### 1. Main Agent (`Zh2Tsqj-Iwj0HJF8borq3`)

**Ingress:**
- Webhook at `/webhook/techno-sales-v17` (POST)
- Expects ManyChat payload: `subscriber_id`, `message`, `first_name`, `custom_fields`, `whatsapp_phone`

**Input Parsing:**
- Extracts `subscriber_id`, `first_name`, `phone`, `timezone`, `city`, `funnel_stage`, `interested_product`
- Detects audio URLs (starts with `https://` + contains `fbsbx.com`, `fbcdn.net`, or `manybot-files.s3`)
- Detects storefront order handoff: regex matches `pedido web #?(\d+)` + `token ([a-z0-9_-]{8,64})`
- Sets `is_empty` if no message

**Audio Handling:**
- If audio detected → Download via HTTP → Groq Whisper API (`/v1/audio/transcriptions`)
- Merge transcribed text back into `user_message`

**Customer Management:**
- Upsert customer via API (creates or updates by `manychat_id`)
- Attach `customer_id` to downstream flow

**Message Logging:**
- Save incoming message to API (`/api/messages`)
- Attach `saved_message_id`

**Debounce Logic:**
- Wait 8 seconds
- RPC call to check if this is still the latest message for the customer
- If not latest → skip processing (prevents duplicate responses to rapid messages)

**Sub-workflow Calls:**
- Context Builder → Router → (Info Responder OR Sales Responder) → Validator → State Update

**Delivery:**
- Build WhatsApp payload (ManyChat format v2)
- Send via HTTP POST to ManyChat/WhatsApp API
- Log send result or skip result

---

### 2. Context Builder (`BY00FFywXd4eTgLBY_Kg-`)

**Purpose:** Fetch and normalize turn context from API

**Logic:**
1. Normalize input (ensure `user_message`, `channel` exist)
2. HTTP GET to API: `/api/conversations/context?manychat_id={{subscriber_id}}`
   - Expected response: `{ v17_build_turn_context: { customer, recent_messages, candidate_products, store, storefront_handoff } }`
3. Normalize context:
   - Ensure `context.store` exists
   - Set default `store_website_url = 'https://puntotechno.com'`

**Data Structure Passed Downstream:**
```json
{
  "customer": { ... },           // Customer profile
  "recent_messages": [...],      // Last ~8 messages
  "candidate_products": [...],   // Pre-fetched product recommendations
  "store": {                     // Store configuration
    "store_location_name": "TechnoStore Salta",
    "store_address": "Caseros 1365, Salta Capital...",
    "store_hours": "Lunes a Viernes: 10:00-13:00 y 18:00-21:00...",
    "store_payment_methods": "transferencia, Bitcoin, USDT, efectivo...",
    "store_shipping_policy": "Envíos GRATIS a sucursal...",
    "store_warranty_new": "Garantía oficial...",
    "store_warranty_used": "Incluye cable y cargador...",
    "store_website_url": "https://puntotechno.com"
  },
  "storefront_handoff": {        // Optional order handoff
    "ok": true,
    "order": { "id": 123, "item_count": 2, "subtotal": 712480 }
  }
}
```

---

### 3. Router (`kIB7QWGbk-c10wipEkuR1`)

**Purpose:** Deterministic intent classification (no AI)

**Detection Logic:**

**Brand Extraction:**
```javascript
if (/(iphone|apple|ipad|macbook)/) → 'apple'
if (/(samsung|galaxy)/) → 'samsung'
if (/(motorola|moto)/) → 'motorola'
if (/(xiaomi)/) → 'xiaomi'
if (/(redmi|poco)/) → 'redmi'
if (/(google|pixel)/) → 'google'
```

**Tier Extraction:**
```javascript
if (/(pro max|promax)/) → 'pro_max'
if (/(ultra)/) → 'ultra'
if (/(pro)/) → 'pro'
if (/(plus)/) → 'plus'
```

**Model Detection:**
- Family number: `iphone|galaxy|redmi|note|poco|moto|motorola|pixel|xiaomi\s+([0-9]{1,3})`
- Storage: `\b(64|128|256|512|1024)\b`
- Variant token: `A\d{1,3}|S\d{1,3}|G\d{1,3}|X\d{1,3}|Z\s?Flip\s?\d|Z\s?Fold\s?\d|Edge\s?\d{1,3}|Note\s?\d{1,3}|Reno\s?\d{1,3}|Find\s?X\d{1,2}`

**Query Classification:**
- `asksPriceDirectly`: `/(precio|cuanto sale|cuánto sale|valor|costo|cotizacion)/`
- `wantsStoreInfo`: `/(ubicacion|direccion|sucursal|horario|abren|cierran|medios de pago|envio|garantia|como llego|donde estan|retiro)/`

**Routing Decision Tree:**

```javascript
if (storefrontHandoff.ok === true) {
  route_key = 'storefront_order'
  use_info_responder = true
  confidence = 0.99
} else if (wantsStoreInfo) {
  route_key = 'store_info'
  use_info_responder = true
  confidence = 0.9
} else if (brandKeys.length > 0 && (familyNumber || storageValue || tierKey || hasModelVariantToken || asksPriceDirectly)) {
  route_key = 'exact_product_quote'
  search_mode = 'exact'
  confidence = 0.9 (or 0.78 if no candidates pre-loaded)
} else if (brandKeys.length > 0 || tierKey !== null) {
  route_key = 'brand_catalog'
  search_mode = 'brand_browse'
  confidence = 0.75
} else if (isFirstContact) {
  route_key = 'generic_sales'
  search_mode = 'catalog_broad'
  confidence = 0.72
} else {
  route_key = 'generic_sales'
  search_mode = 'catalog_broad'
  confidence = 0.72
}
```

**Output:**
```json
{
  "route_key": "exact_product_quote" | "brand_catalog" | "generic_sales" | "store_info" | "storefront_order",
  "search_mode": "exact" | "brand_browse" | "catalog_broad" | "info" | "storefront_handoff",
  "retrieval_scope": "...",
  "should_offer_store_url": true/false,
  "confidence": 0.72-0.99,
  "rationale": "Consulta amplia de ventas.",
  "use_info_responder": true/false
}
```

---

### 4. Sales Responder (`VJ5MroOFh7FO3wmxU7GaL`)

**Purpose:** AI-powered sales responses via Google Gemini

**Prompt Building:**
- Curates top 3-4 candidate products (based on route)
- Builds structured JSON prompt with:
  - Route info
  - Customer data
  - Store config
  - Candidate products
  - Expected JSON schema

**AI Call:**
- Model: `models/gemini-2.5-flash` (from env `GEMINI_MODEL_SALES`)
- System prompt (in Spanish):
  ```
  Sos el vendedor de WhatsApp de TechnoStore Salta. Respondé en español natural, humano, breve y comercial.
  Sin markdown, sin viñetas. No inventes stock, precios, cuotas, links ni modelos.
  Usá únicamente los hechos provistos.
  Si la consulta es amplia o de primer contacto y should_offer_store_url es true,
  podés mencionar puntotechno.com una sola vez de forma natural.
  Si el usuario pidió un modelo exacto, respondé primero sobre ese modelo.
  El sitio es secundario.
  Cerrá con una sola pregunta concreta si ayuda a avanzar la venta.
  Devolvé SOLO JSON válido con las claves: reply_text, selected_product_keys, actions, state_delta.
  No agregues explicaciones fuera del JSON.
  ```

**Expected AI Response Schema:**
```json
{
  "reply_text": "string",
  "selected_product_keys": ["product_key1", "product_key2"],
  "actions": ["attach_store_url", "attach_product_images"],
  "state_delta": {
    "intent_key": "price_inquiry",
    "funnel_stage": "interested",
    "lead_score_delta": 8,
    "share_store_location": false,
    "selected_product_keys": ["product_key1"],
    "tags_to_add": ["catalog_interest"],
    "tags_to_remove": [],
    "payment_method_key": null,
    "summary": "Cliente pregunta por iPhone 15 Pro Max 256GB"
  }
}
```

**Response Normalization:**
- Parse JSON (with fallback regex extraction if wrapped in text)
- Fallback reply if parse fails:
  - If `exact_product_quote` → "Sí, tengo [product]. Queda en ARS [price]..."
  - Else → "Sí, te ayudo por acá. Si querés también podés mirar todo el catálogo en https://puntotechno.com..."
- Strip markdown (`**`, `*`, headers, code blocks)
- Strip unexpected URLs (only allow `puntotechno.com`)
- Extract `selected_product_keys`, `actions`, `state_delta`

---

### 5. Info Responder (`sNSZb6O7LG-29Tn4twjvl`)

**Purpose:** Deterministic store info responses (no AI)

**Detection:**
```javascript
wantsLocation = /(ubicacion|direccion|sucursal|como llego|donde estan|donde quedan|mapa)/
wantsHours = /(horario|abren|cierran|hora)/
wantsPayments = /(pago|pagos|cuotas|tarjeta|transferencia|efectivo|crypto|mercado pago)/
wantsShipping = /(envio|envios|despacho|retiro)/
wantsWarranty = /(garantia|warranty)/
```

**Response Logic:**

**Case `storefront_order`:**
```
"Perfecto, ya tomé tu pedido web #{{order.id}}. Veo {{item_count}} producto(s) por ARS {{subtotal}}.
Seguimos por acá con la gestión. Si ya hiciste el pago, mandame el comprobante por este chat."
```
- `intent_key = 'storefront_order'`
- `funnel_stage = 'closing'`
- `lead_score_delta = 10`

**Case `store_info`:**
- Build parts array based on detected intent:
  - Location: "Estamos en {{store_address}}."
  - Hours: "Horario: {{store_hours}}"
  - Payments: "Medios de pago: {{store_payment_methods}}"
  - Shipping: "Envíos: {{store_shipping_policy}}"
  - Warranty: "Nuevos: {{store_warranty_new}}", "Usados: {{store_warranty_used}}"
  - Store URL: "Si querés ver todo el catálogo, también lo tenés en {{website}}."
- Always append: "Si querés, decime qué modelo buscás y te oriento por acá."

**Output:**
```json
{
  "route_key": "store_info",
  "reply_text": "...",
  "selected_product_keys": [],
  "actions": ["attach_store_url"] (if should_offer_store_url),
  "state_delta": {
    "intent_key": "store_info",
    "funnel_stage": "browsing",
    "lead_score_delta": 2,
    "share_store_location": true/false,
    "summary": "Respuesta de información general de la tienda."
  }
}
```

---

### 6. Validator (`u35r-7F_twFTPb_L4DEbG`)

**Purpose:** Validate, sanitize, and ensure response quality

**Validation Steps:**

1. **Product Key Validation:**
   - Filter `selected_product_keys` against `candidate_products` map
   - If `exact_product_quote` route and no keys selected → use first candidate

2. **Action Allowlist:**
   - Allowed: `attach_store_url`, `attach_product_images`, `share_store_location`, `no_reply`
   - Filter out unknown actions

3. **URL Stripping:**
   - Remove all URLs except `puntotechno.com` (if route allows)
   - Routes that allow store URL: `brand_catalog`, `generic_sales`, `store_info`

4. **Empty Reply Fallback:**
   - If `reply_text` is empty → apply route-specific fallback
   - Log validation warning

5. **State Delta Completion:**
   - Apply defaults based on `route_key`:
     ```javascript
     defaultIntentByRoute = {
       storefront_order: 'storefront_order',
       exact_product_quote: 'price_inquiry',
       brand_catalog: 'catalog_browse',
       generic_sales: 'greeting',
       store_info: 'store_info'
     }
     defaultStageByRoute = {
       storefront_order: 'closing',
       exact_product_quote: 'interested',
       brand_catalog: 'browsing',
       generic_sales: 'browsing',
       store_info: 'browsing'
     }
     ```
   - Ensure `lead_score_delta` is numeric
   - Ensure `selected_product_keys` filtered to valid candidates
   - Ensure `summary` ≤ 240 chars

6. **Auto-Enrich State:**
   - If `selected_product_keys` present but not in `state_delta` → copy them

**Output:**
```json
{
  "final_state_delta": { ... },
  "selected_product_keys": ["key1", "key2"],
  "validation_errors": [],
  "validation_warnings": []
}
```

---

### 7. State Update (`DICGvMxJ4G19Pe2052uez`)

**Purpose:** Update customer state, log bot message, log AI turn

**Customer Updates:**
```javascript
updates = {
  last_bot_interaction: ISO timestamp,
  updated_at: ISO timestamp,
  last_intent: state.intent_key,
  funnel_stage: state.funnel_stage,
  lead_score: max(0, min(100, current + delta)),
  tags: merge(current, tags_to_add, remove tags_to_remove),
  interested_product: selected_product_keys[0],
  payment_method_last: state.payment_method_key,
  brands_mentioned: merge(current, detected brands from selected products)
}
```

**Bot Message Row (if should_send):**
```json
{
  "manychat_id": subscriber_id,
  "customer_id": customer_id,
  "role": "bot",
  "message": bot_message_text,
  "message_type": "text",
  "intent_detected": state.intent_key,
  "products_mentioned": selected_product_keys,
  "triggered_human": false,
  "was_audio": false,
  "channel": "manychat",
  "applied_tags": state.tags_to_add,
  "payment_methods_detected": [state.payment_method_key],
  "brands_detected": brandList,
  "topics_detected": [route_key],
  "funnel_stage_after": state.funnel_stage,
  "conversation_summary": state.summary,
  "conversation_insights": ["Ruta " + route_key, "Producto " + key1, ...],
  "lead_score_after": nextLeadScore
}
```

**AI Turn Row (audit log):**
```json
{
  "workflow_version": "v17",
  "provider_name": "google" | "deterministic",
  "model_name": "gemini-2.5-flash" | "deterministic-info",
  "manychat_id": subscriber_id,
  "customer_id": customer_id,
  "route_key": route_key,
  "user_message": "...",
  "context_payload": {...},
  "router_payload": {...},
  "responder_payload": {...},
  "validator_payload": {...},
  "state_delta": {...},
  "selected_product_keys": [...],
  "validation_errors": [...],
  "success": true/false,
  "failure_reason": null
}
```

---

## Business Rules Summary

### Routing Rules

| Trigger | Route | Responder | Confidence |
|---------|-------|-----------|------------|
| Storefront order handoff detected | `storefront_order` | Info | 0.99 |
| Store info query (location, hours, payments, shipping, warranty) | `store_info` | Info | 0.9 |
| Brand + model details (family number, storage, tier, variant) | `exact_product_quote` | Sales | 0.9 |
| Brand mention without specifics | `brand_catalog` | Sales | 0.75 |
| First contact / generic | `generic_sales` | Sales | 0.72 |

### Response Rules

**Sales Responder:**
- Spanish Rioplatense (vos, tenés, dale, joya)
- Max 3-4 sentences, 1-2 emojis
- Never invent prices/stock/specs
- Never expose product_key internally
- Ask before listing (filter by brand, tier, budget)
- Mention store URL only on first contact or broad queries
- Close with concrete question

**Info Responder:**
- Deterministic from store config
- No AI, no hallucination risk
- Always append CTA: "decime qué modelo buscás y te oriento"

### State Management

**Lead Score:**
- Range: 0-100
- Delta per turn: +2 (info) to +10 (storefront order)
- Clamped to bounds

**Funnel Stages:**
- `new` → `browsing` → `interested` → `closing` → `human_handoff`

**Intents:**
- `greeting`, `price_inquiry`, `stock_check`, `comparison`, `purchase_intent`
- `cuotas_inquiry`, `shipping_inquiry`, `complaint`, `off_topic`, `followup`, `ambiguous`
- `storefront_order`, `store_info`

**Tags:**
- Add: `catalog_interest`, `brand_iphone`, `brand_samsung`, etc.
- Remove: as specified in state_delta

---

## Migration Recommendations

### ✅ Must Move to App/Backend

1. **Audio Transcription**
   - Groq Whisper API integration
   - Audio URL detection logic

2. **Customer Management**
   - Upsert by `manychat_id` / `subscriber_id`
   - Lead score tracking
   - Funnel stage tracking
   - Tag management
   - Brands mentioned tracking

3. **Message Logging**
   - Incoming message save
   - Outgoing bot message save
   - AI turn audit log

4. **Debounce Logic**
   - 8-second wait
   - RPC "is latest message" check
   - Skip if duplicate

5. **Context Fetching**
   - Customer profile
   - Recent messages (last 8)
   - Candidate products (pre-fetch for AI context)
   - Store configuration

6. **Routing Logic**
   - Brand detection regex
   - Tier detection regex
   - Model number detection
   - Storage detection
   - Store info query detection
   - Route classification tree

7. **Sales Responder**
   - Prompt building with context
   - Google Gemini API call
   - JSON response parsing
   - Fallback reply generation
   - URL stripping
   - Markdown stripping

8. **Info Responder**
   - Deterministic response building
   - Store config lookup
   - Route-based templates

9. **Validation**
   - Product key validation
   - Action allowlist
   - URL sanitization
   - Empty reply fallback
   - State delta completion

10. **State Update**
    - Customer record updates
    - Bot message logging
    - AI turn logging
    - Tag merge logic
    - Lead score clamping

11. **Delivery**
    - ManyChat/WhatsApp API integration
    - Payload building (v2 format)
    - Send/skip logic

### ⚠️ Can Be Simplified

1. **ManyChat-specific field mappings**
   - Generalize to `subscriber_id`, `channel`, `platform_id`
   - Support Telegram, WhatsApp Cloud API directly

2. **Hardcoded store config**
   - Move to `settings` table in DB
   - Editable via admin UI

3. **Workflow IDs**
   - Not needed in app (single codebase)

4. **n8n expression syntax**
   - Native JavaScript/TypeScript

5. **Separate workflow files**
   - Single modular codebase with clear separation

### ❌ Can Be Ignored

1. **n8n node wiring**
   - Implementation detail of workflow engine

2. **executeWorkflowTrigger nodes**
   - Replaced by function calls

3. **HTTP request node configs**
   - Native fetch/axios

4. **ManyChat custom_fields structure**
   - Use direct customer record fields

5. **Workflow version tracking in DB**
   - Only needed for audit (keep `workflow_version: 'v17'` in turn log)

---

## Architecture Proposal for App

```
/apps/api/src/
  telegram.ts          → Already exists (webhook ingestion)
  whatsapp.ts          → New: WhatsApp/ManyChat webhook ingestion
  
  services/
    audio.ts           → Groq Whisper transcription
    customers.ts       → Customer upsert, lead score, tags, funnel
    conversations.ts   → Message save, context fetch
    debounce.ts        → 8s wait + RPC latest check
    routing.ts         → Intent classification, route decision
    responders/
      sales.ts         → Gemini AI prompt + parse + fallback
      info.ts          → Deterministic store info
    validation.ts      → Response validation, sanitization
    state.ts           → Customer updates, audit logging
    delivery.ts        → ManyChat/WhatsApp payload + send
  
  routes/
    webhooks/
      telegram.ts      → Already exists
      whatsapp.ts      → New
    conversations/
      context.ts       → GET /api/conversations/context
      turn.ts          → POST /api/conversations/turn (main entry)
```

---

## Next Steps

1. **Implement webhook ingestion** for WhatsApp/ManyChat
2. **Build context endpoint** (`GET /api/conversations/context`)
3. **Implement routing service** (deterministic classification)
4. **Implement sales responder** (Gemini AI integration)
5. **Implement info responder** (deterministic templates)
6. **Implement validation service** (sanitization, fallbacks)
7. **Implement state update service** (customer updates, audit logs)
8. **Implement delivery service** (ManyChat/WhatsApp API)
9. **Add debounce logic** (8s wait + RPC check)
10. **Add audio transcription** (Groq Whisper)

---

## Key Learnings from v17

1. **Modular architecture works** – separate concerns (routing, responding, validating, state)
2. **Deterministic routing is reliable** – no AI hallucination in intent classification
3. **Dual responder strategy** – AI for sales, deterministic for info (reduces cost + hallucination)
4. **Validation layer is critical** – prevents bad responses from reaching customers
5. **State management matters** – lead score, funnel stage, tags enable personalization
6. **Debounce is necessary** – prevents duplicate responses to rapid messages
7. **Audit logging is valuable** – `ai_turn` table provides full traceability
