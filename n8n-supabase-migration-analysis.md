# n8n Supabase Migration Analysis

**Generated:** 2026-03-24 14:32 UTC  
**Files Analyzed:**
- `/root/.openclaw/workspace/n8n-workflow-v15.json` (TechnoStore - AI Sales Agent v15)
- `/root/.openclaw/workspace/n8n-workflow-orchestrator.json` (TechnoStore - Subagent Orchestrator v15)

---

## Executive Summary

Both workflows contain **extensive Supabase integrations** via HTTP Request nodes calling the Supabase REST API. There are **no native Supabase nodes** (`n8n-nodes-base.supabase`) used—instead, all Supabase operations are performed through generic HTTP Request nodes with environment variable credentials (`$env.SUPABASE_URL`, `$env.SUPABASE_KEY`).

**Total Supabase-dependent nodes:** 22 (11 per workflow)

---

## Findings by Category

### 1. Node Type Analysis

**No native Supabase nodes found.** All Supabase operations use:
- Node type: `n8n-nodes-base.httpRequest`
- Authentication: Environment variables (`SUPABASE_URL`, `SUPABASE_KEY`)
- Pattern: Direct REST API calls to `{{ $env.SUPABASE_URL }}/rest/v1/*`

### 2. Credential References

Both workflows reference Supabase credentials via:
- `{{ $env.SUPABASE_URL }}` - Supabase project URL
- `{{ $env.SUPABASE_KEY }}` - Supabase API key (used in `apikey` and `Authorization` headers)

### 3. Hardcoded Supabase URLs

**None found.** All Supabase URLs are dynamically constructed using environment variables.

---

## Detailed Node Inventory

### Workflow: n8n-workflow-v15.json (AI Sales Agent v15)

| # | Node ID | Node Name | Operation | Table/Endpoint | Action |
|---|---------|-----------|-----------|----------------|--------|
| 1 | `a180052e-deec-412b-a52f-caa3ab4770e9` | Save Incoming Message | POST | `/rest/v1/conversations` | INSERT |
| 2 | `7ad21699-5712-4349-b374-a2679b5071d3` | Check Is Latest (RPC) | POST | `/rest/v1/rpc/check_is_latest_message` | RPC (SELECT) |
| 3 | `d3771ec5-d7c0-4dad-94d7-97c7b28bbc96` | Fetch Recent Messages | GET | `/rest/v1/conversations` | SELECT |
| 4 | `f2fe5eaf-a73f-4021-a4a8-1d797d7cc39b` | Upsert Customer | POST | `/rest/v1/rpc/upsert_customer` | RPC (INSERT/UPDATE) |
| 5 | `83c401a0-576b-4626-a6d5-e0ae7dc72d1b` | Fetch Customer Profile | GET | `/rest/v1/v_customer_context` | SELECT (view) |
| 6 | `9978c16d-1293-4830-bd9e-f8afca9755eb` | Fetch Conversation History | GET | `/rest/v1/v_recent_conversations` | SELECT (view) |
| 7 | `7e1bf6a9-08d7-47d9-a577-d1380b33b87b` | Fetch Products | GET | `/rest/v1/v_product_catalog` | SELECT (view) |
| 8 | `d1150768-9b82-45f9-baa4-876fc75bac49` | Save Bot Message | POST | `/rest/v1/conversations` | INSERT |
| 9 | `117ce305-b5ec-4e4d-a304-634ab9fcc57a` | Update Customer | PATCH | `/rest/v1/customers` | UPDATE |
| 10 | `7ddb5e2d-d5d5-44d2-a0aa-e0d150af287d` | Update User Intent | PATCH | `/rest/v1/conversations` | UPDATE |
| 11 | `3b8e6e02-bef5-412a-84ad-7f3604d6a7ba` | Backfill Incoming Message Customer | PATCH | `/rest/v1/conversations` | UPDATE |

### Workflow: n8n-workflow-orchestrator.json (Subagent Orchestrator v15)

