# Operator Playbook

This repo is designed so an operator agent can manage the business through Telegram and shell access without hand-writing raw API requests every time.

## Environment assumptions

- `.env` exists in the repo root
- `API_BEARER_TOKEN` is set
- API is reachable on `http://127.0.0.1:4000`

All helper scripts load `.env` automatically.

## Health

```bash
./scripts/api/health.sh
```

## Products

List products:

```bash
./scripts/api/products-list.sh
./scripts/api/products-list.sh "iphone 15"
```

Create a product from JSON:

```bash
cat >/tmp/product.json <<'JSON'
{
  "sku": "iphone-15-128-black-new",
  "brand": "Apple",
  "model": "iPhone 15",
  "title": "iPhone 15 128 Black",
  "condition": "new",
  "price_amount": 1121280,
  "currency_code": "ARS",
  "active": true
}
JSON
./scripts/api/product-create.sh /tmp/product.json
```

Update a product:

```bash
cat >/tmp/product-update.json <<'JSON'
{
  "price_amount": 1099000,
  "active": true
}
JSON
./scripts/api/product-update.sh 1 /tmp/product-update.json
```

## Stock

List stock:

```bash
./scripts/api/stock-list.sh
```

Create stock unit:

```bash
cat >/tmp/stock.json <<'JSON'
{
  "product_id": 1,
  "serial_number": "SN-001",
  "color": "Black",
  "status": "in_stock"
}
JSON
./scripts/api/stock-create.sh /tmp/stock.json
```

Update stock unit:

```bash
cat >/tmp/stock-update.json <<'JSON'
{
  "status": "reserved",
  "battery_health": 92
}
JSON
./scripts/api/stock-update.sh 1 /tmp/stock-update.json
```

## Orders

List orders:

```bash
./scripts/api/orders-list.sh
```

Create order:

```bash
cat >/tmp/order.json <<'JSON'
{
  "customer_id": 1,
  "source": "telegram",
  "status": "pending",
  "currency_code": "ARS",
  "subtotal_amount": 1121280,
  "total_amount": 1121280,
  "notes": "Created by operator",
  "items": [
    {
      "product_id": 1,
      "stock_unit_id": 1,
      "title_snapshot": "iPhone 15 128 Black",
      "quantity": 1,
      "unit_price_amount": 1121280,
      "currency_code": "ARS"
    }
  ]
}
JSON
./scripts/api/order-create.sh /tmp/order.json
```

## Conversations

List conversations:

```bash
./scripts/api/conversations-list.sh
```

Create a message in a conversation:

```bash
cat >/tmp/message.json <<'JSON'
{
  "conversation_id": 1,
  "direction": "outbound",
  "sender_kind": "agent",
  "message_type": "text",
  "text_body": "Hola, tengo disponible el equipo."
}
JSON
./scripts/api/message-create.sh /tmp/message.json
```

## Operator workflow

Recommended pattern for the agent:

1. Inspect existing records with the list scripts.
2. Write a small JSON payload to `/tmp/...json`.
3. Apply the change with the create or update script.
4. Verify the result by listing again.

This is intentionally simple and auditable.
