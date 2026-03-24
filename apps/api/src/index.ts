import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { config } from "./config.js";
import { pool, query } from "./db.js";
import { requireBearerToken } from "./auth.js";
import { handleTelegramWebhook } from "./telegram-webhook.js";
import { handleManyChatWebhook } from "./manychat-webhook.js";

const app = Fastify({
  logger: true,
});

const productConditionValues = ["new", "used", "like_new", "refurbished"] as const;
const stockStatusValues = ["in_stock", "reserved", "sold", "damaged"] as const;
const conversationStatusValues = ["open", "closed", "archived"] as const;
const messageDirectionValues = ["inbound", "outbound", "system"] as const;
const senderKindValues = ["customer", "agent", "admin", "tool", "system"] as const;
const messageTypeValues = ["text", "audio", "image", "video", "file", "event"] as const;
const orderStatusValues = ["draft", "pending", "paid", "cancelled", "fulfilled"] as const;
const orderSourceValues = ["manual", "telegram", "whatsapp", "web", "api"] as const;
const actorTypeValues = ["system", "agent", "admin", "customer", "tool"] as const;

const jsonValueSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

function slugify(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || `item-${Date.now()}`;
}

function buildUpdateClause(payload: Record<string, unknown>, startIndex = 1) {
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    return null;
  }

  return {
    sql: entries.map(([key], index) => `${key} = $${startIndex + index}`).join(", "),
    values: entries.map(([, value]) => value),
  };
}

function getActorContext(request: FastifyRequest) {
  const rawActorType = request.headers["x-actor-type"];
  const rawActorId = request.headers["x-actor-id"];
  const parsedActorType =
    typeof rawActorType === "string" && actorTypeValues.includes(rawActorType as (typeof actorTypeValues)[number])
      ? (rawActorType as (typeof actorTypeValues)[number])
      : "admin";

  return {
    actorType: parsedActorType,
    actorId: typeof rawActorId === "string" && rawActorId.trim() ? rawActorId.trim() : null,
  };
}

async function writeAuditLog(
  executor: Pick<PoolClient, "query"> | typeof pool,
  request: FastifyRequest,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {}
) {
  const actor = getActorContext(request);

  await executor.query(
    `
      insert into public.audit_logs (
        actor_type,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
      ) values ($1, $2, $3, $4, $5, $6)
    `,
    [actor.actorType, actor.actorId, action, entityType, entityId, metadata]
  );
}

async function syncOrderStockUnits(client: PoolClient, orderId: number, status: (typeof orderStatusValues)[number]) {
  const rows = await client.query<{ stock_unit_id: number | null }>(
    `
      select stock_unit_id
      from public.order_items
      where order_id = $1
        and stock_unit_id is not null
    `,
    [orderId]
  );

  const stockUnitIds = rows.rows
    .map((row) => row.stock_unit_id)
    .filter((value): value is number => value != null);

  if (stockUnitIds.length === 0) {
    return;
  }

  let stockStatus: (typeof stockStatusValues)[number] = "in_stock";

  if (status === "pending") {
    stockStatus = "reserved";
  } else if (status === "paid" || status === "fulfilled") {
    stockStatus = "sold";
  }

  const soldAtValue = stockStatus === "sold" ? "now()" : "null";

  await client.query(
    `
      update public.stock_units
      set
        status = $1,
        sold_at = ${soldAtValue},
        updated_at = now()
      where id = any($2::bigint[])
    `,
    [stockStatus, stockUnitIds]
  );
}

app.get("/health", async () => {
  const now = await query<{ now: string }>("select now()::text as now");

  return {
    ok: true,
    service: "techno-open-claw-api",
    databaseTime: now[0]?.now ?? null,
  };
});

app.post("/webhooks/telegram", handleTelegramWebhook);
app.post("/webhooks/manychat", handleManyChatWebhook);