| # | Node ID | Node Name | Operation | Table/Endpoint | Action |
|---|---------|-----------|-----------|----------------|--------|
| 1 | `db2ba46e-e64a-4e86-81c9-02bed77bd161` | Save Incoming Message | POST | `/rest/v1/conversations` | INSERT |
| 2 | `24f68aa4-c4a4-43a4-9b1d-3586fb44f1f3` | Check Is Latest (RPC) | POST | `/rest/v1/rpc/check_is_latest_message` | RPC (SELECT) |
| 3 | `a434664f-b9da-4e5b-a171-89513f8cd435` | Fetch Recent Messages | GET | `/rest/v1/conversations` | SELECT |
| 4 | `757c9085-38e8-45f3-a013-1024e95ca9e0` | Upsert Customer | POST | `/rest/v1/rpc/upsert_customer` | RPC (INSERT/UPDATE) |
| 5 | `d2d6064a-9f77-43a8-95f3-da5977ba96a9` | Fetch Customer Profile | GET | `/rest/v1/v_customer_context` | SELECT (view) |
| 6 | `fb893cac-ca28-4a8a-b0de-6fc49a3ff7da` | Fetch Conversation History | GET | `/rest/v1/v_recent_conversations` | SELECT (view) |
| 7 | `482aecb5-8331-4be3-9c1b-f74f630a802a` | Fetch Products | GET | `/rest/v1/v_product_catalog` | SELECT (view) |
| 8 | `5fa2b094-088d-4432-beef-405b7ae8f615` | Save Bot Message | POST | `/rest/v1/conversations` | INSERT |
| 9 | `34deae77-8a39-41ca-a47b-0e3661f98cbf` | Update Customer | PATCH | `/rest/v1/customers` | UPDATE |
| 10 | `9072f120-f78d-454d-ad2c-1bec44091d28` | Update User Intent | PATCH | `/rest/v1/conversations` | UPDATE |
| 11 | `afee327a-0809-4737-8340-21ad622b286c` | Backfill Incoming Message Customer | PATCH | `/rest/v1/conversations` | UPDATE |

---

## Database Tables & Views Referenced

| Table/View | Operations | Purpose |
|------------|------------|---------|
| `conversations` | INSERT, SELECT, UPDATE | Store chat messages (user/bot) |
| `customers` | UPDATE | Customer profile updates |
| `v_customer_context` | SELECT | Customer profile view |
| `v_recent_conversations` | SELECT | Conversation history view |
| `v_product_catalog` | SELECT | Product catalog view |
| `rpc/check_is_latest_message` | RPC | Debounce validation |
| `rpc/upsert_customer` | RPC | Customer upsert logic |

---

## Migration Recommendations

### Recommended PostgreSQL Node Replacement

n8n provides a **native Postgres node** (`n8n-nodes-base.postgres`) that should replace all Supabase HTTP Request nodes. Benefits:
- Native SQL query support
- Better error handling
- Connection pooling
- Type safety
- No REST API overhead

### Migration Steps

1. **Create PostgreSQL credentials** in n8n:
   - Host: Your PostgreSQL server
   - Port: 5432
   - Database: Your database name
   - User: Your database user
   - Password: Your database password
   - SSL: Enable if required

2. **Replace each HTTP Request node** with a Postgres node:

| Current Pattern | Postgres Replacement |
|-----------------|---------------------|
| `POST /rest/v1/conversations` | `INSERT INTO conversations (...) VALUES (...)` |
| `GET /rest/v1/conversations?filter=...` | `SELECT * FROM conversations WHERE ...` |
| `PATCH /rest/v1/conversations?id=eq.X` | `UPDATE conversations SET ... WHERE id = X` |
| `POST /rest/v1/rpc/function` | `SELECT function(...)` |
| `GET /rest/v1/v_*` | `SELECT * FROM v_* WHERE ...` |

3. **Update authentication**: Replace `$env.SUPABASE_URL` and `$env.SUPABASE_KEY` with PostgreSQL credential reference.

4. **Test each node** individually before deploying.

---

## Node-Specific Migration Details

### INSERT Operations (conversations table)

**Nodes:** Save Incoming Message, Save Bot Message

