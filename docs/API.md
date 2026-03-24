# API

## Public routes

- GET /health
- POST /webhooks/telegram

### Telegram webhook notes

- POST /webhooks/telegram is for Telegram inbound updates.
- If TELEGRAM_WEBHOOK_SECRET is set, send it in the x-telegram-bot-api-secret-token header.
- The route upserts the Telegram customer and conversation, then stores the inbound message in messages.
- If TELEGRAM_ALLOWED_CHAT_IDS is set, only those chats or users are accepted.

## Protected routes

All protected endpoints require an Authorization bearer token.

Optional audit headers:
- x-actor-type
- x-actor-id

### Read

- GET /v1/dashboard
- GET /v1/products
- GET /v1/stock
- GET /v1/customers
- GET /v1/conversations
- GET /v1/conversations/:conversationId/messages
- GET /v1/orders
- GET /v1/orders/:orderId/items
- GET /v1/settings/:key

### Write

- POST /v1/products
- PATCH /v1/products/:productId
- POST /v1/stock
- PATCH /v1/stock/:stockUnitId
- POST /v1/customers/upsert
- POST /v1/conversations/upsert
- POST /v1/messages
- POST /v1/orders
- PATCH /v1/orders/:orderId
- PUT /v1/settings/:key
