# Database Schema - TechnoStore

## Tables & Columns

### `public.products`
Product catalog with all specs

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| sku | text | Unique SKU (e.g., `iphone-15-128-black`) |
| slug | text | URL-friendly slug |
| brand | text | Brand name (Apple, Samsung, Xiaomi, etc.) |
| model | text | Model name (iPhone 15, Galaxy S25, etc.) |
| title | text | Full product title |
| description | text | Product description |
| condition | text | `new`, `used`, `like_new`, `refurbished` |
| price_amount | numeric | Price in ARS |
| currency_code | text | Currency (ARS, USD) |
| active | boolean | Is product active/visible |
| image_url | text | Product image URL (Cloudinary) |
| ram_gb | integer | RAM in GB |
| storage_gb | integer | Storage in GB |
| network | text | `4g`, `5g`, null |
| color | text | Color name |
| battery_health | integer | Battery % (for used devices) |
| created_at | timestamptz | Creation timestamp |
| updated_at | timestamptz | Last update timestamp |

### `public.stock_units`
Individual physical units (inventory tracking)

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| product_id | integer | FK → products.id |
| serial_number | text | Device serial/IMEI |
| color | text | Actual unit color |
| battery_health | integer | Battery health % |
| status | text | `in_stock`, `reserved`, `sold`, `damaged` |
| location_code | text | Warehouse location (A-1-1, etc.) |
| cost_amount | numeric | Cost price |
| currency_code | text | Currency |
| metadata | jsonb | Additional data |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

### `public.customers`
Customer/lead database

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| external_ref | text | External reference (telegram-user:XXX, manychat:XXX) |
| first_name | text | First name |
| last_name | text | Last name |
| phone | text | Phone number |
| email | text | Email |
| notes | text | Notes (tags, lead_score, etc.) |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

### `public.conversations`
Conversation threads

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| customer_id | integer | FK → customers.id |
| channel | text | `telegram`, `whatsapp`, `manychat` |
| channel_thread_key | text | Platform thread ID |
| status | text | `open`, `closed`, `archived` |
| title | text | Conversation title |
| last_message_at | timestamptz | Last message timestamp |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

### `public.messages`
Individual messages

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| conversation_id | integer | FK → conversations.id |
| direction | text | `inbound`, `outbound`, `system` |
| sender_kind | text | `customer`, `agent`, `admin`, `tool` |
| message_type | text | `text`, `audio`, `image`, `video`, `file`, `event` |
| text_body | text | Message text |
| media_url | text | Media file URL |
| transcript | text | Audio transcript |
| payload | jsonb | Full message payload |
| created_at | timestamptz | Created timestamp |

### `public.settings`
App settings

| Column | Type | Description |
|--------|------|-------------|
| key | text | Primary key (e.g., `store`) |
| value | jsonb | Setting value |
| updated_at | timestamptz | Updated timestamp |

### `public.audit_logs`
Audit trail

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| actor_type | text | `customer`, `admin`, `tool` |
| action | text | Action performed |
| entity_type | text | Entity type |
| entity_id | text | Entity ID |
| metadata | jsonb | Action details |
| created_at | timestamptz | Timestamp |

## Relationships

```
products (1) ──< stock_units (N)
customers (1) ──< conversations (N)
conversations (1) ──< messages (N)
```

## Usage Examples

```sql
-- Get all active products with images
SELECT id, sku, brand, model, price_amount, image_url, ram_gb, storage_gb
FROM products WHERE active = true;

-- Get customer conversation history
SELECT m.text_body, m.direction, m.created_at
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
WHERE c.customer_id = 1
ORDER BY m.created_at DESC;

-- Get stock count per product
SELECT p.sku, COUNT(s.id) as units
FROM products p
LEFT JOIN stock_units s ON p.id = s.product_id
GROUP BY p.id, p.sku;
```