app.register(async (protectedApp) => {
  protectedApp.addHook("preHandler", requireBearerToken);

  protectedApp.get("/v1/dashboard", async () => {
    const [products] = await query<{ count: string }>("select count(*)::text as count from public.products");
    const [stockUnits] = await query<{ count: string }>(
      "select count(*)::text as count from public.stock_units where status = 'in_stock'"
    );
    const [customers] = await query<{ count: string }>("select count(*)::text as count from public.customers");
    const [openConversations] = await query<{ count: string }>(
      "select count(*)::text as count from public.conversations where status = 'open'"
    );
    const [orders] = await query<{ count: string }>("select count(*)::text as count from public.orders");

    return {
      products: Number(products?.count ?? 0),
      inStockUnits: Number(stockUnits?.count ?? 0),
      customers: Number(customers?.count ?? 0),
      openConversations: Number(openConversations?.count ?? 0),
      orders: Number(orders?.count ?? 0),
    };
  });

  protectedApp.get("/v1/products", async (request) => {
    const schema = z.object({
      q: z.string().trim().optional(),
      active: z
        .enum(["true", "false"])
        .optional()
        .transform((value) => (value == null ? null : value === "true")),
      limit: z.coerce.number().int().positive().max(100).default(50),
    });
    const params = schema.parse(request.query);

    const values: unknown[] = [];
    const where: string[] = [];

    if (params.q) {
      values.push(`%${params.q}%`);
      where.push(
        `(title ilike $${values.length} or sku ilike $${values.length} or brand ilike $${values.length} or model ilike $${values.length})`
      );
    }

    if (params.active != null) {
      values.push(params.active);
      where.push(`active = $${values.length}`);
    }

    values.push(params.limit);

    const rows = await query(
      `
        select
          id,
          sku,
          slug,
          brand,
          model,
          title,
          description,
          condition,
          price_amount,
          currency_code,
          active,
          created_at,
          updated_at,
          category,
          cost_usd,
          logistics_usd,
          total_cost_usd,
          margin_pct,
          price_usd,
          promo_price_ars,
          bancarizada_total,
          bancarizada_cuota,
          bancarizada_interest,
          macro_total,
          macro_cuota,
          macro_interest,
          cuotas_qty,
          in_stock,
          delivery_type,
          delivery_days,
          usd_rate,
          ram_gb,
          storage_gb,
          network,
          image_url,
          color,
          battery_health
        from public.products
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        order by updated_at desc, id desc
        limit $${values.length}
      `,
      values
    );

    return { items: rows };
  });

  protectedApp.post("/v1/products", async (request, reply) => {
    const schema = z.object({
      sku: z.string().trim().min(1),
      slug: z.string().trim().optional(),
      brand: z.string().trim().min(1),
      model: z.string().trim().min(1),
      title: z.string().trim().min(1),
      description: z.string().trim().optional().nullable(),
      condition: z.enum(productConditionValues).default("new"),
      price_amount: z.coerce.number().finite().nonnegative().optional().nullable(),
      currency_code: z.string().trim().min(1).default("ARS"),
      active: z.boolean().default(true),
    });
    const body = schema.parse(request.body);
    const slug = body.slug || slugify(`${body.brand}-${body.model}-${body.title}`);

    const rows = await query(
      `
        insert into public.products (
          sku,
          slug,
          brand,
          model,
          title,
          description,
          condition,
          price_amount,
          currency_code,
          active
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning *
      `,
      [
        body.sku,
        slug,
        body.brand,
        body.model,
        body.title,
        body.description ?? null,
        body.condition,
        body.price_amount ?? null,
        body.currency_code,
        body.active,
      ]
    );

    const product = rows[0];
    await writeAuditLog(pool, request, "product.created", "product", String(product.id), {
      sku: product.sku,
      slug: product.slug,
    });

    return reply.code(201).send(product);
  });

  protectedApp.patch("/v1/products/:productId", async (request, reply) => {
    const paramsSchema = z.object({
      productId: z.coerce.number().int().positive(),
    });
    const bodySchema = z.object({
      sku: z.string().trim().min(1).optional(),
      slug: z.string().trim().min(1).optional(),
      brand: z.string().trim().min(1).optional(),
      model: z.string().trim().min(1).optional(),
      title: z.string().trim().min(1).optional(),
      description: z.string().trim().nullable().optional(),
      condition: z.enum(productConditionValues).optional(),
      price_amount: z.coerce.number().finite().nonnegative().nullable().optional(),
      currency_code: z.string().trim().min(1).optional(),
      active: z.boolean().optional(),
    });

    const { productId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    const update = buildUpdateClause(body);

    if (!update) {
      return reply.code(400).send({ error: "No product fields to update." });
    }

    const rows = await query(
      `
        update public.products
        set ${update.sql}
        where id = $${update.values.length + 1}
        returning *
      `,
      [...update.values, productId]
    );

    const product = rows[0];

    if (!product) {
      return reply.code(404).send({ error: "Product not found." });
    }

    await writeAuditLog(pool, request, "product.updated", "product", String(product.id), body);
    return product;
  });

  protectedApp.get("/v1/stock", async (request) => {
    const schema = z.object({
      status: z.string().trim().optional(),
      limit: z.coerce.number().int().positive().max(100).default(50),
    });
    const params = schema.parse(request.query);

    const values: unknown[] = [];
    let whereSql = "";

    if (params.status) {
      values.push(params.status);
      whereSql = `where su.status = $1`;
    }

    values.push(params.limit);

    const rows = await query(
      `
        select
          su.id,
          su.serial_number,
          su.color,
          su.battery_health,
          su.status,
          su.location_code,
          su.cost_amount,
          su.currency_code,
          su.acquired_at,
          su.sold_at,
          su.metadata,
          su.created_at,
          su.updated_at,
          p.id as product_id,
          p.sku,
          p.brand,
          p.model,
          p.title
        from public.stock_units su
        join public.products p on p.id = su.product_id
        ${whereSql}
        order by su.updated_at desc, su.id desc
        limit $${values.length}
      `,
      values
    );

    return { items: rows };
  });

  protectedApp.post("/v1/stock", async (request, reply) => {
    const schema = z.object({
      product_id: z.coerce.number().int().positive(),
      serial_number: z.string().trim().optional().nullable(),
      color: z.string().trim().optional().nullable(),
      battery_health: z.coerce.number().int().min(0).max(100).optional().nullable(),
      status: z.enum(stockStatusValues).default("in_stock"),
      location_code: z.string().trim().optional().nullable(),
      cost_amount: z.coerce.number().finite().nonnegative().optional().nullable(),
      currency_code: z.string().trim().min(1).default("ARS"),
      acquired_at: z.string().datetime().optional().nullable(),
      metadata: z.record(z.string(), jsonValueSchema).optional().default({}),
    });
    const body = schema.parse(request.body);

    const rows = await query(
      `
        insert into public.stock_units (
          product_id,
          serial_number,
          color,
          battery_health,
          status,
          location_code,
          cost_amount,
          currency_code,
          acquired_at,
          metadata
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning *
      `,
      [
        body.product_id,
        body.serial_number ?? null,
        body.color ?? null,
        body.battery_health ?? null,
        body.status,
        body.location_code ?? null,
        body.cost_amount ?? null,
        body.currency_code,
        body.acquired_at ?? null,
        body.metadata,
      ]
    );

    const stockUnit = rows[0];
    await writeAuditLog(pool, request, "stock.created", "stock_unit", String(stockUnit.id), {
      product_id: stockUnit.product_id,
    });

    return reply.code(201).send(stockUnit);
  });

  protectedApp.patch("/v1/stock/:stockUnitId", async (request, reply) => {
    const paramsSchema = z.object({
      stockUnitId: z.coerce.number().int().positive(),
    });
    const bodySchema = z.object({
      product_id: z.coerce.number().int().positive().optional(),
      serial_number: z.string().trim().nullable().optional(),
      color: z.string().trim().nullable().optional(),
      battery_health: z.coerce.number().int().min(0).max(100).nullable().optional(),
      status: z.enum(stockStatusValues).optional(),
      location_code: z.string().trim().nullable().optional(),
      cost_amount: z.coerce.number().finite().nonnegative().nullable().optional(),
      currency_code: z.string().trim().min(1).optional(),
      acquired_at: z.string().datetime().nullable().optional(),
      sold_at: z.string().datetime().nullable().optional(),
      metadata: z.record(z.string(), jsonValueSchema).optional(),
    });

    const { stockUnitId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    const update = buildUpdateClause(body);

    if (!update) {
      return reply.code(400).send({ error: "No stock fields to update." });
    }

    const rows = await query(
      `
        update public.stock_units
        set ${update.sql}
        where id = $${update.values.length + 1}
        returning *
      `,
      [...update.values, stockUnitId]
    );

    const stockUnit = rows[0];

    if (!stockUnit) {
      return reply.code(404).send({ error: "Stock unit not found." });
    }

    await writeAuditLog(pool, request, "stock.updated", "stock_unit", String(stockUnit.id), body);
    return stockUnit;
  });

  protectedApp.post("/v1/customers/upsert", async (request, reply) => {
    const schema = z.object({
      external_ref: z.string().trim().optional().nullable(),
      first_name: z.string().trim().optional().nullable(),
      last_name: z.string().trim().optional().nullable(),
      phone: z.string().trim().optional().nullable(),
      email: z.string().trim().email().optional().nullable(),
      notes: z.string().trim().optional().nullable(),
    });
    const body = schema.parse(request.body);

    if (!body.external_ref && !body.phone && !body.email) {
      return reply.code(400).send({ error: "Provide external_ref, phone, or email to upsert a customer." });
    }

    let existingRows: Record<string, unknown>[] = [];

    if (body.external_ref) {
      existingRows = await query(`select * from public.customers where external_ref = $1 limit 1`, [body.external_ref]);
    }

    if (existingRows.length === 0 && body.phone) {
      existingRows = await query(`select * from public.customers where phone = $1 limit 1`, [body.phone]);
    }

    if (existingRows.length === 0 && body.email) {
      existingRows = await query(`select * from public.customers where email = $1 limit 1`, [body.email]);
    }

    const existing = existingRows[0] as { id: number } | undefined;

    if (!existing) {
      const createdRows = await query(
        `
          insert into public.customers (
            external_ref,
            first_name,
            last_name,
            phone,
            email,
            notes
          ) values ($1, $2, $3, $4, $5, $6)
          returning *
        `,
        [
          body.external_ref ?? null,
          body.first_name ?? null,
          body.last_name ?? null,
          body.phone ?? null,
          body.email ?? null,
          body.notes ?? null,
        ]
      );

      const customer = createdRows[0];
      await writeAuditLog(pool, request, "customer.created", "customer", String(customer.id), body);
      return reply.code(201).send(customer);
    }

    const update = buildUpdateClause(body);

    if (!update) {
      const currentRows = await query(`select * from public.customers where id = $1`, [existing.id]);
      return currentRows[0] ?? null;
    }

    const updatedRows = await query(
      `
        update public.customers
        set ${update.sql}
        where id = $${update.values.length + 1}
        returning *
      `,
      [...update.values, existing.id]
    );

    const customer = updatedRows[0];
    await writeAuditLog(pool, request, "customer.updated", "customer", String(customer.id), body);
    return customer;
  });

  protectedApp.get("/v1/customers", async (request) => {
    const schema = z.object({
      q: z.string().trim().optional(),
      limit: z.coerce.number().int().positive().max(100).default(50),
    });
    const params = schema.parse(request.query);

    const values: unknown[] = [];
    let whereSql = "";

    if (params.q) {
      values.push(`%${params.q}%`);
      whereSql = `
        where
          coalesce(first_name, '') ilike $1
          or coalesce(last_name, '') ilike $1
          or coalesce(phone, '') ilike $1
          or coalesce(email, '') ilike $1
      `;
    }

    values.push(params.limit);

    const rows = await query(
      `
        select
          id,
          external_ref,
          first_name,
          last_name,
          phone,
          email,
          notes,
          created_at,
          updated_at
        from public.customers
        ${whereSql}
        order by updated_at desc, id desc
        limit $${values.length}
      `,
      values
    );

    return { items: rows };
  });

  protectedApp.post("/v1/conversations/upsert", async (request) => {
    const schema = z.object({
      customer_id: z.coerce.number().int().positive().optional().nullable(),
      channel: z.string().trim().min(1),
      channel_thread_key: z.string().trim().min(1),
      status: z.enum(conversationStatusValues).default("open"),
      title: z.string().trim().optional().nullable(),
      last_message_at: z.string().datetime().optional().nullable(),
    });
    const body = schema.parse(request.body);

    const rows = await query(
      `
        insert into public.conversations (
          customer_id,
          channel,
          channel_thread_key,
          status,
          title,
          last_message_at
        ) values ($1, $2, $3, $4, $5, $6)
        on conflict (channel_thread_key)
        do update set
          customer_id = coalesce(excluded.customer_id, public.conversations.customer_id),
          channel = excluded.channel,
          status = excluded.status,
          title = coalesce(excluded.title, public.conversations.title),
          last_message_at = coalesce(excluded.last_message_at, public.conversations.last_message_at)
        returning *
      `,
      [
        body.customer_id ?? null,
        body.channel,
        body.channel_thread_key,
        body.status,
        body.title ?? null,
        body.last_message_at ?? null,
      ]
    );

    const conversation = rows[0];
    await writeAuditLog(pool, request, "conversation.upserted", "conversation", String(conversation.id), {
      channel: conversation.channel,
      channel_thread_key: conversation.channel_thread_key,
    });

    return conversation;
  });

  protectedApp.get("/v1/conversations", async (request) => {
    const schema = z.object({
      limit: z.coerce.number().int().positive().max(100).default(50),
    });
    const params = schema.parse(request.query);

    const rows = await query(
      `
        select
          c.id,
          c.channel,
          c.channel_thread_key,
          c.status,
          c.last_message_at,
          c.created_at,
          c.updated_at,
          cu.id as customer_id,
          cu.first_name,
          cu.last_name,
          cu.phone
        from public.conversations c
        left join public.customers cu on cu.id = c.customer_id
        order by c.last_message_at desc nulls last, c.id desc
        limit $1
      `,
      [params.limit]
    );

    return { items: rows };
  });

  protectedApp.get("/v1/conversations/:conversationId/messages", async (request) => {
    const schema = z.object({
      conversationId: z.coerce.number().int().positive(),
    });
    const { conversationId } = schema.parse(request.params);

    const rows = await query(
      `
        select
          id,
          direction,
          sender_kind,
          message_type,
          text_body,
          media_url,
          transcript,
          payload,
          created_at
        from public.messages
        where conversation_id = $1
        order by created_at asc, id asc
      `,
      [conversationId]
    );

    return { items: rows };
  });

  protectedApp.post("/v1/messages", async (request, reply) => {
    const schema = z.object({
      conversation_id: z.coerce.number().int().positive(),
      direction: z.enum(messageDirectionValues),
      sender_kind: z.enum(senderKindValues),
      message_type: z.enum(messageTypeValues),
      text_body: z.string().trim().optional().nullable(),
      media_url: z.string().trim().optional().nullable(),
      transcript: z.string().trim().optional().nullable(),
      payload: z.record(z.string(), jsonValueSchema).optional().default({}),
    });
    const body = schema.parse(request.body);

    const rows = await query(
      `
        insert into public.messages (
          conversation_id,
          direction,
          sender_kind,
          message_type,
          text_body,
          media_url,
          transcript,
          payload
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning *
      `,
      [
        body.conversation_id,
        body.direction,
        body.sender_kind,
        body.message_type,
        body.text_body ?? null,
        body.media_url ?? null,
        body.transcript ?? null,
        body.payload,
      ]
    );

    const message = rows[0];

    await query(
      `
        update public.conversations
        set
          last_message_at = $1,
          updated_at = now()
        where id = $2
      `,
      [message.created_at, body.conversation_id]
    );

    await writeAuditLog(pool, request, "message.created", "message", String(message.id), {
      conversation_id: body.conversation_id,
      message_type: body.message_type,
    });

    return reply.code(201).send(message);
  });

  protectedApp.get("/v1/orders", async (request) => {
    const schema = z.object({
      limit: z.coerce.number().int().positive().max(100).default(50),
    });
    const params = schema.parse(request.query);

    const rows = await query(
      `
        select
          o.id,
          o.order_number,
          o.status,
          o.source,
          o.currency_code,
          o.subtotal_amount,
          o.total_amount,
          o.notes,
          o.created_at,
          o.updated_at,
          c.id as customer_id,
          c.first_name,
          c.last_name,
          c.phone
        from public.orders o
        left join public.customers c on c.id = o.customer_id
        order by o.created_at desc, o.id desc
        limit $1
      `,
      [params.limit]
    );

    return { items: rows };
  });

  protectedApp.get("/v1/orders/:orderId/items", async (request) => {
    const schema = z.object({
      orderId: z.coerce.number().int().positive(),
    });
    const { orderId } = schema.parse(request.params);

    const rows = await query(
      `
        select
          oi.id,
          oi.order_id,
          oi.product_id,
          oi.stock_unit_id,
          oi.title_snapshot,
          oi.quantity,
          oi.unit_price_amount,
          oi.currency_code,
          oi.created_at,
          p.sku,
          p.brand,
          p.model,
          su.serial_number
        from public.order_items oi
        left join public.products p on p.id = oi.product_id
        left join public.stock_units su on su.id = oi.stock_unit_id
        where oi.order_id = $1
        order by oi.id asc
      `,
      [orderId]
    );

    return { items: rows };
  });

  protectedApp.post("/v1/orders", async (request, reply) => {
    const itemSchema = z.object({
      product_id: z.coerce.number().int().positive().optional().nullable(),
      stock_unit_id: z.coerce.number().int().positive().optional().nullable(),
      title_snapshot: z.string().trim().min(1),
      quantity: z.coerce.number().int().positive().default(1),
      unit_price_amount: z.coerce.number().finite().nonnegative(),
      currency_code: z.string().trim().min(1).default("ARS"),
    });

    const schema = z.object({
      customer_id: z.coerce.number().int().positive().optional().nullable(),
      source: z.enum(orderSourceValues).default("manual"),
      status: z.enum(orderStatusValues).default("draft"),
      currency_code: z.string().trim().min(1).default("ARS"),
      notes: z.string().trim().optional().nullable(),
      items: z.array(itemSchema).min(1),
    });

    const body = schema.parse(request.body);
    const subtotalAmount = body.items.reduce(
      (total, item) => total + item.quantity * item.unit_price_amount,
      0
    );

    const client = await pool.connect();

    try {
      await client.query("begin");

      const orderResult = await client.query(
        `
          insert into public.orders (
            customer_id,
            source,
            status,
            currency_code,
            subtotal_amount,
            total_amount,
            notes
          ) values ($1, $2, $3, $4, $5, $6, $7)
          returning *
        `,
        [
          body.customer_id ?? null,
          body.source,
          body.status,
          body.currency_code,
          subtotalAmount,
          subtotalAmount,
          body.notes ?? null,
        ]
      );

      const order = orderResult.rows[0] as { id: number };

      for (const item of body.items) {
        await client.query(
          `
            insert into public.order_items (
              order_id,
              product_id,
              stock_unit_id,
              title_snapshot,
              quantity,
              unit_price_amount,
              currency_code
            ) values ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            order.id,
            item.product_id ?? null,
            item.stock_unit_id ?? null,
            item.title_snapshot,
            item.quantity,
            item.unit_price_amount,
            item.currency_code,
          ]
        );
      }

      await syncOrderStockUnits(client, order.id, body.status);
      await writeAuditLog(client, request, "order.created", "order", String(order.id), {
        status: body.status,
        item_count: body.items.length,
      });

      await client.query("commit");

      const rows = await query(`select * from public.orders where id = $1`, [order.id]);
      return reply.code(201).send(rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  protectedApp.patch("/v1/orders/:orderId", async (request, reply) => {
    const paramsSchema = z.object({
      orderId: z.coerce.number().int().positive(),
    });
    const bodySchema = z.object({
      customer_id: z.coerce.number().int().positive().nullable().optional(),
      source: z.enum(orderSourceValues).optional(),
      status: z.enum(orderStatusValues).optional(),
      currency_code: z.string().trim().min(1).optional(),
      notes: z.string().trim().nullable().optional(),
    });

    const { orderId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    const update = buildUpdateClause(body);

    if (!update) {
      return reply.code(400).send({ error: "No order fields to update." });
    }

    const client = await pool.connect();

    try {
      await client.query("begin");

      const result = await client.query(
        `
          update public.orders
          set ${update.sql}
          where id = $${update.values.length + 1}
          returning *
        `,
        [...update.values, orderId]
      );

      const order = result.rows[0] as { id: number; status: (typeof orderStatusValues)[number] } | undefined;

      if (!order) {
        await client.query("rollback");
        return reply.code(404).send({ error: "Order not found." });
      }

      if (body.status) {
        await syncOrderStockUnits(client, order.id, body.status);
      }

      await writeAuditLog(client, request, "order.updated", "order", String(order.id), body);
      await client.query("commit");

      return order;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  protectedApp.get("/v1/settings/:key", async (request, reply) => {
    const schema = z.object({
      key: z.string().trim().min(1),
    });
    const { key } = schema.parse(request.params);

    const rows = await query(`select key, value, updated_at from public.settings where key = $1`, [key]);
    const setting = rows[0];

    if (!setting) {
      return reply.code(404).send({ error: "Setting not found." });
    }

    return setting;
  });

  protectedApp.put("/v1/settings/:key", async (request) => {
    const paramsSchema = z.object({
      key: z.string().trim().min(1),
    });
    const bodySchema = z.object({
      value: z.record(z.string(), jsonValueSchema),
    });

    const { key } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);

    const rows = await query(
      `
        insert into public.settings (key, value)
        values ($1, $2)
        on conflict (key)
        do update set
          value = excluded.value,
          updated_at = now()
        returning key, value, updated_at
      `,
      [key, body.value]
    );

    await writeAuditLog(pool, request, "setting.updated", "setting", key, body.value);
    return rows[0];
  });
});

async function start() {
  try {
    await app.listen({
      host: config.API_HOST,
      port: config.API_PORT,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
