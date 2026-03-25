import { randomUUID } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import { pool, query } from "./db.js";
import { ollamaGenerate } from "./ollama.js";

const exec = promisify(execCallback);

const productConditionValues = ["new", "used", "like_new", "refurbished"] as const;
const stockStatusValues = ["in_stock", "reserved", "sold", "damaged"] as const;

const jsonValueSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

const createProductSchema = z.object({
  sku: z.string().trim().min(1),
  slug: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  model: z.string().trim().optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  condition: z.enum(productConditionValues).optional(),
  price_amount: z.coerce.number().finite().nonnegative().optional().nullable(),
  currency_code: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
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
  in_stock: z.boolean().optional(),
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

const updateProductSchema = z.object({
  product_ref: z.string().trim().min(1),
  changes: createProductSchema
    .omit({ sku: true, slug: true, title: true })
    .extend({
      sku: z.string().trim().min(1).optional(),
      slug: z.string().trim().min(1).optional(),
      title: z.string().trim().min(1).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Provide at least one product field to update."),
});

const deleteProductSchema = z.object({
  product_ref: z.string().trim().min(1),
});

const listProductsSchema = z.object({
  query: z.string().trim().optional(),
});

const listStockSchema = z.object({
  query: z.string().trim().optional(),
  status: z.enum(stockStatusValues).optional(),
});

const createStockSchema = z.object({
  product_ref: z.string().trim().min(1),
  serial_number: z.string().trim().optional().nullable(),
  color: z.string().trim().optional().nullable(),
  battery_health: z.coerce.number().int().min(0).max(100).optional().nullable(),
  status: z.enum(stockStatusValues).optional(),
  location_code: z.string().trim().optional().nullable(),
  cost_amount: z.coerce.number().finite().nonnegative().optional().nullable(),
  currency_code: z.string().trim().min(1).optional(),
  acquired_at: z.string().datetime().optional().nullable(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
});

const updateStockSchema = z.object({
  stock_ref: z.string().trim().min(1),
  changes: z
    .object({
      product_ref: z.string().trim().optional(),
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
    })
    .refine((value) => Object.keys(value).length > 0, "Provide at least one stock field to update."),
});

const listSettingsSchema = z.object({
  query: z.string().trim().optional(),
});

const updateSettingSchema = z.object({
  key: z.string().trim().min(1),
  value: jsonValueSchema,
  description: z.string().trim().nullable().optional(),
});

const deleteSettingSchema = z.object({
  key: z.string().trim().min(1),
});

const listCustomersSchema = z.object({
  query: z.string().trim().optional(),
});

const createCustomerSchema = z
  .object({
    external_ref: z.string().trim().optional().nullable(),
    first_name: z.string().trim().optional().nullable(),
    last_name: z.string().trim().optional().nullable(),
    phone: z.string().trim().optional().nullable(),
    email: z.string().trim().email().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
  })
  .refine((value) => Boolean(value.external_ref || value.phone || value.email), {
    message: "Provide at least one of external_ref, phone, or email.",
  });

const updateCustomerSchema = z.object({
  customer_ref: z.string().trim().min(1),
  changes: z
    .object({
      external_ref: z.string().trim().nullable().optional(),
      first_name: z.string().trim().nullable().optional(),
      last_name: z.string().trim().nullable().optional(),
      phone: z.string().trim().nullable().optional(),
      email: z.string().trim().email().nullable().optional(),
      notes: z.string().trim().nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Provide at least one customer field to update."),
});

const listOrdersSchema = z.object({
  query: z.string().trim().optional(),
});

const listConversationsSchema = z.object({
  query: z.string().trim().optional(),
});

export const draftSchema = z.object({
  mode: z.enum(["read", "write", "clarify", "chat"]),
  command: z
    .enum([
      "help",
      "health_check",
      "list_workflows",
      "list_products",
      "list_stock",
      "list_settings",
      "list_customers",
      "list_orders",
      "list_conversations",
      "create_product",
      "update_product",
      "delete_product",
      "create_stock_unit",
      "update_stock_unit",
      "update_setting",
      "delete_setting",
      "create_customer",
      "update_customer",
    ])
    .optional(),
  params: z.record(z.string(), jsonValueSchema).optional(),
  reply: z.string().optional(),
});

type Draft = z.infer<typeof draftSchema>;

export type ActorContext = {
  actorRef: string;
  chatId: string;
  chatIdNumber: number;
  userId: string | null;
  userMessage: string;
  imageBase64?: string;
  attachedImageUrl?: string;
};

type OperatorTurnStartResult =
  | { kind: "reply"; text: string }
  | {
      kind: "needs_ai";
      snapshot: Awaited<ReturnType<typeof buildOperatorSnapshot>>;
      draftSystemPrompt: string;
      draftPrompt: string;
    };

type PreparedMutation = {
  command: WriteCommandName;
  summary: string;
  payload: Record<string, unknown>;
};

type OperatorMessageResult =
  | { kind: "reply"; text: string }
  | { kind: "chat"; systemPrompt: string; prompt: string };

type ReadCommandName =
  | "help"
  | "health_check"
  | "list_workflows"
  | "list_products"
  | "list_stock"
  | "list_settings"
  | "list_customers"
  | "list_orders"
  | "list_conversations";

type WriteCommandName =
  | "create_product"
  | "update_product"
  | "delete_product"
  | "create_stock_unit"
  | "update_stock_unit"
  | "update_setting"
  | "delete_setting"
  | "create_customer"
  | "update_customer";

type ProductRow = QueryResultRow & {
  id: number;
  sku: string;
  slug: string;
  brand: string;
  model: string;
  title: string;
  active: boolean;
  price_amount: string | number | null;
  promo_price_ars?: string | number | null;
  currency_code: string;
};

type StockRow = QueryResultRow & {
  id: number;
  product_id: number;
  sku: string;
  brand: string;
  model: string;
  title: string;
  serial_number: string | null;
  status: string;
  location_code: string | null;
};

type CustomerRow = QueryResultRow & {
  id: number;
  external_ref: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
};

function asText(value: unknown) {
  if (value == null) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function formatJsonPreview(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function formatMoney(amount: string | number | null, currency = "ARS") {
  if (amount == null) {
    return "-";
  }

  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return String(amount);
  }

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(numeric);
}

function inferBrand(title: string) {
  const normalized = title.trim();
  if (/^iphone\b/i.test(normalized)) return "Apple";
  if (/^samsung\b/i.test(normalized)) return "Samsung";
  if (/^xiaomi\b/i.test(normalized)) return "Xiaomi";
  if (/^redmi\b/i.test(normalized)) return "Redmi";
  if (/^poco\b/i.test(normalized)) return "POCO";

  return normalized.split(/\s+/)[0] || "Unknown";
}

function inferModel(title: string, brand: string) {
  const normalized = title.trim();
  const stripped = normalized.replace(new RegExp(`^${brand}\\s+`, "i"), "").trim();
  return stripped || normalized;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildToken() {
  return randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

function parseControlMessage(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/?(confirm|cancel)\s+([A-Z0-9]{4,12})$/i);

  if (!match) {
    return null;
  }

  return {
    action: match[1].toLowerCase() as "confirm" | "cancel",
    token: match[2].toUpperCase(),
  };
}

async function writeAudit(
  client: Pick<PoolClient, "query">,
  actor: ActorContext,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {}
) {
  await client.query(
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
    ["admin", actor.actorRef, action, entityType, entityId, metadata]
  );
}

async function listN8nWorkflows() {
  try {
    const result = await exec('docker exec n8n-n8n-1 n8n list:workflow 2>&1 | grep -v "Error tracking"');
    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("|"));

    if (lines.length === 0) {
      return "No hay workflows cargados en n8n.";
    }

    const preview = lines.slice(0, 10).map((line) => `• ${line.split("|")[1]?.trim() || line}`);
    return [`n8n workflows (${lines.length})`, ...preview, lines.length > 10 ? `… y ${lines.length - 10} más.` : ""]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "No pude leer los workflows de n8n desde el servidor.";
  }
}

export async function buildOperatorSnapshot() {
  const [products] = await query<{ count: string }>("select count(*)::text as count from public.products where active = true");
  const [stock] = await query<{ count: string }>("select count(*)::text as count from public.stock_units where status = 'in_stock'");
  const [customers] = await query<{ count: string }>("select count(*)::text as count from public.customers");
  const [orders] = await query<{ count: string }>("select count(*)::text as count from public.orders");
  const [conversations] = await query<{ count: string }>(
    "select count(*)::text as count from public.conversations where status = 'open'"
  );
  const recentProducts = await query<{ sku: string; title: string }>(
    `
      select sku, title
      from public.products
      where active = true
      order by updated_at desc, id desc
      limit 6
    `
  );
  const settingKeys = await query<{ key: string }>("select key from public.settings order by key asc limit 20");

  return {
    counts: {
      products: Number(products?.count ?? 0),
      stock: Number(stock?.count ?? 0),
      customers: Number(customers?.count ?? 0),
      orders: Number(orders?.count ?? 0),
      conversations: Number(conversations?.count ?? 0),
    },
    recentProducts: recentProducts.map((item) => `${item.sku}: ${item.title}`),
    settingKeys: settingKeys.map((item) => item.key),
  };
}

async function generateDraft(params: {
  text: string;
  imageBase64?: string;
  attachedImageUrl?: string;
  snapshot: Awaited<ReturnType<typeof buildOperatorSnapshot>>;
}): Promise<Draft> {
  const { systemPrompt, prompt } = buildDraftPrompts(params);
  const raw = await ollamaGenerate({
    format: "json",
    system: systemPrompt,
    prompt,
    images: params.imageBase64 ? [params.imageBase64.split(",").pop() || ""] : undefined,
    options: {
      temperature: 0.1,
      top_p: 0.9,
    },
  });
  const draft = JSON.parse(raw.response || "{}");
  return draftSchema.parse(draft);
}

async function generateChatReply(params: {
  systemPrompt: string;
  prompt: string;
  imageBase64?: string;
}): Promise<string> {
  const raw = await ollamaGenerate({
    system: params.systemPrompt,
    prompt: params.prompt,
    images: params.imageBase64 ? [params.imageBase64.split(",").pop() || ""] : undefined,
    options: {
      temperature: 0.2,
      top_p: 0.9,
    },
  });
  return raw.response.trim();
}

export async function renderOperatorChatReply(params: {
  systemPrompt: string;
  prompt: string;
  imageBase64?: string;
}) {
  return generateChatReply(params);
}

const OPERATOR_SCHEMA_GUIDE = [
  "Operational schema contract:",
  "- public.products stores catalog rows. Stable refs: id, sku, slug. Required for creation: sku and title. Common editable fields: brand, model, title, description, condition, active, price_amount, currency_code, category, cost_usd, logistics_usd, total_cost_usd, margin_pct, price_usd, promo_price_ars, bancarizada_total, bancarizada_cuota, bancarizada_interest, macro_total, macro_cuota, macro_interest, cuotas_qty, in_stock, delivery_type, delivery_days, usd_rate, image_url, ram_gb, storage_gb, network, color, battery_health.",
  "- public.stock_units stores physical inventory. Stable refs: id, serial_number. Required for creation: product_ref. Common editable fields: serial_number, color, battery_health, status, location_code, cost_amount, currency_code, acquired_at, sold_at, metadata.",
  "- public.settings stores key/value configuration. Stable ref: key. update_setting requires key and value. delete_setting removes the key.",
  "- public.customers stores operator and customer contacts. Stable refs: id, external_ref, phone, email. create_customer requires at least one of external_ref, phone, or email.",
  "- public.conversations stores thread headers by channel_thread_key. public.messages stores the actual interaction timeline. Each Telegram inbound and outbound message is saved in public.messages.",
  "- Product images can use public URLs. If the operator attached a Telegram image, the API can persist it on the VPS and provide a /media/... URL for image_url.",
  "- public.operator_confirmations stores pending write actions that require CONFIRM <TOKEN> or CANCEL <TOKEN>.",
  "- public.audit_logs stores executed mutations and important operator actions.",
  "- public.orders and public.order_items store commercial orders. They are readable in the operator chat even if writes are not yet exposed there.",
  "Mutation rules:",
  "- Never invent IDs or hidden fields.",
  "- Use product_ref, stock_ref, customer_ref, and setting key exactly from the operator request until deterministic resolution happens.",
  "- Never claim a row was created, updated, or deleted unless the deterministic command layer executed it.",
].join("\n");

function buildDraftPrompts(params: {
  text: string;
  imageBase64?: string;
  attachedImageUrl?: string;
  snapshot: Awaited<ReturnType<typeof buildOperatorSnapshot>>;
}) {
  const systemPrompt = [
    "You are OpenClaw, the Telegram operator model for TechnoStore Ops.",
    "You know the actual PostgreSQL public schema at the operational level summarized below.",
    OPERATOR_SCHEMA_GUIDE,
    "Convert the operator request into a strict JSON decision for the automation flow.",
    "Return JSON only. No prose. No markdown.",
    "Allowed read commands: help, health_check, list_workflows, list_products, list_stock, list_settings, list_customers, list_orders, list_conversations.",
    "Allowed write commands: create_product, update_product, delete_product, create_stock_unit, update_stock_unit, update_setting, delete_setting, create_customer, update_customer.",
    "If the user is asking a general question or casual operator chat, return mode=chat and include the full operator-facing response in reply.",
    "If information is missing for a mutation, return mode=clarify and put the full clarification question in reply.",
    "Never invent IDs. Keep product_ref, stock_ref, customer_ref and setting keys as plain text from the user's request.",
    "For update commands, only include the fields the user explicitly wants to change.",
    "For delete commands, only use them if the user explicitly asked to delete or remove.",
    "For price and numeric values, use numbers, not strings, when possible.",
    "If the message is just a greeting like hey/hola, reply briefly in reply and use mode=chat.",
  ].join("\n");

  const prompt = [
    "Current app snapshot:",
    JSON.stringify(params.snapshot, null, 2),
    "",
    params.attachedImageUrl
      ? "The operator attached an image with this VPS-hosted URL candidate. Use it as image_url for product create/update unless they explicitly override it."
      : "",
    params.attachedImageUrl ? `attached_image_url: ${params.attachedImageUrl}` : "",
    "",
    "JSON shape:",
    JSON.stringify(
      {
        mode: "read | write | clarify | chat",
        command: "allowed command or omit for chat",
        params: {},
        reply: "required when mode=chat or mode=clarify; omit for read/write",
      },
      null,
      2
    ),
    "",
    `User request: ${params.text}`,
  ].join("\n");

  return { systemPrompt, prompt };
}

async function resolveProduct(productRef: string) {
  const trimmed = productRef.trim();
  const exactId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const rows = await query<ProductRow>(
    `
      select id, sku, slug, brand, model, title, active, price_amount, promo_price_ars, currency_code
      from public.products
      where
        ($1::bigint is not null and id = $1)
        or lower(sku) = lower($2)
        or lower(slug) = lower($2)
        or title ilike $3
        or model ilike $3
        or brand ilike $3
      order by
        case
          when ($1::bigint is not null and id = $1) then 0
          when lower(sku) = lower($2) then 1
          when lower(slug) = lower($2) then 2
          when title ilike $3 then 3
          else 4
        end,
        updated_at desc,
        id desc
      limit 5
    `,
    [exactId, trimmed, `%${trimmed}%`]
  );

  if (rows.length === 0) {
    throw new Error(`No encontré un producto para "${productRef}".`);
  }

  const exactRows = rows.filter(
    (row) => row.id === exactId || row.sku.toLowerCase() === trimmed.toLowerCase() || row.slug.toLowerCase() === trimmed.toLowerCase()
  );

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (rows.length > 1 && exactRows.length !== 1) {
    throw new Error(
      `El producto es ambiguo. Coincidencias: ${rows
        .slice(0, 3)
        .map((row) => `${row.sku} (${row.title})`)
        .join(" | ")}`
    );
  }

  return rows[0];
}

async function resolveStock(stockRef: string) {
  const trimmed = stockRef.trim();
  const exactId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const rows = await query<StockRow>(
    `
      select su.id, su.product_id, su.serial_number, su.status, su.location_code, p.sku, p.brand, p.model, p.title
      from public.stock_units su
      join public.products p on p.id = su.product_id
      where
        ($1::bigint is not null and su.id = $1)
        or coalesce(lower(su.serial_number), '') = lower($2)
        or lower(p.sku) = lower($2)
        or p.title ilike $3
      order by
        case
          when ($1::bigint is not null and su.id = $1) then 0
          when coalesce(lower(su.serial_number), '') = lower($2) then 1
          when lower(p.sku) = lower($2) then 2
          else 3
        end,
        su.updated_at desc,
        su.id desc
      limit 5
    `,
    [exactId, trimmed, `%${trimmed}%`]
  );

  if (rows.length === 0) {
    throw new Error(`No encontré una unidad de stock para "${stockRef}".`);
  }

  const exactRows = rows.filter(
    (row) => row.id === exactId || row.serial_number?.toLowerCase() === trimmed.toLowerCase() || row.sku.toLowerCase() === trimmed.toLowerCase()
  );

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (rows.length > 1) {
    throw new Error(
      `La unidad es ambigua. Coincidencias: ${rows
        .slice(0, 3)
        .map((row) => `#${row.id} ${row.serial_number || row.sku}`)
        .join(" | ")}`
    );
  }

  return rows[0];
}

async function resolveCustomer(customerRef: string) {
  const trimmed = customerRef.trim();
  const exactId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const rows = await query<CustomerRow>(
    `
      select id, external_ref, first_name, last_name, phone, email
      from public.customers
      where
        ($1::bigint is not null and id = $1)
        or coalesce(lower(phone), '') = lower($2)
        or coalesce(lower(email), '') = lower($2)
        or coalesce(lower(external_ref), '') = lower($2)
        or concat_ws(' ', first_name, last_name) ilike $3
      order by
        case
          when ($1::bigint is not null and id = $1) then 0
          when coalesce(lower(phone), '') = lower($2) then 1
          when coalesce(lower(email), '') = lower($2) then 2
          when coalesce(lower(external_ref), '') = lower($2) then 3
          else 4
        end,
        updated_at desc,
        id desc
      limit 5
    `,
    [exactId, trimmed, `%${trimmed}%`]
  );

  if (rows.length === 0) {
    throw new Error(`No encontré un cliente para "${customerRef}".`);
  }

  const exactRows = rows.filter(
    (row) =>
      row.id === exactId ||
      row.phone?.toLowerCase() === trimmed.toLowerCase() ||
      row.email?.toLowerCase() === trimmed.toLowerCase() ||
      row.external_ref?.toLowerCase() === trimmed.toLowerCase()
  );

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (rows.length > 1) {
    throw new Error(
      `El cliente es ambiguo. Coincidencias: ${rows
        .slice(0, 3)
        .map((row) => `#${row.id} ${[row.first_name, row.last_name].filter(Boolean).join(" ") || row.phone || row.email || "sin nombre"}`)
        .join(" | ")}`
    );
  }

  return rows[0];
}

async function resolveSetting(keyRef: string) {
  const trimmed = keyRef.trim();
  const rows = await query<{ key: string; value: unknown; description: string | null }>(
    `
      select key, value, description
      from public.settings
      where lower(key) = lower($1) or key ilike $2
      order by case when lower(key) = lower($1) then 0 else 1 end, key asc
      limit 5
    `,
    [trimmed, `%${trimmed}%`]
  );

  if (rows.length === 0) {
    throw new Error(`No encontré un setting para "${keyRef}".`);
  }

  const exactRows = rows.filter((row) => row.key.toLowerCase() === trimmed.toLowerCase());

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (rows.length > 1) {
    throw new Error(`El setting es ambiguo. Coincidencias: ${rows.slice(0, 5).map((row) => row.key).join(", ")}`);
  }

  return rows[0];
}

async function storeConfirmation(actor: ActorContext, prepared: PreparedMutation) {
  const token = buildToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 20).toISOString();

  await pool.query(
    `
      insert into public.operator_confirmations (
        token,
        channel,
        actor_ref,
        chat_id,
        command,
        summary,
        payload,
        expires_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [token, "telegram", actor.actorRef, actor.chatId, prepared.command, prepared.summary, prepared.payload, expiresAt]
  );

  return token;
}

async function executeReadCommand(command: ReadCommandName, params: Record<string, unknown>) {
  switch (command) {
    case "help":
      return [
        "TechnoStore Ops via Telegram",
        "",
        "Consultas:",
        "• workflows",
        "• productos",
        "• stock",
        "• settings",
        "• clientes",
        "• conversaciones",
        "• orders",
        "",
        "Mutaciones seguras:",
        "• crear / editar / borrar producto",
        "• crear / editar stock",
        "• editar / borrar setting",
        "• crear / editar cliente",
        "",
        "Toda mutación requiere CONFIRM <TOKEN>.",
      ].join("\n");
    case "health_check": {
      const snapshot = await buildOperatorSnapshot();
      return [
        "Sistema activo",
        `• Productos: ${snapshot.counts.products}`,
        `• Stock: ${snapshot.counts.stock}`,
        `• Clientes: ${snapshot.counts.customers}`,
        `• Conversaciones abiertas: ${snapshot.counts.conversations}`,
        `• Órdenes: ${snapshot.counts.orders}`,
      ].join("\n");
    }
    case "list_workflows":
      return listN8nWorkflows();
    case "list_products": {
      const parsed = listProductsSchema.parse(params);
      const rows = await query<ProductRow>(
        `
          select id, sku, slug, brand, model, title, active, price_amount, promo_price_ars, currency_code
          from public.products
          ${parsed.query ? "where title ilike $1 or sku ilike $1 or brand ilike $1 or model ilike $1" : ""}
          order by updated_at desc, id desc
          limit 8
        `,
        parsed.query ? [`%${parsed.query}%`] : []
      );

      if (rows.length === 0) {
        return "No encontré productos con ese criterio.";
      }

      return [
        `Productos${parsed.query ? ` para "${parsed.query}"` : ""}:`,
        ...rows.map(
          (row) =>
            `• ${row.sku} · ${row.title} · ${formatMoney(row.promo_price_ars ?? row.price_amount, row.currency_code)} · ${
              row.active ? "activo" : "inactivo"
            }`
        ),
      ].join("\n");
    }
    case "list_stock": {
      const parsed = listStockSchema.parse(params);
      const values: unknown[] = [];
      const where: string[] = [];

      if (parsed.query) {
        values.push(`%${parsed.query}%`);
        where.push(
          `(coalesce(su.serial_number, '') ilike $${values.length} or p.sku ilike $${values.length} or p.title ilike $${values.length})`
        );
      }

      if (parsed.status) {
        values.push(parsed.status);
        where.push(`su.status = $${values.length}`);
      }

      const rows = await query<StockRow>(
        `
          select su.id, su.product_id, su.serial_number, su.status, su.location_code, p.sku, p.brand, p.model, p.title
          from public.stock_units su
          join public.products p on p.id = su.product_id
          ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
          order by su.updated_at desc, su.id desc
          limit 8
        `,
        values
      );

      if (rows.length === 0) {
        return "No encontré stock con ese criterio.";
      }

      return [
        "Stock reciente:",
        ...rows.map((row) => `• #${row.id} · ${row.sku} · ${row.status} · ${row.serial_number || "sin serial"}`),
      ].join("\n");
    }
    case "list_settings": {
      const parsed = listSettingsSchema.parse(params);
      const rows = await query<{ key: string; value: unknown }>(
        `
          select key, value
          from public.settings
          ${parsed.query ? "where key ilike $1" : ""}
          order by key asc
          limit 12
        `,
        parsed.query ? [`%${parsed.query}%`] : []
      );

      if (rows.length === 0) {
        return "No encontré settings con ese criterio.";
      }

      return ["Settings:", ...rows.map((row) => `• ${row.key} = ${asText(row.value)}`)].join("\n");
    }
    case "list_customers": {
      const parsed = listCustomersSchema.parse(params);
      const rows = await query<CustomerRow>(
        `
          select id, external_ref, first_name, last_name, phone, email
          from public.customers
          ${
            parsed.query
              ? "where coalesce(first_name, '') ilike $1 or coalesce(last_name, '') ilike $1 or coalesce(phone, '') ilike $1 or coalesce(email, '') ilike $1"
              : ""
          }
          order by updated_at desc, id desc
          limit 8
        `,
        parsed.query ? [`%${parsed.query}%`] : []
      );

      if (rows.length === 0) {
        return "No encontré clientes con ese criterio.";
      }

      return [
        "Clientes:",
        ...rows.map(
          (row) =>
            `• #${row.id} · ${[row.first_name, row.last_name].filter(Boolean).join(" ") || "sin nombre"} · ${
              row.phone || row.email || row.external_ref || "sin referencia"
            }`
        ),
      ].join("\n");
    }
    case "list_orders": {
      const parsed = listOrdersSchema.parse(params);
      const rows = await query<{ id: number; order_number: string; status: string; total_amount: string | number | null; currency_code: string }>(
        `
          select id, order_number, status, total_amount, currency_code
          from public.orders
          ${parsed.query ? "where order_number ilike $1 or coalesce(notes, '') ilike $1" : ""}
          order by created_at desc, id desc
          limit 8
        `,
        parsed.query ? [`%${parsed.query}%`] : []
      );

      if (rows.length === 0) {
        return "No encontré órdenes con ese criterio.";
      }

      return [
        "Órdenes:",
        ...rows.map((row) => `• ${row.order_number} · ${row.status} · ${formatMoney(row.total_amount, row.currency_code)}`),
      ].join("\n");
    }
    case "list_conversations": {
      const parsed = listConversationsSchema.parse(params);
      const rows = await query<{ id: number; title: string | null; channel: string; status: string; channel_thread_key: string }>(
        `
          select id, title, channel, status, channel_thread_key
          from public.conversations
          ${parsed.query ? "where coalesce(title, '') ilike $1 or channel_thread_key ilike $1 or channel ilike $1" : ""}
          order by last_message_at desc nulls last, id desc
          limit 8
        `,
        parsed.query ? [`%${parsed.query}%`] : []
      );

      if (rows.length === 0) {
        return "No encontré conversaciones con ese criterio.";
      }

      return [
        "Conversaciones:",
        ...rows.map((row) => `• #${row.id} · ${row.title || row.channel_thread_key} · ${row.channel} · ${row.status}`),
      ].join("\n");
    }
  }
}

async function prepareWriteCommand(command: WriteCommandName, rawParams: Record<string, unknown>): Promise<PreparedMutation> {
  switch (command) {
    case "create_product": {
      const parsed = createProductSchema.parse(rawParams);
      const title = parsed.title.trim();
      const brand = parsed.brand?.trim() || inferBrand(title);
      const model = parsed.model?.trim() || inferModel(title, brand);
      const payload = {
        ...parsed,
        brand,
        model,
        title,
        slug: parsed.slug?.trim() || slugify(parsed.sku),
        currency_code: parsed.currency_code?.trim() || "ARS",
        condition: parsed.condition || "new",
        active: parsed.active ?? true,
        in_stock: parsed.in_stock ?? false,
        image_url: parsed.image_url || null,
      };

      return {
        command,
        summary: [
          "Crear producto",
          `• SKU: ${payload.sku}`,
          `• Título: ${payload.title}`,
          `• Marca / modelo: ${payload.brand} / ${payload.model}`,
          payload.price_amount != null ? `• Precio: ${formatMoney(payload.price_amount, payload.currency_code)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        payload,
      };
    }
    case "update_product": {
      const parsed = updateProductSchema.parse(rawParams);
      const product = await resolveProduct(parsed.product_ref);
      return {
        command,
        summary: [
          `Actualizar producto ${product.sku}`,
          `• ${product.title}`,
          `• Cambios: ${Object.entries(parsed.changes)
            .map(([key, value]) => `${key}=${formatJsonPreview(value)}`)
            .join(", ")}`,
        ].join("\n"),
        payload: {
          product_id: product.id,
          sku: product.sku,
          title: product.title,
          changes: parsed.changes,
        },
      };
    }
    case "delete_product": {
      const parsed = deleteProductSchema.parse(rawParams);
      const product = await resolveProduct(parsed.product_ref);
      return {
        command,
        summary: [`Borrar producto`, `• ${product.sku}`, `• ${product.title}`].join("\n"),
        payload: {
          product_id: product.id,
          sku: product.sku,
          title: product.title,
        },
      };
    }
    case "create_stock_unit": {
      const parsed = createStockSchema.parse(rawParams);
      const product = await resolveProduct(parsed.product_ref);
      return {
        command,
        summary: [
          `Crear unidad de stock para ${product.sku}`,
          `• Producto: ${product.title}`,
          parsed.serial_number ? `• Serial: ${parsed.serial_number}` : "",
          parsed.status ? `• Estado: ${parsed.status}` : "",
          parsed.location_code ? `• Ubicación: ${parsed.location_code}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          ...parsed,
          product_id: product.id,
          sku: product.sku,
          currency_code: parsed.currency_code?.trim() || "ARS",
          status: parsed.status || "in_stock",
        },
      };
    }
    case "update_stock_unit": {
      const parsed = updateStockSchema.parse(rawParams);
      const stock = await resolveStock(parsed.stock_ref);
      let nextProductId: number | null = null;
      let nextSku: string | null = null;

      if (parsed.changes.product_ref) {
        const product = await resolveProduct(parsed.changes.product_ref);
        nextProductId = product.id;
        nextSku = product.sku;
      }

      return {
        command,
        summary: [
          `Actualizar stock #${stock.id}`,
          `• Referencia actual: ${stock.serial_number || stock.sku}`,
          `• Cambios: ${Object.entries(parsed.changes)
            .map(([key, value]) => `${key}=${formatJsonPreview(value)}`)
            .join(", ")}`,
        ].join("\n"),
        payload: {
          stock_unit_id: stock.id,
          current_sku: stock.sku,
          changes: parsed.changes,
          product_id: nextProductId,
          next_sku: nextSku,
        },
      };
    }
    case "update_setting": {
      const parsed = updateSettingSchema.parse(rawParams);
      const existing = await query<{ key: string }>("select key from public.settings where key = $1", [parsed.key]);

      return {
        command,
        summary: [
          `${existing.length > 0 ? "Actualizar" : "Crear"} setting`,
          `• Key: ${parsed.key}`,
          `• Value: ${formatJsonPreview(parsed.value)}`,
          parsed.description !== undefined ? `• Description: ${parsed.description ?? "null"}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        payload: parsed,
      };
    }
    case "delete_setting": {
      const parsed = deleteSettingSchema.parse(rawParams);
      const setting = await resolveSetting(parsed.key);

      if (setting.key === "store") {
        throw new Error('No borro el setting "store". Editalo en lugar de eliminarlo.');
      }

      return {
        command,
        summary: [`Borrar setting`, `• Key: ${setting.key}`].join("\n"),
        payload: { key: setting.key },
      };
    }
    case "create_customer": {
      const parsed = createCustomerSchema.parse(rawParams);
      return {
        command,
        summary: [
          "Crear cliente",
          `• Nombre: ${[parsed.first_name, parsed.last_name].filter(Boolean).join(" ") || "sin nombre"}`,
          parsed.phone ? `• Teléfono: ${parsed.phone}` : "",
          parsed.email ? `• Email: ${parsed.email}` : "",
          parsed.external_ref ? `• Ref: ${parsed.external_ref}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        payload: parsed,
      };
    }
    case "update_customer": {
      const parsed = updateCustomerSchema.parse(rawParams);
      const customer = await resolveCustomer(parsed.customer_ref);

      return {
        command,
        summary: [
          `Actualizar cliente #${customer.id}`,
          `• ${[customer.first_name, customer.last_name].filter(Boolean).join(" ") || customer.phone || customer.email || "sin nombre"}`,
          `• Cambios: ${Object.entries(parsed.changes)
            .map(([key, value]) => `${key}=${formatJsonPreview(value)}`)
            .join(", ")}`,
        ].join("\n"),
        payload: {
          customer_id: customer.id,
          changes: parsed.changes,
        },
      };
    }
  }
}

async function executeWriteCommand(client: PoolClient, actor: ActorContext, command: WriteCommandName, payload: Record<string, unknown>) {
  switch (command) {
    case "create_product": {
      const body = createProductSchema.parse(payload);
      const result = await client.query(
        `
          insert into public.products (
            sku, slug, brand, model, title, description, condition, price_amount, currency_code, active,
            category, cost_usd, logistics_usd, total_cost_usd, margin_pct, price_usd, promo_price_ars,
            bancarizada_total, bancarizada_cuota, bancarizada_interest, macro_total, macro_cuota, macro_interest,
            cuotas_qty, in_stock, delivery_type, delivery_days, usd_rate, image_url, ram_gb, storage_gb, network, color, battery_health
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
            $31, $32, $33, $34
          )
          returning id, sku, title
        `,
        [
          body.sku,
          body.slug || slugify(body.sku),
          body.brand || inferBrand(body.title),
          body.model || inferModel(body.title, body.brand || inferBrand(body.title)),
          body.title,
          body.description ?? null,
          body.condition || "new",
          body.price_amount ?? null,
          body.currency_code || "ARS",
          body.active ?? true,
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
          body.in_stock ?? false,
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

      const product = result.rows[0];
      await writeAudit(client, actor, "telegram.product.created", "product", String(product.id), { sku: product.sku });
      return `Producto creado.\n• ID: ${product.id}\n• SKU: ${product.sku}\n• Título: ${product.title}`;
    }
    case "update_product": {
      const parsed = z
        .object({
          product_id: z.coerce.number().int().positive(),
          sku: z.string(),
          title: z.string(),
          changes: updateProductSchema.shape.changes,
        })
        .parse(payload);

      const entries = Object.entries(parsed.changes);
      const sql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
      const values = entries.map(([, value]) => value);
      const result = await client.query(
        `update public.products set ${sql} where id = $${values.length + 1} returning id, sku, title`,
        [...values, parsed.product_id]
      );

      const product = result.rows[0];
      await writeAudit(client, actor, "telegram.product.updated", "product", String(product.id), parsed.changes);
      return `Producto actualizado.\n• ID: ${product.id}\n• SKU: ${product.sku}\n• Título: ${product.title}`;
    }
    case "delete_product": {
      const parsed = z
        .object({
          product_id: z.coerce.number().int().positive(),
          sku: z.string(),
          title: z.string(),
        })
        .parse(payload);

      const stockCount = await client.query<{ count: string }>(
        "select count(*)::text as count from public.stock_units where product_id = $1",
        [parsed.product_id]
      );

      if (Number(stockCount.rows[0]?.count ?? 0) > 0) {
        throw new Error(`No puedo borrar ${parsed.sku} porque todavía tiene unidades de stock. Archivá el producto primero.`);
      }

      await client.query("delete from public.products where id = $1", [parsed.product_id]);
      await writeAudit(client, actor, "telegram.product.deleted", "product", String(parsed.product_id), {
        sku: parsed.sku,
        title: parsed.title,
      });
      return `Producto borrado.\n• ID: ${parsed.product_id}\n• SKU: ${parsed.sku}`;
    }
    case "create_stock_unit": {
      const parsed = createStockSchema
        .extend({
          product_id: z.coerce.number().int().positive(),
          sku: z.string(),
        })
        .parse(payload);

      const result = await client.query(
        `
          insert into public.stock_units (
            product_id, serial_number, color, battery_health, status, location_code, cost_amount, currency_code, acquired_at, metadata
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          returning id
        `,
        [
          parsed.product_id,
          parsed.serial_number ?? null,
          parsed.color ?? null,
          parsed.battery_health ?? null,
          parsed.status || "in_stock",
          parsed.location_code ?? null,
          parsed.cost_amount ?? null,
          parsed.currency_code || "ARS",
          parsed.acquired_at ?? null,
          parsed.metadata || {},
        ]
      );

      const stockUnit = result.rows[0];
      await writeAudit(client, actor, "telegram.stock.created", "stock_unit", String(stockUnit.id), {
        product_id: parsed.product_id,
        sku: parsed.sku,
      });
      return `Unidad creada.\n• Stock ID: ${stockUnit.id}\n• Producto: ${parsed.sku}`;
    }
    case "update_stock_unit": {
      const parsed = z
        .object({
          stock_unit_id: z.coerce.number().int().positive(),
          current_sku: z.string(),
          changes: updateStockSchema.shape.changes,
          product_id: z.coerce.number().int().positive().nullable().optional(),
        })
        .parse(payload);

      const nextChanges = { ...parsed.changes } as Record<string, unknown>;
      delete nextChanges.product_ref;
      if (parsed.product_id != null) {
        nextChanges.product_id = parsed.product_id;
      }

      const entries = Object.entries(nextChanges);
      const sql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
      const values = entries.map(([, value]) => value);
      const result = await client.query(
        `update public.stock_units set ${sql} where id = $${values.length + 1} returning id, status`,
        [...values, parsed.stock_unit_id]
      );

      const stockUnit = result.rows[0];
      await writeAudit(client, actor, "telegram.stock.updated", "stock_unit", String(stockUnit.id), nextChanges);
      return `Unidad actualizada.\n• Stock ID: ${stockUnit.id}\n• Estado: ${stockUnit.status}`;
    }
    case "update_setting": {
      const parsed = updateSettingSchema.parse(payload);
      const result = await client.query(
        `
          insert into public.settings (key, value, description)
          values ($1, $2::jsonb, $3)
          on conflict (key)
          do update set
            value = excluded.value,
            description = excluded.description,
            updated_at = now()
          returning key
        `,
        [parsed.key, JSON.stringify(parsed.value), parsed.description ?? null]
      );

      await writeAudit(client, actor, "telegram.setting.updated", "setting", parsed.key, {
        value: parsed.value,
        description: parsed.description ?? null,
      });
      return `Setting guardado.\n• Key: ${result.rows[0].key}`;
    }
    case "delete_setting": {
      const parsed = deleteSettingSchema.parse(payload);

      if (parsed.key === "store") {
        throw new Error('No borro el setting "store".');
      }

      await client.query("delete from public.settings where key = $1", [parsed.key]);
      await writeAudit(client, actor, "telegram.setting.deleted", "setting", parsed.key);
      return `Setting borrado.\n• Key: ${parsed.key}`;
    }
    case "create_customer": {
      const parsed = createCustomerSchema.parse(payload);
      const result = await client.query(
        `
          insert into public.customers (external_ref, first_name, last_name, phone, email, notes)
          values ($1, $2, $3, $4, $5, $6)
          returning id, first_name, last_name, phone, email
        `,
        [
          parsed.external_ref ?? null,
          parsed.first_name ?? null,
          parsed.last_name ?? null,
          parsed.phone ?? null,
          parsed.email ?? null,
          parsed.notes ?? null,
        ]
      );

      const customer = result.rows[0];
      await writeAudit(client, actor, "telegram.customer.created", "customer", String(customer.id), {
        phone: customer.phone,
        email: customer.email,
      });
      return `Cliente creado.\n• ID: ${customer.id}\n• Nombre: ${[customer.first_name, customer.last_name].filter(Boolean).join(" ") || "sin nombre"}`;
    }
    case "update_customer": {
      const parsed = z
        .object({
          customer_id: z.coerce.number().int().positive(),
          changes: updateCustomerSchema.shape.changes,
        })
        .parse(payload);

      const entries = Object.entries(parsed.changes);
      const sql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
      const values = entries.map(([, value]) => value);
      const result = await client.query(
        `update public.customers set ${sql} where id = $${values.length + 1} returning id, first_name, last_name`,
        [...values, parsed.customer_id]
      );

      const customer = result.rows[0];
      await writeAudit(client, actor, "telegram.customer.updated", "customer", String(customer.id), parsed.changes);
      return `Cliente actualizado.\n• ID: ${customer.id}\n• Nombre: ${[customer.first_name, customer.last_name].filter(Boolean).join(" ") || "sin nombre"}`;
    }
  }
}

async function confirmPendingAction(actor: ActorContext, token: string) {
  const rows = await query<{
    id: number;
    command: WriteCommandName;
    payload: Record<string, unknown>;
    status: string;
    expires_at: string;
  }>(
    `
      select id, command, payload, status, expires_at
      from public.operator_confirmations
      where token = $1
        and actor_ref = $2
      limit 1
    `,
    [token, actor.actorRef]
  );

  const pending = rows[0];

  if (!pending) {
    return `No encontré una acción pendiente para ${token}.`;
  }

  if (pending.status !== "pending") {
    return `La acción ${token} ya no está pendiente (${pending.status}).`;
  }

  if (new Date(pending.expires_at).getTime() < Date.now()) {
    await pool.query(
      "update public.operator_confirmations set status = 'expired' where id = $1 and status = 'pending'",
      [pending.id]
    );
    return `La acción ${token} venció. Pedime una nueva.`;
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    const resultText = await executeWriteCommand(client, actor, pending.command, pending.payload);
    await client.query(
      `
        update public.operator_confirmations
        set status = 'executed',
            executed_at = now()
        where id = $1
      `,
      [pending.id]
    );
    await client.query("commit");
    return `${resultText}\n\nToken ${token} ejecutado.`;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function cancelPendingAction(actor: ActorContext, token: string) {
  const result = await pool.query(
    `
      update public.operator_confirmations
      set status = 'cancelled',
          cancelled_at = now()
      where token = $1
        and actor_ref = $2
        and status = 'pending'
      returning id
    `,
    [token, actor.actorRef]
  );

  if (result.rowCount === 0) {
    return `No encontré una acción pendiente para cancelar con token ${token}.`;
  }

  return `Acción ${token} cancelada.`;
}

function buildChatPrompts(params: {
  actor: ActorContext;
  snapshot: Awaited<ReturnType<typeof buildOperatorSnapshot>>;
}) {
  const systemPrompt = [
    "You are the trusted operator assistant for TechnoStore Ops.",
    "Respond in the same language the operator uses.",
    "Be concise, exact, and technical when needed.",
    "You know the operator schema contract below and should answer like an internal system operator, not like a generic chatbot.",
    OPERATOR_SCHEMA_GUIDE,
    "You must never claim a mutation happened unless the deterministic command layer executed it.",
    "If the user asks for a mutation but there is not enough information, ask for the missing field or exact reference.",
    "Current live snapshot:",
    JSON.stringify(params.snapshot, null, 2),
  ].join("\n");

  const prompt = [
    `Operator message: ${params.actor.userMessage}`,
    "",
    params.actor.attachedImageUrl
      ? `Attached image available for operator use: ${params.actor.attachedImageUrl}`
      : "",
    "Use the snapshot to answer about the app and environment. If the operator is asking to change data but you cannot do it safely, ask for a narrower instruction.",
  ].join("\n");

  return { systemPrompt, prompt };
}

function parseQuickReadCommand(text: string): { command: ReadCommandName; params: Record<string, unknown> } | null {
  const trimmed = text.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (trimmed === "/help" || trimmed === "help" || trimmed === "ayuda") {
    return { command: "help", params: {} };
  }

  if (trimmed === "/health" || trimmed === "health" || trimmed === "status" || trimmed === "estado") {
    return { command: "health_check", params: {} };
  }

  if (trimmed.includes("workflow")) {
    return { command: "list_workflows", params: {} };
  }

  return null;
}

function applyAttachedImageDefaults(
  actor: ActorContext,
  command: WriteCommandName | ReadCommandName | undefined,
  rawParams: Record<string, unknown>
) {
  if (!actor.attachedImageUrl || !command) {
    return rawParams;
  }

  if (command === "create_product" && rawParams.image_url == null) {
    return {
      ...rawParams,
      image_url: actor.attachedImageUrl,
    };
  }

  if (command === "update_product") {
    const changes =
      rawParams.changes && typeof rawParams.changes === "object" && !Array.isArray(rawParams.changes)
        ? (rawParams.changes as Record<string, unknown>)
        : null;

    if (changes && changes.image_url === undefined) {
      return {
        ...rawParams,
        changes: {
          ...changes,
          image_url: actor.attachedImageUrl,
        },
      };
    }
  }

  return rawParams;
}

export async function handleTelegramOperatorMessage(actor: ActorContext): Promise<OperatorMessageResult> {
  const start = await startTelegramOperatorTurn(actor);

  if (start.kind === "reply") {
    return start;
  }

  let draft: Draft;

  try {
    draft = await generateDraft({
      text: actor.userMessage,
      imageBase64: actor.imageBase64,
      attachedImageUrl: actor.attachedImageUrl,
      snapshot: start.snapshot,
    });
  } catch {
    const chat = buildChatPrompts({ actor, snapshot: start.snapshot });
    return { kind: "chat", ...chat };
  }

  return resolveTelegramOperatorDraft(actor, draft, start.snapshot);
}

export async function startTelegramOperatorTurn(actor: ActorContext): Promise<OperatorTurnStartResult> {
  const control = parseControlMessage(actor.userMessage);

  if (control) {
    const text =
      control.action === "confirm"
        ? await confirmPendingAction(actor, control.token)
        : await cancelPendingAction(actor, control.token);
    return { kind: "reply", text };
  }

  const quickCommand = parseQuickReadCommand(actor.userMessage);
  if (quickCommand) {
    return { kind: "reply", text: await executeReadCommand(quickCommand.command, quickCommand.params) };
  }

  const snapshot = await buildOperatorSnapshot();
  const prompts = buildDraftPrompts({
    text: actor.userMessage,
    imageBase64: actor.imageBase64,
    snapshot,
  });

  return {
    kind: "needs_ai",
    snapshot,
    draftSystemPrompt: prompts.systemPrompt,
    draftPrompt: prompts.prompt,
  };
}

export async function resolveTelegramOperatorDraft(
  actor: ActorContext,
  draft: Draft,
  snapshot?: Awaited<ReturnType<typeof buildOperatorSnapshot>>
): Promise<OperatorMessageResult> {
  const liveSnapshot = snapshot ?? (await buildOperatorSnapshot());

  if (draft.mode === "clarify") {
    return { kind: "reply", text: draft.reply || "Necesito un poco más de detalle para hacer eso." };
  }

  if (draft.mode === "chat") {
    const chat = buildChatPrompts({ actor, snapshot: liveSnapshot });
    return { kind: "chat", ...chat };
  }

  if (!draft.command) {
    const chat = buildChatPrompts({ actor, snapshot: liveSnapshot });
    return { kind: "chat", ...chat };
  }

  const params = applyAttachedImageDefaults(actor, draft.command, draft.params || {});

  if (draft.mode === "read") {
    return {
      kind: "reply",
      text: await executeReadCommand(draft.command as ReadCommandName, params),
    };
  }

  const prepared = await prepareWriteCommand(draft.command as WriteCommandName, params);
  const token = await storeConfirmation(actor, prepared);

  return {
    kind: "reply",
    text: [
      prepared.summary,
      "",
      `Confirmá con: CONFIRM ${token}`,
      `Cancelá con: CANCEL ${token}`,
    ].join("\n"),
  };
}
