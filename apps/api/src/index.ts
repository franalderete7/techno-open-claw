import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { stat } from "node:fs/promises";
import type { PoolClient } from "pg";
import { z } from "zod";
import { config } from "./config.js";
import { pool, query } from "./db.js";
import { requireBearerToken } from "./auth.js";
import { inferMediaContentType, openMediaStream, resolveMediaFilePath } from "./media-storage.js";
import {
  createStorefrontPaymentIntent,
  handleGalioPayWebhook,
  resolveStorefrontCheckoutHandoff,
} from "./storefront-checkouts.js";
import { calculateDerivedPricing, shouldRecalculatePricing } from "./pricing.js";
import { handleTelegramWebhook } from "./telegram-webhook.js";
import { n8nCompatRoutes } from "./routes/n8n-compat.js";
import { telegramOperatorApiRoutes } from "./routes/telegram-operator-api.js";
import {
  buildTelegramWebhookTargetUrl,
  deleteTelegramWebhook,
  getTelegramBotProfile,
  getTelegramWebhookInfo,
  setTelegramWebhook,
} from "./telegram.js";
import {
  createInventoryPurchase,
  inventoryPurchaseFunderValues,
  getInventoryPurchaseDetail,
  inventoryPurchaseStatusValues,
  listInventoryPurchases,
  updateInventoryPurchase,
} from "./inventory-purchases.js";

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
const inventoryFunderNameSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(inventoryPurchaseFunderValues)
);

const jsonValueSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

function listLimitSchema(defaultLimit = 50, maxLimit = 200) {
  return z.coerce
    .number()
    .int()
    .positive()
    .default(defaultLimit)
    .transform((value) => Math.min(value, maxLimit));
}

app.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      error: "validation_error",
      issues: error.issues,
    });
  }

  request.log.error(error);
  return reply.status(500).send({
    error: "internal_server_error",
  });
});

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

app.get("/media/*", async (request, reply) => {
  const wildcardPath = (request.params as { "*": string })["*"] || "";
  const filePath = resolveMediaFilePath(wildcardPath);

  if (!filePath) {
    return reply.code(404).send({ error: "media_not_found" });
  }

  try {
    const file = await stat(filePath);
    if (!file.isFile()) {
      return reply.code(404).send({ error: "media_not_found" });
    }

    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.type(inferMediaContentType(filePath));
    return reply.send(openMediaStream(filePath));
  } catch {
    return reply.code(404).send({ error: "media_not_found" });
  }
});

app.post("/webhooks/telegram", handleTelegramWebhook);
app.post("/webhooks/galiopay", async (request, reply) => {
  const result = await handleGalioPayWebhook(request.body);
  return reply.code(200).send(result);
});