**Current:**
```json
{
  "method": "POST",
  "url": "{{ $env.SUPABASE_URL }}/rest/v1/conversations",
  "jsonBody": "{{ JSON.stringify({...}) }}"
}
```

**Postgres Replacement:**
```sql
INSERT INTO conversations (manychat_id, customer_id, role, message, message_type, was_audio, audio_transcription, intent_detected, products_mentioned, triggered_human)
VALUES ({{ $json.subscriber_id }}, NULL, 'user', '{{ $json.user_message }}', 'text', false, NULL, NULL, ARRAY[]::text[], false)
RETURNING id
```

### SELECT Operations

**Nodes:** Fetch Recent Messages, Fetch Customer Profile, Fetch Conversation History, Fetch Products

**Current:**
```json
{
  "method": "GET",
  "url": "{{ $env.SUPABASE_URL }}/rest/v1/conversations?manychat_id=eq.XXX&role=eq.user&order=created_at.desc&limit=12"
}
```

**Postgres Replacement:**
```sql
SELECT * FROM conversations
WHERE manychat_id = '{{ $json.subscriber_id }}'
  AND role = 'user'
ORDER BY created_at DESC
LIMIT 12
```

### UPDATE Operations

**Nodes:** Update Customer, Update User Intent, Backfill Incoming Message Customer

**Current:**
```json
{
  "method": "PATCH",
  "url": "{{ $env.SUPABASE_URL }}/rest/v1/customers?manychat_id=eq.XXX",
  "jsonBody": "{{ JSON.stringify({...}) }}"
}
```

**Postgres Replacement:**
```sql
UPDATE customers
SET funnel_stage = '{{ $json.funnel_stage }}',
    city = '{{ $json.city }}',
    updated_at = NOW()
WHERE manychat_id = '{{ $json.subscriber_id }}'
RETURNING id
```

### RPC Functions

**Nodes:** Check Is Latest (RPC), Upsert Customer

**Current:**
```json
{
  "method": "POST",
  "url": "{{ $env.SUPABASE_URL }}/rest/v1/rpc/upsert_customer",
  "jsonBody": "{\"p_manychat_id\": \"XXX\", ...}"
}
```

**Postgres Replacement:**
```sql
SELECT upsert_customer(
  p_manychat_id := '{{ $json.subscriber_id }}',
  p_phone := '{{ $json.phone }}',
  p_first_name := '{{ $json.first_name }}',
  ...
)
```

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Environment variable migration | Medium | Ensure PostgreSQL connection string is properly configured |
| RPC function compatibility | High | Verify PostgreSQL has equivalent stored procedures |
| View compatibility | Medium | Ensure PostgreSQL views match Supabase view schemas |
| Authentication header changes | Low | Postgres node handles auth internally |
| Query parameter syntax | Medium | Convert Supabase filters to SQL WHERE clauses |

---

## Action Items

1. ✅ **Audit complete** - 22 Supabase-dependent nodes identified
2. ⏳ **Create PostgreSQL credentials** in n8n
3. ⏳ **Verify database schema** - Ensure PostgreSQL has equivalent tables/views/functions
4. ⏳ **Replace nodes** - Start with non-critical workflows (orchestrator first)
5. ⏳ **Test thoroughly** - Validate each node produces identical results
6. ⏳ **Update environment** - Remove `SUPABASE_URL` and `SUPABASE_KEY` after migration

---

## Appendix: Common Supabase → Postgres Mappings

| Supabase REST | PostgreSQL SQL |
|---------------|----------------|
| `?column=eq.value` | `WHERE column = value` |
| `?column=neq.value` | `WHERE column != value` |
| `?column=gt.value` | `WHERE column > value` |
| `?column=like.*value*` | `WHERE column ILIKE '%value%'` |
| `?order=column.desc` | `ORDER BY column DESC` |
| `?limit=N` | `LIMIT N` |
| `?offset=N` | `OFFSET N` |
| `/rpc/function` | `SELECT function(...)` |
| `Prefer: return=representation` | `RETURNING *` |

---

**End of Analysis**