app.register(async (protectedApp) => {
  protectedApp.addHook("preHandler", requireBearerToken);
  protectedApp.register(n8nCompatRoutes, { prefix: "/rest/v1" });
  protectedApp.register(telegramOperatorApiRoutes);

  protectedApp.get("/v1/telegram/status", async () => {
    const targetUrl = config.TELEGRAM_WEBHOOK_BASE_URL
      ? buildTelegramWebhookTargetUrl(config.TELEGRAM_WEBHOOK_BASE_URL)
      : null;

    const status = {
      configured: {
        botToken: Boolean(config.TELEGRAM_BOT_TOKEN),
        webhookBaseUrl: Boolean(config.TELEGRAM_WEBHOOK_BASE_URL),
        webhookSecret: Boolean(config.TELEGRAM_WEBHOOK_SECRET),
        allowedChatIds: config.TELEGRAM_ALLOWED_CHAT_IDS,
      },
      targetUrl,
      bot: null as Awaited<ReturnType<typeof getTelegramBotProfile>> | null,
      webhook: null as Awaited<ReturnType<typeof getTelegramWebhookInfo>> | null,
      botError: null as string | null,
      webhookError: null as string | null,
    };

    if (!config.TELEGRAM_BOT_TOKEN) {
      return status;
    }

    try {
      status.bot = await getTelegramBotProfile(config.TELEGRAM_BOT_TOKEN);
    } catch (error) {
      status.botError = error instanceof Error ? error.message : "Failed to fetch Telegram bot profile";
    }

    try {
      status.webhook = await getTelegramWebhookInfo(config.TELEGRAM_BOT_TOKEN);
    } catch (error) {
      status.webhookError = error instanceof Error ? error.message : "Failed to fetch Telegram webhook info";
    }

    return status;
  });

  protectedApp.post("/v1/telegram/webhook/sync", async (_request, reply) => {
    if (!config.TELEGRAM_BOT_TOKEN) {
      return reply.status(400).send({ error: "missing_telegram_bot_token" });
    }

    if (!config.TELEGRAM_WEBHOOK_BASE_URL) {
      return reply.status(400).send({ error: "missing_telegram_webhook_base_url" });
    }

    const targetUrl = buildTelegramWebhookTargetUrl(config.TELEGRAM_WEBHOOK_BASE_URL);
    await setTelegramWebhook(config.TELEGRAM_BOT_TOKEN, {
      url: targetUrl,
      secretToken: config.TELEGRAM_WEBHOOK_SECRET || undefined,
    });

    const webhook = await getTelegramWebhookInfo(config.TELEGRAM_BOT_TOKEN);

    return {
      ok: true,
      targetUrl,
      webhook,
    };
  });

  protectedApp.post("/v1/telegram/webhook/delete", async (_request, reply) => {
    if (!config.TELEGRAM_BOT_TOKEN) {
      return reply.status(400).send({ error: "missing_telegram_bot_token" });
    }

    await deleteTelegramWebhook(config.TELEGRAM_BOT_TOKEN);
    const webhook = await getTelegramWebhookInfo(config.TELEGRAM_BOT_TOKEN);

    return {
      ok: true,
      webhook,
    };
  });

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
    const [inventoryPurchases] = await query<{ count: string }>("select count(*)::text as count from public.inventory_purchases");

    return {
      products: Number(products?.count ?? 0),
      inStockUnits: Number(stockUnits?.count ?? 0),
      customers: Number(customers?.count ?? 0),
      openConversations: Number(openConversations?.count ?? 0),
      orders: Number(orders?.count ?? 0),
      inventoryPurchases: Number(inventoryPurchases?.count ?? 0),
    };
  });

  protectedApp.post("/v1/storefront/payment-intents", async (request, reply) => {
    const schema = z.object({
      product_id: z.coerce.number().int().positive(),
      source_host: z.string().trim().optional().nullable(),
      source_path: z.string().trim().optional().nullable(),
      channel: z.enum(["storefront", "whatsapp", "telegram", "api"]).default("storefront"),
    });

    const body = schema.parse(request.body);
    const intent = await createStorefrontPaymentIntent({
      productId: body.product_id,
      sourceHost: body.source_host ?? null,
      sourcePath: body.source_path ?? null,
      channel: body.channel,
    });

    await writeAuditLog(pool, request, "storefront.payment_intent.created", "order", String(intent.order_id), {
      channel: body.channel,
      source_host: body.source_host ?? null,
    });

    return reply.code(201).send(intent);
  });

  protectedApp.post("/v1/storefront/payment-intents/resolve", async (request, reply) => {
    const schema = z.object({
      order_id: z.coerce.number().int().positive(),
      token: z.string().trim().min(8).max(128),
    });

    const body = schema.parse(request.body);
    const handoff = await resolveStorefrontCheckoutHandoff(body.order_id, body.token.toLowerCase());

    if (!handoff.ok) {
      return reply.code(404).send(handoff);
    }

    return reply.send(handoff);
  });

  protectedApp.get("/v1/schema", async () => {
    const tableRows = await query<{ table_name: string; row_estimate: string }>(
      `
        select
          c.relname as table_name,
          greatest(c.reltuples::bigint, 0)::text as row_estimate
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
        order by c.relname asc
      `
    );

    const columnRows = await query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: "YES" | "NO";
      column_default: string | null;
      ordinal_position: number;
      is_primary_key: boolean;
      constraint_name: string | null;
      foreign_table_name: string | null;
      foreign_column_name: string | null;
      update_rule: string | null;
      delete_rule: string | null;
    }>(
      `
        with primary_keys as (
          select tc.table_name, kcu.column_name
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on tc.constraint_name = kcu.constraint_name
           and tc.table_schema = kcu.table_schema
          where tc.table_schema = 'public'
            and tc.constraint_type = 'PRIMARY KEY'
        ),
        foreign_keys as (
          select
            tc.table_name,
            kcu.column_name,
            tc.constraint_name,
            ccu.table_name as foreign_table_name,
            ccu.column_name as foreign_column_name,
            rc.update_rule,
            rc.delete_rule
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on tc.constraint_name = kcu.constraint_name
           and tc.table_schema = kcu.table_schema
          join information_schema.constraint_column_usage ccu
            on tc.constraint_name = ccu.constraint_name
           and tc.table_schema = ccu.table_schema
          join information_schema.referential_constraints rc
            on tc.constraint_name = rc.constraint_name
           and tc.table_schema = rc.constraint_schema
          where tc.table_schema = 'public'
            and tc.constraint_type = 'FOREIGN KEY'
        )
        select
          c.table_name,
          c.column_name,
          c.data_type,
          c.udt_name,
          c.is_nullable,
          c.column_default,
          c.ordinal_position,
          (pk.column_name is not null) as is_primary_key,
          fk.constraint_name,
          fk.foreign_table_name,
          fk.foreign_column_name,
          fk.update_rule,
          fk.delete_rule
        from information_schema.columns c
        left join primary_keys pk
          on pk.table_name = c.table_name
         and pk.column_name = c.column_name
        left join foreign_keys fk
          on fk.table_name = c.table_name
         and fk.column_name = c.column_name
        where c.table_schema = 'public'
        order by c.table_name asc, c.ordinal_position asc
      `
    );

    const relationshipRows = await query<{
      constraint_name: string;
      source_table: string;
      source_column: string;
      target_table: string;
      target_column: string;
      update_rule: string;
      delete_rule: string;
    }>(
      `
        select
          tc.constraint_name,
          tc.table_name as source_table,
          kcu.column_name as source_column,
          ccu.table_name as target_table,
          ccu.column_name as target_column,
          rc.update_rule,
          rc.delete_rule
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
        join information_schema.constraint_column_usage ccu
          on tc.constraint_name = ccu.constraint_name
         and tc.table_schema = ccu.table_schema
        join information_schema.referential_constraints rc
          on tc.constraint_name = rc.constraint_name
         and tc.table_schema = rc.constraint_schema
        where tc.table_schema = 'public'
          and tc.constraint_type = 'FOREIGN KEY'
        order by tc.table_name asc, kcu.column_name asc
      `
    );

    const rowEstimateByTable = new Map(tableRows.map((row) => [row.table_name, Number(row.row_estimate ?? 0)]));
    const relationships = relationshipRows.map((row) => ({
      constraint_name: row.constraint_name,
      source_table: row.source_table,
      source_column: row.source_column,
      target_table: row.target_table,
      target_column: row.target_column,
      update_rule: row.update_rule,
      delete_rule: row.delete_rule,
    }));

    const relationshipCountByTable = new Map<string, number>();
    for (const relationship of relationships) {
      relationshipCountByTable.set(
        relationship.source_table,
        (relationshipCountByTable.get(relationship.source_table) ?? 0) + 1
      );
      relationshipCountByTable.set(
        relationship.target_table,
        (relationshipCountByTable.get(relationship.target_table) ?? 0) + 1
      );
    }

    const tables = Array.from(
      columnRows.reduce(
        (accumulator, row) => {
          const current =
            accumulator.get(row.table_name) ??
            {
              name: row.table_name,
              row_estimate: rowEstimateByTable.get(row.table_name) ?? 0,
              relationship_count: relationshipCountByTable.get(row.table_name) ?? 0,
              columns: [],
            };

          current.columns.push({
            name: row.column_name,
            data_type:
              row.data_type === "USER-DEFINED"
                ? row.udt_name
                : row.data_type === "ARRAY"
                  ? `${row.udt_name.replace(/^_/, "")}[]`
                  : row.data_type,
            is_nullable: row.is_nullable === "YES",
            default_value: row.column_default,
            is_primary_key: row.is_primary_key,
            references: row.constraint_name
              ? {
                  constraint_name: row.constraint_name,
                  table: row.foreign_table_name,
                  column: row.foreign_column_name,
                  update_rule: row.update_rule,
                  delete_rule: row.delete_rule,
                }
              : null,
          });

          accumulator.set(row.table_name, current);
          return accumulator;
        },
        new Map<
          string,
          {
            name: string;
            row_estimate: number;
            relationship_count: number;
            columns: Array<{
              name: string;
              data_type: string;
              is_nullable: boolean;
              default_value: string | null;
              is_primary_key: boolean;
              references: {
                constraint_name: string | null;
                table: string | null;
                column: string | null;
                update_rule: string | null;
                delete_rule: string | null;
              } | null;
            }>;
          }
        >()
      ).values()
    );

    return { tables, relationships };
  });

  protectedApp.get("/v1/products", async (request) => {
    const schema = z.object({
      q: z.string().trim().optional(),
      active: z
        .enum(["true", "false"])
        .optional()
        .transform((value) => (value == null ? null : value === "true")),
      limit: listLimitSchema(),
    });
    const params = schema.parse(request.query);

    const values: unknown[] = [];
    const where: string[] = [];

    if (params.q) {
      values.push(`%${params.q}%`);
      where.push(
        `(p.title ilike $${values.length} or p.sku ilike $${values.length} or p.brand ilike $${values.length} or p.model ilike $${values.length})`
      );
    }

    if (params.active != null) {
      values.push(params.active);
      where.push(`p.active = $${values.length}`);
    }

    values.push(params.limit);

    const rows = await query(
      `
        select
          p.id,
          p.legacy_source_id,
          p.sku,
          p.slug,
          p.brand,
          p.model,
          p.title,
          p.description,
          p.condition,
          p.price_amount,
          p.currency_code,
          p.active,
          p.created_at,
          p.updated_at,
          p.category,
          p.cost_usd,
          p.logistics_usd,
          p.total_cost_usd,
          p.margin_pct,
          p.price_usd,
          p.promo_price_ars,
          p.bancarizada_total,
          p.bancarizada_cuota,
          p.bancarizada_interest,
          p.macro_total,
          p.macro_cuota,
          p.macro_interest,
          p.cuotas_qty,
          (coalesce(inv.in_stock_units, 0) > 0 or p.in_stock) as in_stock,
          p.delivery_type,
          p.delivery_days,
          p.usd_rate,
          p.ram_gb,
          p.storage_gb,
          p.network,
          p.image_url,
          p.color,
          p.battery_health,
          coalesce(inv.total_units, 0) as stock_units_total,
          coalesce(inv.in_stock_units, 0) as stock_units_available,
          coalesce(inv.reserved_units, 0) as stock_units_reserved,
          coalesce(inv.sold_units, 0) as stock_units_sold
        from public.products p
        left join lateral (
          select
            count(*)::int as total_units,
            count(*) filter (where status = 'in_stock')::int as in_stock_units,
            count(*) filter (where status = 'reserved')::int as reserved_units,
            count(*) filter (where status = 'sold')::int as sold_units
          from public.stock_units su
          where su.product_id = p.id
        ) inv on true
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        order by p.updated_at desc, p.id desc
        limit $${values.length}
      `,
      values
    );

    return { items: rows };
  });

  protectedApp.post("/v1/products", async (request, reply) => {
    const schema = z.object({
      legacy_source_id: z.coerce.number().int().positive().optional().nullable(),
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
      category: z.string().trim().optional().nullable(),
      cost_usd: z.coerce.number().finite().nonnegative().optional().nullable(),
      logistics_usd: z.coerce.number().finite().nonnegative().optional().nullable(),
      total_cost_usd: z.coerce.number().finite().nonnegative().optional().nullable(),
      margin_pct: z.coerce.number().finite().optional().nullable(),
      price_usd: z.coerce.number().finite().nonnegative().optional().nullable(),
      promo_price_ars: z.coerce.number().finite().nonnegative().optional().nullable(),
      bancarizada_total: z.coerce.number().finite().nonnegative().optional().nullable(),
      bancarizada_cuota: z.coerce.number().finite().nonnegative().optional().nullable(),
      bancarizada_interest: z.coerce.number().finite().optional().nullable(),
      macro_total: z.coerce.number().finite().nonnegative().optional().nullable(),
      macro_cuota: z.coerce.number().finite().nonnegative().optional().nullable(),
      macro_interest: z.coerce.number().finite().optional().nullable(),
      cuotas_qty: z.coerce.number().int().nonnegative().optional().nullable(),
      in_stock: z.boolean().optional().default(false),
      delivery_type: z.string().trim().optional().nullable(),
      delivery_days: z.coerce.number().int().nonnegative().optional().nullable(),
      usd_rate: z.coerce.number().finite().nonnegative().optional().nullable(),
      image_url: z.string().trim().url().optional().nullable().or(z.literal("")),
      ram_gb: z.coerce.number().int().nonnegative().optional().nullable(),
      storage_gb: z.coerce.number().int().nonnegative().optional().nullable(),
      network: z.string().trim().optional().nullable(),
      color: z.string().trim().optional().nullable(),
      battery_health: z.coerce.number().int().min(0).max(100).optional().nullable(),
    });
    const body = schema.parse(request.body);
    if (body.image_url === "") {
      body.image_url = null;
    }

    if (
      body.cost_usd !== undefined ||
      body.logistics_usd !== undefined ||
      body.usd_rate !== undefined ||
      body.cuotas_qty !== undefined
    ) {
      Object.assign(body, await calculateDerivedPricing(body, pool));
    }

    const slug = body.slug || slugify(`${body.brand}-${body.model}-${body.title}`);

    const rows = await query(
      `
        insert into public.products (
          legacy_source_id,
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
          image_url,
          ram_gb,
          storage_gb,
          network,
          color,
          battery_health
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35
        )
        returning *
      `,
      [
        body.legacy_source_id ?? null,
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
        body.category ?? null,
        body.cost_usd ?? null,
        body.logistics_usd ?? null,
        body.total_cost_usd ?? null,
        body.margin_pct ?? null,
        body.price_usd ?? null,
        body.promo_price_ars ?? null,
        body.bancarizada_total ?? null,
        body.bancarizada_cuota ?? null,
        body.bancarizada_interest ?? null,
        body.macro_total ?? null,
        body.macro_cuota ?? null,
        body.macro_interest ?? null,
        body.cuotas_qty ?? null,
        body.in_stock,
        body.delivery_type ?? null,
        body.delivery_days ?? null,
        body.usd_rate ?? null,
        body.image_url || null,
        body.ram_gb ?? null,
        body.storage_gb ?? null,
        body.network ?? null,
        body.color ?? null,
        body.battery_health ?? null,
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
      legacy_source_id: z.coerce.number().int().positive().nullable().optional(),
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
      category: z.string().trim().nullable().optional(),
      cost_usd: z.coerce.number().finite().nonnegative().nullable().optional(),
      logistics_usd: z.coerce.number().finite().nonnegative().nullable().optional(),
      total_cost_usd: z.coerce.number().finite().nonnegative().nullable().optional(),
      margin_pct: z.coerce.number().finite().nullable().optional(),
      price_usd: z.coerce.number().finite().nonnegative().nullable().optional(),
      promo_price_ars: z.coerce.number().finite().nonnegative().nullable().optional(),
      bancarizada_total: z.coerce.number().finite().nonnegative().nullable().optional(),
      bancarizada_cuota: z.coerce.number().finite().nonnegative().nullable().optional(),
      bancarizada_interest: z.coerce.number().finite().nullable().optional(),
      macro_total: z.coerce.number().finite().nonnegative().nullable().optional(),
      macro_cuota: z.coerce.number().finite().nonnegative().nullable().optional(),
      macro_interest: z.coerce.number().finite().nullable().optional(),
      cuotas_qty: z.coerce.number().int().nonnegative().nullable().optional(),
      in_stock: z.boolean().optional(),
      delivery_type: z.string().trim().nullable().optional(),
      delivery_days: z.coerce.number().int().nonnegative().nullable().optional(),
      usd_rate: z.coerce.number().finite().nonnegative().nullable().optional(),
      image_url: z.string().trim().url().nullable().optional().or(z.literal("")),
      ram_gb: z.coerce.number().int().nonnegative().nullable().optional(),
      storage_gb: z.coerce.number().int().nonnegative().nullable().optional(),
      network: z.string().trim().nullable().optional(),
      color: z.string().trim().nullable().optional(),
      battery_health: z.coerce.number().int().min(0).max(100).nullable().optional(),
    });

    const { productId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    if (body.image_url === "") {
      body.image_url = null;
    }

    if (shouldRecalculatePricing(body)) {
      const existingRows = await query<{
        id: number;
        cost_usd: number | string | null;
        logistics_usd: number | string | null;
        usd_rate: number | string | null;
        cuotas_qty: number | string | null;
      }>(
        `
          select id, cost_usd, logistics_usd, usd_rate, cuotas_qty
          from public.products
          where id = $1
          limit 1
        `,
        [productId]
      );

      const existing = existingRows[0];
      if (!existing) {
        return reply.code(404).send({ error: "Product not found." });
      }

      Object.assign(
        body,
        await calculateDerivedPricing(
          {
            cost_usd: body.cost_usd ?? existing.cost_usd ?? null,
            logistics_usd: body.logistics_usd ?? existing.logistics_usd ?? null,
            usd_rate: body.usd_rate ?? existing.usd_rate ?? null,
            cuotas_qty: body.cuotas_qty ?? existing.cuotas_qty ?? null,
          },
          pool
        )
      );
    }

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
      limit: listLimitSchema(),
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
          su.imei_1,
          su.imei_2,
          su.inventory_purchase_id,
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
      imei_1: z.string().trim().optional().nullable(),
      imei_2: z.string().trim().optional().nullable(),
      inventory_purchase_id: z.coerce.number().int().positive(),
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
          imei_1,
          imei_2,
          inventory_purchase_id,
          color,
          battery_health,
          status,
          location_code,
          cost_amount,
          currency_code,
          acquired_at,
          metadata
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        returning *
      `,
      [
        body.product_id,
        body.serial_number ?? null,
        body.imei_1 ?? null,
        body.imei_2 ?? null,
        body.inventory_purchase_id ?? null,
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
      imei_1: z.string().trim().nullable().optional(),
      imei_2: z.string().trim().nullable().optional(),
      inventory_purchase_id: z.coerce.number().int().positive().optional(),
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

  protectedApp.get("/v1/inventory-purchases", async (request) => {
    const schema = z.object({
      q: z.string().trim().optional(),
      status: z.enum(inventoryPurchaseStatusValues).optional(),
      limit: listLimitSchema(),
    });
    const params = schema.parse(request.query);

    const items = await listInventoryPurchases(pool, {
      query: params.q,
      status: params.status,
      limit: params.limit,
    });

    return { items };
  });

  protectedApp.get("/v1/inventory-purchases/:purchaseId", async (request, reply) => {
    const schema = z.object({
      purchaseId: z.coerce.number().int().positive(),
    });
    const { purchaseId } = schema.parse(request.params);
    const item = await getInventoryPurchaseDetail(pool, purchaseId);

    if (!item) {
      return reply.code(404).send({ error: "Inventory purchase not found." });
    }

    return item;
  });

  protectedApp.post("/v1/inventory-purchases", async (request, reply) => {
    const funderSchema = z.object({
      funder_name: inventoryFunderNameSchema,
      payment_method: z.string().trim().nullable().optional(),
      amount_amount: z.coerce.number().finite().nonnegative().nullable().optional(),
      currency_code: z.string().trim().min(1).nullable().optional(),
      share_pct: z.coerce.number().finite().nonnegative().nullable().optional(),
      notes: z.string().trim().nullable().optional(),
    });
    const schema = z.object({
      supplier_name: z.string().trim().nullable().optional(),
      currency_code: z.string().trim().min(1).optional(),
      total_amount: z.coerce.number().finite().nonnegative().nullable().optional(),
      status: z.enum(inventoryPurchaseStatusValues).optional(),
      acquired_at: z.string().datetime().nullable().optional(),
      notes: z.string().trim().nullable().optional(),
      metadata: z.record(z.string(), jsonValueSchema).optional(),
      funders: z.array(funderSchema).optional(),
    });
    const body = schema.parse(request.body);
    const purchase = await createInventoryPurchase(pool, body);

    if (!purchase) {
      return reply.code(500).send({ error: "Failed to create inventory purchase." });
    }

    await writeAuditLog(pool, request, "inventory_purchase.created", "inventory_purchase", String(purchase.id), body);
    return reply.code(201).send(purchase);
  });

  protectedApp.patch("/v1/inventory-purchases/:purchaseId", async (request, reply) => {
    const paramsSchema = z.object({
      purchaseId: z.coerce.number().int().positive(),
    });
    const funderSchema = z.object({
      funder_name: inventoryFunderNameSchema,
      payment_method: z.string().trim().nullable().optional(),
      amount_amount: z.coerce.number().finite().nonnegative().nullable().optional(),
      currency_code: z.string().trim().min(1).nullable().optional(),
      share_pct: z.coerce.number().finite().nonnegative().nullable().optional(),
      notes: z.string().trim().nullable().optional(),
    });
    const bodySchema = z.object({
      supplier_name: z.string().trim().nullable().optional(),
      currency_code: z.string().trim().min(1).optional(),
      total_amount: z.coerce.number().finite().nonnegative().nullable().optional(),
      status: z.enum(inventoryPurchaseStatusValues).optional(),
      acquired_at: z.string().datetime().nullable().optional(),
      notes: z.string().trim().nullable().optional(),
      metadata: z.record(z.string(), jsonValueSchema).optional(),
      funders: z.array(funderSchema).optional(),
    });

    const { purchaseId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    const purchase = await updateInventoryPurchase(pool, purchaseId, body);

    if (!purchase) {
      return reply.code(404).send({ error: "Inventory purchase not found." });
    }

    await writeAuditLog(pool, request, "inventory_purchase.updated", "inventory_purchase", String(purchase.id), body);
    return purchase;
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
      limit: listLimitSchema(),
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
      limit: listLimitSchema(),
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

  protectedApp.get("/v1/audit", async (request) => {
    const schema = z.object({
      limit: listLimitSchema(100, 200),
      actor_type: z.string().trim().optional(),
      entity_type: z.string().trim().optional(),
    });
    const params = schema.parse(request.query);

    const values: unknown[] = [];
    const where: string[] = [];

    if (params.actor_type) {
      values.push(params.actor_type);
      where.push(`actor_type = $${values.length}`);
    }

    if (params.entity_type) {
      values.push(params.entity_type);
      where.push(`entity_type = $${values.length}`);
    }

    values.push(params.limit);

    const rows = await query(
      `
        select
          id,
          actor_type,
          actor_id,
          action,
          entity_type,
          entity_id,
          metadata,
          created_at
        from public.audit_logs
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        order by created_at desc, id desc
        limit $${values.length}
      `,
      values
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
      limit: listLimitSchema(),
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
          coalesce(c.phone, sci.customer_phone) as phone,
          coalesce(
            nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
            sci.customer_name
          ) as customer_name
        from public.orders o
        left join public.customers c on c.id = o.customer_id
        left join lateral (
          select customer_phone, customer_name
          from public.storefront_checkout_intents
          where order_id = o.id
          order by created_at desc, id desc
          limit 1
        ) sci on true
        order by o.created_at desc, o.id desc
        limit $1
      `,
      [params.limit]
    );

    return { items: rows };
  });

  protectedApp.get("/v1/orders/:orderId", async (request, reply) => {
    const schema = z.object({
      orderId: z.coerce.number().int().positive(),
    });
    const { orderId } = schema.parse(request.params);

    const orderRows = await query(
      `
        select
          o.id,
          o.order_number,
          o.customer_id,
          o.source,
          o.status,
          o.currency_code,
          o.subtotal_amount,
          o.total_amount,
          o.notes,
          o.created_at,
          o.updated_at,
          c.first_name,
          c.last_name,
          coalesce(c.phone, sci.customer_phone) as phone,
          c.email,
          coalesce(
            nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
            sci.customer_name
          ) as customer_name
        from public.orders o
        left join public.customers c on c.id = o.customer_id
        left join lateral (
          select customer_phone, customer_name
          from public.storefront_checkout_intents
          where order_id = o.id
          order by created_at desc, id desc
          limit 1
        ) sci on true
        where o.id = $1
        limit 1
      `,
      [orderId]
    );

    const order = orderRows[0];

    if (!order) {
      return reply.code(404).send({ error: "Order not found." });
    }

    const [items, checkoutIntents, audit] = await Promise.all([
      query(
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
            p.slug,
            p.brand,
            p.model,
            p.title as product_title,
            su.serial_number,
            su.imei_1,
            su.imei_2,
            su.status as stock_status,
            su.location_code
          from public.order_items oi
          left join public.products p on p.id = oi.product_id
          left join public.stock_units su on su.id = oi.stock_unit_id
          where oi.order_id = $1
          order by oi.id asc
        `,
        [orderId]
      ),
      query(
        `
          select
            sci.id,
            sci.order_id,
            sci.product_id,
            sci.token,
            sci.channel,
            sci.source_host,
            sci.status,
            sci.customer_phone,
            sci.customer_name,
            sci.title_snapshot,
            sci.unit_price_amount,
            sci.currency_code,
            sci.image_url_snapshot,
            sci.delivery_days_snapshot,
            sci.galio_reference_id,
            sci.galio_payment_url,
            sci.galio_proof_token,
            sci.galio_payment_id,
            sci.galio_payment_status,
            sci.metadata,
            sci.paid_at,
            sci.expires_at,
            sci.created_at,
            sci.updated_at,
            p.sku,
            p.slug,
            p.brand,
            p.model
          from public.storefront_checkout_intents sci
          left join public.products p on p.id = sci.product_id
          where sci.order_id = $1
          order by sci.created_at desc, sci.id desc
        `,
        [orderId]
      ),
      query(
        `
          select
            id,
            actor_type,
            actor_id,
            action,
            metadata,
            created_at
          from public.audit_logs
          where entity_type = 'order'
            and entity_id = $1
          order by created_at desc, id desc
          limit 50
        `,
        [String(orderId)]
      ),
    ]);

    return {
      order,
      items,
      checkout_intents: checkoutIntents,
      audit,
    };
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

    const rows = await query(`select key, value, description, updated_at from public.settings where key = $1`, [key]);
    const setting = rows[0];

    if (!setting) {
      return reply.code(404).send({ error: "Setting not found." });
    }

    return setting;
  });

  protectedApp.get("/v1/settings", async () => {
    const rows = await query(
      `
        select
          key,
          value,
          description,
          updated_at
        from public.settings
        order by key asc
      `
    );

    return { items: rows };
  });

  protectedApp.put("/v1/settings/:key", async (request) => {
    const paramsSchema = z.object({
      key: z.string().trim().min(1),
    });
    const bodySchema = z.object({
      value: jsonValueSchema,
      description: z.string().trim().nullable().optional(),
    });

    const { key } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);

    const rows = await query(
      `
        insert into public.settings (key, value, description)
        values ($1, $2::jsonb, $3)
        on conflict (key)
        do update set
          value = excluded.value,
          description = excluded.description,
          updated_at = now()
        returning key, value, description, updated_at
      `,
      [key, JSON.stringify(body.value), body.description ?? null]
    );

    await writeAuditLog(pool, request, "setting.updated", "setting", key, {
      value: body.value,
      description: body.description ?? null,
    });
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
