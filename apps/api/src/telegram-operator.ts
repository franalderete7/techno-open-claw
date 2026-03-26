import { randomUUID } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import { pool, query } from "./db.js";
import { ollamaGenerate } from "./ollama.js";
import { buildOperatorHelpText, buildOperatorSkillGuide, buildOperatorSkillListText } from "./operator-skills.js";
import { saveConversationMessage } from "./telegram-storage.js";

const exec = promisify(execCallback);

const productConditionValues = ["new", "used", "like_new", "refurbished"] as const;
const stockStatusValues = ["in_stock", "reserved", "sold", "damaged"] as const;

const jsonValueSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

const booleanishSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "si", "sí", "all"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const filterBooleanSchema = z.preprocess((value) => {
  if (value == null || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "si", "sí", "y"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

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
  brand: z.string().trim().optional(),
  active: filterBooleanSchema.optional(),
  in_stock: filterBooleanSchema.optional(),
  category: z.string().trim().optional(),
  min_price_ars: z.coerce.number().finite().nonnegative().optional(),
  max_price_ars: z.coerce.number().finite().nonnegative().optional(),
  min_ram_gb: z.coerce.number().int().nonnegative().optional(),
  max_ram_gb: z.coerce.number().int().nonnegative().optional(),
  min_storage_gb: z.coerce.number().int().nonnegative().optional(),
  max_storage_gb: z.coerce.number().int().nonnegative().optional(),
  has_image: filterBooleanSchema.optional(),
  sort_by: z.enum(["updated_at", "price", "title"]).optional(),
  sort_dir: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  all: booleanishSchema.optional(),
});

const getProductDetailsSchema = z.object({
  product_ref: z.string().trim().min(1),
});

const listStockSchema = z.object({
  query: z.string().trim().optional(),
  product_ref: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  status: z.enum(stockStatusValues).optional(),
  location_code: z.string().trim().optional(),
  sold_from: z.string().datetime().optional(),
  sold_to: z.string().datetime().optional(),
  acquired_from: z.string().datetime().optional(),
  acquired_to: z.string().datetime().optional(),
  has_imei: filterBooleanSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  all: booleanishSchema.optional(),
});

const getStockDetailsSchema = z.object({
  stock_ref: z.string().trim().min(1),
});

const deleteStockSchema = z.object({
  stock_ref: z.string().trim().min(1),
});

const createStockSchema = z.object({
  product_ref: z.string().trim().min(1),
  serial_number: z.string().trim().optional().nullable(),
  imei_1: z.string().trim().optional().nullable(),
  imei_2: z.string().trim().optional().nullable(),
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
      imei_1: z.string().trim().nullable().optional(),
      imei_2: z.string().trim().nullable().optional(),
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
  limit: z.coerce.number().int().min(1).max(200).optional(),
  all: booleanishSchema.optional(),
});

const getSettingDetailsSchema = z.object({
  key: z.string().trim().min(1),
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
  limit: z.coerce.number().int().min(1).max(200).optional(),
  all: booleanishSchema.optional(),
});

const getCustomerDetailsSchema = z.object({
  customer_ref: z.string().trim().min(1),
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
  limit: z.coerce.number().int().min(1).max(200).optional(),
  all: booleanishSchema.optional(),
});

const listConversationsSchema = z.object({
  query: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  all: booleanishSchema.optional(),
});

const listOperatorSkillsSchema = z.object({});

const bulkUpdateProductsSchema = z.object({
  product_refs: z.array(z.string().trim().min(1)).min(1).max(24),
  changes: updateProductSchema.shape.changes,
});

const bulkUpdateStockSchema = z.object({
  stock_refs: z.array(z.string().trim().min(1)).min(1).max(24),
  changes: updateStockSchema.shape.changes,
});

export const draftSchema = z.object({
  mode: z.enum(["read", "write", "clarify", "chat"]),
  command: z
    .enum([
      "help",
      "list_operator_skills",
      "health_check",
      "list_workflows",
      "list_products",
      "get_product_details",
      "list_stock",
      "get_stock_details",
      "list_settings",
      "get_setting_details",
      "list_customers",
      "get_customer_details",
      "list_orders",
      "list_conversations",
      "create_product",
      "update_product",
      "bulk_update_products",
      "delete_product",
      "create_stock_unit",
      "update_stock_unit",
      "delete_stock_unit",
      "bulk_update_stock_units",
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
  conversationId?: number;
  imageBase64?: string;
  attachedImageUrl?: string;
};

type OperatorTurnStartResult =
  | { kind: "reply"; text: string; buttons?: OperatorButton[][]; forceReply?: boolean }
  | {
      kind: "needs_ai";
      snapshot: Awaited<ReturnType<typeof buildOperatorSnapshot>>;
      conversationMemory: string;
      draftSystemPrompt: string;
      draftPrompt: string;
    };

type PreparedMutation = {
  command: WriteCommandName;
  summary: string;
  payload: Record<string, unknown>;
};

type OperatorMessageResult =
  | { kind: "reply"; text: string; buttons?: OperatorButton[][]; forceReply?: boolean }
  | { kind: "chat"; systemPrompt: string; prompt: string };

type OperatorButton = {
  text: string;
  callback_data: string;
};

type ReadCommandName =
  | "help"
  | "list_operator_skills"
  | "health_check"
  | "list_workflows"
  | "list_products"
  | "get_product_details"
  | "list_stock"
  | "get_stock_details"
  | "list_settings"
  | "get_setting_details"
  | "list_customers"
  | "get_customer_details"
  | "list_orders"
  | "list_conversations";

type WriteCommandName =
  | "create_product"
  | "update_product"
  | "bulk_update_products"
  | "delete_product"
  | "create_stock_unit"
  | "update_stock_unit"
  | "delete_stock_unit"
  | "bulk_update_stock_units"
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
  in_stock?: boolean;
  price_amount: string | number | null;
  promo_price_ars?: string | number | null;
  currency_code: string;
  image_url?: string | null;
  ram_gb?: number | null;
  storage_gb?: number | null;
  stock_units_available?: number;
};

type StockRow = QueryResultRow & {
  id: number;
  product_id: number;
  sku: string;
  brand: string;
  model: string;
  title: string;
  serial_number: string | null;
  imei_1: string | null;
  imei_2: string | null;
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

type ConversationMemoryRow = QueryResultRow & {
  direction: "inbound" | "outbound" | "system";
  sender_kind: "customer" | "tool" | "admin" | "system";
  message_type: "text" | "audio" | "image" | "video" | "file" | "event";
  text_body: string | null;
  transcript: string | null;
  media_url: string | null;
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

function formatRecordDump(label: string, row: Record<string, unknown>) {
  return [
    label,
    ...Object.entries(row).map(([key, value]) => `• ${key}: ${formatJsonPreview(value)}`),
  ].join("\n");
}

function formatConversationMemory(rows: ConversationMemoryRow[]) {
  if (rows.length === 0) {
    return "No recent thread history.";
  }

  return rows
    .map((row) => {
      const speaker =
        row.sender_kind === "tool"
          ? "Bot"
          : row.sender_kind === "admin"
            ? "Operator"
            : row.sender_kind === "system"
              ? "System"
              : "Operator";
      const text =
        row.text_body?.trim() ||
        row.transcript?.trim() ||
        (row.message_type === "image"
          ? "[image]"
          : row.message_type === "audio"
            ? "[audio]"
            : row.message_type === "event"
              ? "[event]"
            : `[${row.message_type}]`);
      return `${speaker}: ${text}`;
    })
    .join("\n");
}

async function loadConversationMemory(conversationId?: number, limit = 12) {
  if (!conversationId) {
    return "No recent thread history.";
  }

  const rows = await query<ConversationMemoryRow>(
    `
      select direction, sender_kind, message_type, text_body, transcript, media_url
      from public.messages
      where conversation_id = $1
      order by created_at desc, id desc
      limit $2
    `,
    [conversationId, limit]
  );

  return formatConversationMemory(rows.reverse());
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

function buildDateRangeLabel(from?: string, to?: string) {
  if (from && to) {
    return `${from} → ${to}`;
  }

  return from || to || "";
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

function buildOperatorCallbackData(kind: "approve" | "cancel" | "edit" | "menu", value: string) {
  return `op:${kind}:${value}`;
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

function parseLooseControlAction(text: string) {
  const trimmed = text.trim().toLowerCase();

  if (/^(si|sí|dale|ok|okay|confirma|confirmalo|confirm|aprob[aá]lo|hacelo|hazlo|ejecuta|ejecutalo)\W*$/i.test(trimmed)) {
    return "confirm" as const;
  }

  if (/^(no|cancela|cancelalo|cancel|descarta|aborta|par[aá]lo)\W*$/i.test(trimmed)) {
    return "cancel" as const;
  }

  return null;
}

type MenuIntent =
  | "home"
  | "products"
  | "stock"
  | "settings"
  | "reports"
  | "products_list_help"
  | "products_create_help"
  | "products_update_help"
  | "products_delete_help"
  | "stock_list_help"
  | "stock_create_help"
  | "stock_update_help"
  | "stock_delete_help"
  | "settings_update_help"
  | "settings_list_help"
  | "report_sold_last_30d"
  | "report_in_stock"
  | "report_missing_images";

function parseSyntheticMenuIntent(text: string): MenuIntent | null {
  const match = text.trim().match(/^__menu:([a-z0-9_]+)__$/i);
  return (match?.[1] as MenuIntent | undefined) ?? null;
}

function parseBroadMenuIntent(text: string): MenuIntent | null {
  const trimmed = text.trim().toLowerCase();

  if (!trimmed) return "home";

  if (/^(\/start|hola|buenas|hey|hi|menu|men[uú]|opciones|ayuda|que pod[eé]s hacer|qué pod[eé]s hacer)\W*$/i.test(trimmed)) {
    return "home";
  }

  if (/^(productos?|catalogo|cat[aá]logo|gestionar productos?|manejar productos?)\W*$/i.test(trimmed)) {
    return "products";
  }

  if (/^(stock|inventario|unidades?|manejar stock|gestionar stock)\W*$/i.test(trimmed)) {
    return "stock";
  }

  if (/^(settings|config|configuracion|configuración|ajustes?)\W*$/i.test(trimmed)) {
    return "settings";
  }

  if (/^(reportes?|estad[ií]sticas|resumen|ventas)\W*$/i.test(trimmed)) {
    return "reports";
  }

  return null;
}

function buildOperatorMenuReply(intent: MenuIntent): { text: string; buttons?: OperatorButton[][] } {
  switch (intent) {
    case "home":
      return {
        text:
          "¿Qué querés hacer? Puedo gestionar productos, stock, settings y reportes. También podés escribirlo en lenguaje natural, por ejemplo: “subí 5% los Samsung”, “listá stock vendido el mes pasado” o “creá un producto con esta foto”.",
        buttons: [
          [
            { text: "Productos", callback_data: buildOperatorCallbackData("menu", "products") },
            { text: "Stock", callback_data: buildOperatorCallbackData("menu", "stock") },
          ],
          [
            { text: "Settings", callback_data: buildOperatorCallbackData("menu", "settings") },
            { text: "Reportes", callback_data: buildOperatorCallbackData("menu", "reports") },
          ],
        ],
      };
    case "products":
      return {
        text: "Productos: podés listar con filtros, crear, editar precios o archivar/borrar. ¿Qué querés hacer?",
        buttons: [
          [
            { text: "Listar / filtrar", callback_data: buildOperatorCallbackData("menu", "products_list_help") },
            { text: "Crear", callback_data: buildOperatorCallbackData("menu", "products_create_help") },
          ],
          [
            { text: "Editar", callback_data: buildOperatorCallbackData("menu", "products_update_help") },
            { text: "Archivar / borrar", callback_data: buildOperatorCallbackData("menu", "products_delete_help") },
          ],
          [{ text: "Inicio", callback_data: buildOperatorCallbackData("menu", "home") }],
        ],
      };
    case "stock":
      return {
        text: "Stock: podés listar, crear, editar estado/ubicación/IMEI o borrar una unidad. ¿Qué querés hacer?",
        buttons: [
          [
            { text: "Listar / filtrar", callback_data: buildOperatorCallbackData("menu", "stock_list_help") },
            { text: "Crear", callback_data: buildOperatorCallbackData("menu", "stock_create_help") },
          ],
          [
            { text: "Editar", callback_data: buildOperatorCallbackData("menu", "stock_update_help") },
            { text: "Borrar", callback_data: buildOperatorCallbackData("menu", "stock_delete_help") },
          ],
          [{ text: "Inicio", callback_data: buildOperatorCallbackData("menu", "home") }],
        ],
      };
    case "settings":
      return {
        text: "Settings: podés listar claves o actualizar valores JSON/escalares del store. ¿Qué querés hacer?",
        buttons: [
          [
            { text: "Listar", callback_data: buildOperatorCallbackData("menu", "settings_list_help") },
            { text: "Actualizar", callback_data: buildOperatorCallbackData("menu", "settings_update_help") },
          ],
          [{ text: "Inicio", callback_data: buildOperatorCallbackData("menu", "home") }],
        ],
      };
    case "reports":
      return {
        text: "Reportes rápidos. También podés pedir filtros más específicos por texto.",
        buttons: [
          [
            { text: "Vendidos 30 días", callback_data: buildOperatorCallbackData("menu", "report_sold_last_30d") },
            { text: "Stock disponible", callback_data: buildOperatorCallbackData("menu", "report_in_stock") },
          ],
          [
            { text: "Sin imagen", callback_data: buildOperatorCallbackData("menu", "report_missing_images") },
            { text: "Inicio", callback_data: buildOperatorCallbackData("menu", "home") },
          ],
        ],
      };
    case "products_list_help":
      return {
        text:
          "Decime qué querés listar y con qué filtros. Ejemplos: “listá Samsung entre 400000 y 900000”, “mostrá Apple activos con stock”, “buscá A56 8/256”.",
      };
    case "products_create_help":
      return {
        text:
          "Para crear un producto, mandame al menos SKU y título. Si adjuntás una foto, la tomo como image_url por defecto. Ejemplo: “crear producto sku samsung-a56-5g-8-256 titulo Samsung A56 5G 8/256 promo 589000”.",
      };
    case "products_update_help":
      return {
        text:
          "Decime el producto y el cambio. Ejemplos: “cambiá el precio del samsung-a56-5g-8-256 a 579000”, “desactivá iphone-16-128”, “poné 3 días de entrega al A36”.",
      };
    case "products_delete_help":
      return {
        text:
          "Podés pedirme archivar o borrar un producto. Si querés borrarlo de verdad, decilo explícito. Si tiene stock, no lo borro; en ese caso conviene archivarlo.",
      };
    case "stock_list_help":
      return {
        text:
          "Podés filtrar stock por estado, marca, producto, ubicación o fechas. Ejemplos: “listá stock vendido el último mes”, “mostrá stock Samsung en SALTA”, “buscá imei 356...”.",
      };
    case "stock_create_help":
      return {
        text:
          "Para crear stock, indicame el producto y los datos físicos. Ejemplo: “crear stock para samsung-a56-5g-8-256 imei1 123 imei2 456 ubicación SALTA”.",
      };
    case "stock_update_help":
      return {
        text:
          "Podés cambiar estado, ubicación, IMEI, serial o costo. Ejemplos: “marcá como sold el imei 356...”, “mové el stock 44 a SALTA”.",
      };
    case "stock_delete_help":
      return {
        text:
          "Para borrar una unidad, decime la referencia exacta. Por seguridad no borro stock vendido.",
      };
    case "settings_list_help":
      return {
        text:
          "Podés listar settings por clave o prefijo. Ejemplos: “listá settings store”, “buscá whatsapp”, “mostrá todo pricing”.",
      };
    case "settings_update_help":
      return {
        text:
          "Podés actualizar valores escalares o JSON. Ejemplos: “seteá pricing_default_usd_rate a 1460”, “actualizá store_whatsapp a 543875319940”.",
      };
    case "report_sold_last_30d":
      return {
        text: "__report_sold_last_30d__",
      };
    case "report_in_stock":
      return {
        text: "__report_in_stock__",
      };
    case "report_missing_images":
      return {
        text: "__report_missing_images__",
      };
  }
}

async function saveOperatorEventMessage(actor: ActorContext, text: string, payload: Record<string, unknown>) {
  if (!actor.conversationId) {
    return;
  }

  await saveConversationMessage({
    conversationId: actor.conversationId,
    direction: "system",
    senderKind: "admin",
    messageType: "event",
    textBody: text,
    payload,
  });
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
  conversationMemory: string;
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
  "- public.stock_units stores physical inventory. Stable refs: id, serial_number, imei_1, imei_2. Required for creation: product_ref. Common editable fields: serial_number, imei_1, imei_2, color, battery_health, status, location_code, cost_amount, currency_code, acquired_at, sold_at, metadata.",
  "- public.settings stores key/value configuration. Stable ref: key. update_setting requires key and value. delete_setting removes the key.",
  "- public.customers stores operator and customer contacts. Stable refs: id, external_ref, phone, email. create_customer requires at least one of external_ref, phone, or email.",
  "- public.conversations stores thread headers by channel_thread_key. public.messages stores the actual interaction timeline. Each Telegram inbound and outbound message is saved in public.messages.",
  "- Product images can use public URLs. If the operator attached a Telegram image, the API can persist it on the VPS and provide a /media/... URL for image_url.",
  "- public.operator_confirmations stores pending write actions. Low-risk single-row writes can auto-execute. Higher-risk actions use inline approve/edit/cancel buttons, with CONFIRM <TOKEN> and CANCEL <TOKEN> as fallback.",
  "- public.audit_logs stores executed mutations and important operator actions.",
  "- public.orders and public.order_items store commercial orders. They are readable in the operator chat even if writes are not yet exposed there.",
  "Mutation rules:",
  "- Never invent IDs or hidden fields.",
  "- Use product_ref, stock_ref, customer_ref, and setting key exactly from the operator request until deterministic resolution happens.",
  "- Never claim a row was created, updated, or deleted unless the deterministic command layer executed it.",
  "- If the operator asks to archive a product, prefer update_product with active=false. Use delete_product only for explicit permanent deletion intent.",
].join("\n");

const OPERATOR_SKILL_GUIDE = buildOperatorSkillGuide();

function buildDraftPrompts(params: {
  text: string;
  imageBase64?: string;
  attachedImageUrl?: string;
  conversationMemory: string;
  snapshot: Awaited<ReturnType<typeof buildOperatorSnapshot>>;
}) {
  const systemPrompt = [
    "You are OpenClaw, the Telegram operator model for TechnoStore Ops.",
    "You know the actual PostgreSQL public schema at the operational level summarized below.",
    OPERATOR_SCHEMA_GUIDE,
    OPERATOR_SKILL_GUIDE,
    "Convert the operator request into a strict JSON decision for the automation flow.",
    "Think in natural operator intents like listing, filtering, creating, editing, archiving, deleting, moving stock, or changing settings. Do not mention internal tool names in user-facing reply text.",
    "Return JSON only. No prose. No markdown.",
    "Allowed read commands: help, list_operator_skills, health_check, list_workflows, list_products, get_product_details, list_stock, get_stock_details, list_settings, get_setting_details, list_customers, get_customer_details, list_orders, list_conversations.",
    "Allowed write commands: create_product, update_product, bulk_update_products, delete_product, create_stock_unit, update_stock_unit, delete_stock_unit, bulk_update_stock_units, update_setting, delete_setting, create_customer, update_customer.",
    "If the user is asking a general question or casual operator chat, return mode=chat and include the full operator-facing response in reply.",
    "If information is missing for a mutation, return mode=clarify and put the full clarification question in reply.",
    "If the user asks for full row, all columns, entire row, toda la fila, or all information about a product/stock/customer/setting, prefer the matching get_*_details read command instead of any list_* command.",
    "Use recent thread history to resolve follow-up references like 'that one', 'same product', 'that SKU', 'those settings', or 'do it now'.",
    "If the reference is clear from recent thread history, do not ask the operator to repeat it.",
    "Never invent IDs. Keep product_ref, stock_ref, customer_ref and setting keys as plain text from the user's request.",
    "For update commands, only include the fields the user explicitly wants to change.",
    "For delete commands, only use them if the user explicitly asked to delete, remove, or permanently erase.",
    "For product archive/deactivate intent, use update_product with active=false.",
    "When the user asks for lists by brand, price range, RAM, storage, sold date, acquisition date, location, stock status, or image presence, use the available filter fields instead of plain text only.",
    "For price and numeric values, use numbers, not strings, when possible.",
    "If the message is just a greeting like hey/hola, reply briefly in reply and use mode=chat.",
  ].join("\n");

  const prompt = [
    "Recent thread history:",
    params.conversationMemory,
    "",
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
      select su.id, su.product_id, su.serial_number, su.imei_1, su.imei_2, su.status, su.location_code, p.sku, p.brand, p.model, p.title
      from public.stock_units su
      join public.products p on p.id = su.product_id
      where
        ($1::bigint is not null and su.id = $1)
        or coalesce(lower(su.serial_number), '') = lower($2)
        or coalesce(lower(su.imei_1), '') = lower($2)
        or coalesce(lower(su.imei_2), '') = lower($2)
        or lower(p.sku) = lower($2)
        or p.title ilike $3
      order by
        case
          when ($1::bigint is not null and su.id = $1) then 0
          when coalesce(lower(su.serial_number), '') = lower($2) then 1
          when coalesce(lower(su.imei_1), '') = lower($2) then 2
          when coalesce(lower(su.imei_2), '') = lower($2) then 3
          when lower(p.sku) = lower($2) then 4
          else 5
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
    (row) =>
      row.id === exactId ||
      row.serial_number?.toLowerCase() === trimmed.toLowerCase() ||
      row.imei_1?.toLowerCase() === trimmed.toLowerCase() ||
      row.imei_2?.toLowerCase() === trimmed.toLowerCase() ||
      row.sku.toLowerCase() === trimmed.toLowerCase()
  );

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (rows.length > 1) {
    throw new Error(
      `La unidad es ambigua. Coincidencias: ${rows
        .slice(0, 3)
        .map((row) => `#${row.id} ${row.serial_number || row.imei_1 || row.imei_2 || row.sku}`)
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

async function getLatestPendingConfirmation(actor: ActorContext) {
  const rows = await query<{
    id: number;
    token: string;
    command: WriteCommandName;
    summary: string;
    expires_at: string;
  }>(
    `
      select id, token, command, summary, expires_at
      from public.operator_confirmations
      where actor_ref = $1
        and status = 'pending'
      order by created_at desc, id desc
      limit 1
    `,
    [actor.actorRef]
  );

  return rows[0] ?? null;
}

type ApprovalMode = "auto" | "inline_confirm";

function isScalarSettingValue(value: unknown) {
  return value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function getApprovalMode(prepared: PreparedMutation): ApprovalMode {
  if (prepared.command === "update_product") {
    const changes = (prepared.payload.changes || {}) as Record<string, unknown>;
    const keys = Object.keys(changes);
    const safeKeys = new Set(["price_amount", "promo_price_ars", "active", "delivery_days", "in_stock"]);
    if (keys.length > 0 && keys.every((key) => safeKeys.has(key))) {
      return "auto";
    }
  }

  if (prepared.command === "update_stock_unit") {
    const changes = (prepared.payload.changes || {}) as Record<string, unknown>;
    const keys = Object.keys(changes);
    const safeKeys = new Set(["status", "location_code", "sold_at"]);
    if (keys.length > 0 && keys.every((key) => safeKeys.has(key))) {
      return "auto";
    }
  }

  if (prepared.command === "update_setting") {
    const key = String(prepared.payload.key || "");
    const value = prepared.payload.value;
    if (key && key !== "store" && isScalarSettingValue(value)) {
      return "auto";
    }
  }

  return "inline_confirm";
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

function buildPendingActionReply(prepared: PreparedMutation, token: string): OperatorMessageResult {
  return {
    kind: "reply",
    text: [
      prepared.summary,
      "",
      "Revisá la acción y aprobala si está bien.",
      `• Aprobar: botón o CONFIRM ${token}`,
      `• Cancelar: botón o CANCEL ${token}`,
    ].join("\n"),
    buttons: [
      [
        { text: "Aprobar", callback_data: buildOperatorCallbackData("approve", token) },
        { text: "Editar", callback_data: buildOperatorCallbackData("edit", token) },
        { text: "Cancelar", callback_data: buildOperatorCallbackData("cancel", token) },
      ],
    ],
  };
}

async function executePreparedMutation(actor: ActorContext, prepared: PreparedMutation) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const resultText = await executeWriteCommand(client, actor, prepared.command, prepared.payload);
    await client.query("commit");
    return resultText;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function buildSyntheticReportCommand(text: string): { command: ReadCommandName; params: Record<string, unknown> } | null {
  switch (text.trim()) {
    case "__report_sold_last_30d__":
      return {
        command: "list_stock",
        params: {
          status: "sold",
          sold_from: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
          limit: 50,
        },
      };
    case "__report_in_stock__":
      return {
        command: "list_stock",
        params: {
          status: "in_stock",
          limit: 50,
        },
      };
    case "__report_missing_images__":
      return {
        command: "list_products",
        params: {
          has_image: false,
          active: true,
          limit: 50,
        },
      };
    default:
      return null;
  }
}

async function executeReadCommand(command: ReadCommandName, params: Record<string, unknown>) {
  switch (command) {
    case "help":
      return buildOperatorHelpText();
    case "list_operator_skills":
      listOperatorSkillsSchema.parse(params);
      return buildOperatorSkillListText();
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
      const limit = parsed.all ? 200 : parsed.limit ?? 24;
      const values: unknown[] = [];
      const where: string[] = [];

      if (parsed.query) {
        values.push(`%${parsed.query}%`);
        where.push(
          `(p.title ilike $${values.length} or p.sku ilike $${values.length} or p.brand ilike $${values.length} or p.model ilike $${values.length} or coalesce(p.description, '') ilike $${values.length})`
        );
      }

      if (parsed.brand) {
        values.push(`%${parsed.brand}%`);
        where.push(`p.brand ilike $${values.length}`);
      }

      if (parsed.active != null) {
        values.push(parsed.active);
        where.push(`p.active = $${values.length}`);
      }

      if (parsed.in_stock != null) {
        values.push(parsed.in_stock);
        where.push(`p.in_stock = $${values.length}`);
      }

      if (parsed.category) {
        values.push(`%${parsed.category}%`);
        where.push(`coalesce(p.category, '') ilike $${values.length}`);
      }

      if (parsed.min_price_ars != null) {
        values.push(parsed.min_price_ars);
        where.push(`coalesce(p.promo_price_ars, p.price_amount) >= $${values.length}`);
      }

      if (parsed.max_price_ars != null) {
        values.push(parsed.max_price_ars);
        where.push(`coalesce(p.promo_price_ars, p.price_amount) <= $${values.length}`);
      }

      if (parsed.min_ram_gb != null) {
        values.push(parsed.min_ram_gb);
        where.push(`coalesce(p.ram_gb, 0) >= $${values.length}`);
      }

      if (parsed.max_ram_gb != null) {
        values.push(parsed.max_ram_gb);
        where.push(`coalesce(p.ram_gb, 0) <= $${values.length}`);
      }

      if (parsed.min_storage_gb != null) {
        values.push(parsed.min_storage_gb);
        where.push(`coalesce(p.storage_gb, 0) >= $${values.length}`);
      }

      if (parsed.max_storage_gb != null) {
        values.push(parsed.max_storage_gb);
        where.push(`coalesce(p.storage_gb, 0) <= $${values.length}`);
      }

      if (parsed.has_image != null) {
        where.push(
          parsed.has_image
            ? `nullif(trim(coalesce(p.image_url, '')), '') is not null`
            : `nullif(trim(coalesce(p.image_url, '')), '') is null`
        );
      }

      const sortColumn =
        parsed.sort_by === "price"
          ? "coalesce(p.promo_price_ars, p.price_amount)"
          : parsed.sort_by === "title"
            ? "p.title"
            : "p.updated_at";
      const sortDir =
        parsed.sort_dir || (parsed.sort_by === "title" ? "asc" : "desc");
      const rows = await query<ProductRow>(
        `
          select
            p.id,
            p.sku,
            p.slug,
            p.brand,
            p.model,
            p.title,
            p.active,
            p.in_stock,
            p.price_amount,
            p.promo_price_ars,
            p.currency_code,
            p.image_url,
            p.ram_gb,
            p.storage_gb,
            coalesce(inv.stock_units_available, 0) as stock_units_available
          from public.products p
          left join lateral (
            select count(*) filter (where status = 'in_stock')::int as stock_units_available
            from public.stock_units su
            where su.product_id = p.id
          ) inv on true
          ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
          order by ${sortColumn} ${sortDir}, p.id desc
          limit ${limit}
        `,
        values
      );

      if (rows.length === 0) {
        return "No encontré productos con ese criterio.";
      }

      const filters = [
        parsed.query ? `texto=${parsed.query}` : "",
        parsed.brand ? `marca=${parsed.brand}` : "",
        parsed.active != null ? `activos=${parsed.active ? "sí" : "no"}` : "",
        parsed.in_stock != null ? `in_stock=${parsed.in_stock ? "sí" : "no"}` : "",
        parsed.category ? `categoría=${parsed.category}` : "",
        parsed.min_price_ars != null || parsed.max_price_ars != null
          ? `precio=${parsed.min_price_ars ?? "-"}..${parsed.max_price_ars ?? "-"}`
          : "",
        parsed.min_ram_gb != null || parsed.max_ram_gb != null
          ? `ram=${parsed.min_ram_gb ?? "-"}..${parsed.max_ram_gb ?? "-"}`
          : "",
        parsed.min_storage_gb != null || parsed.max_storage_gb != null
          ? `storage=${parsed.min_storage_gb ?? "-"}..${parsed.max_storage_gb ?? "-"}`
          : "",
        parsed.has_image != null ? `imagen=${parsed.has_image ? "sí" : "no"}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return [
        `Productos${filters ? ` (${filters})` : ""} · ${rows.length}${parsed.all ? "" : ` máx. ${limit}`}`,
        ...rows.map(
          (row) =>
            `• ${row.sku} · ${row.title} · ${formatMoney(row.promo_price_ars ?? row.price_amount, row.currency_code)} · ${
              row.active ? "activo" : "inactivo"
            } · stock ${row.stock_units_available ?? 0} · imagen ${row.image_url ? "sí" : "no"}`
        ),
      ].join("\n");
    }
    case "get_product_details": {
      const parsed = getProductDetailsSchema.parse(params);
      const product = await resolveProduct(parsed.product_ref);
      const rows = await query<Record<string, unknown>>(
        `
          select
            p.*,
            coalesce(inv.stock_units_total, 0) as stock_units_total,
            coalesce(inv.stock_units_available, 0) as stock_units_available,
            coalesce(inv.stock_units_reserved, 0) as stock_units_reserved,
            coalesce(inv.stock_units_sold, 0) as stock_units_sold
          from public.products p
          left join lateral (
            select
              count(*)::int as stock_units_total,
              count(*) filter (where status = 'in_stock')::int as stock_units_available,
              count(*) filter (where status = 'reserved')::int as stock_units_reserved,
              count(*) filter (where status = 'sold')::int as stock_units_sold
            from public.stock_units su
            where su.product_id = p.id
          ) inv on true
          where p.id = $1
          limit 1
        `,
        [product.id]
      );

      if (rows.length === 0) {
        return `No pude cargar la fila completa del producto ${parsed.product_ref}.`;
      }

      return formatRecordDump(`Fila completa de producto ${product.sku}:`, rows[0]);
    }
    case "list_stock": {
      const parsed = listStockSchema.parse(params);
      const limit = parsed.all ? 200 : parsed.limit ?? 36;
      const values: unknown[] = [];
      const where: string[] = [];

      if (parsed.query) {
        values.push(`%${parsed.query}%`);
        where.push(
          `(coalesce(su.serial_number, '') ilike $${values.length} or coalesce(su.imei_1, '') ilike $${values.length} or coalesce(su.imei_2, '') ilike $${values.length} or p.sku ilike $${values.length} or p.title ilike $${values.length})`
        );
      }

      if (parsed.status) {
        values.push(parsed.status);
        where.push(`su.status = $${values.length}`);
      }

      if (parsed.brand) {
        values.push(`%${parsed.brand}%`);
        where.push(`p.brand ilike $${values.length}`);
      }

      if (parsed.product_ref) {
        const product = await resolveProduct(parsed.product_ref);
        values.push(product.id);
        where.push(`su.product_id = $${values.length}`);
      }

      if (parsed.location_code) {
        values.push(`%${parsed.location_code}%`);
        where.push(`coalesce(su.location_code, '') ilike $${values.length}`);
      }

      if (parsed.sold_from) {
        values.push(parsed.sold_from);
        where.push(`su.sold_at >= $${values.length}`);
      }

      if (parsed.sold_to) {
        values.push(parsed.sold_to);
        where.push(`su.sold_at <= $${values.length}`);
      }

      if (parsed.acquired_from) {
        values.push(parsed.acquired_from);
        where.push(`su.acquired_at >= $${values.length}`);
      }

      if (parsed.acquired_to) {
        values.push(parsed.acquired_to);
        where.push(`su.acquired_at <= $${values.length}`);
      }

      if (parsed.has_imei != null) {
        where.push(
          parsed.has_imei
            ? `(nullif(trim(coalesce(su.imei_1, '')), '') is not null or nullif(trim(coalesce(su.imei_2, '')), '') is not null)`
            : `(nullif(trim(coalesce(su.imei_1, '')), '') is null and nullif(trim(coalesce(su.imei_2, '')), '') is null)`
        );
      }

      const rows = await query<StockRow>(
        `
          select su.id, su.product_id, su.serial_number, su.imei_1, su.imei_2, su.status, su.location_code, p.sku, p.brand, p.model, p.title
          from public.stock_units su
          join public.products p on p.id = su.product_id
          ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
          order by su.updated_at desc, su.id desc
          limit ${limit}
        `,
        values
      );

      if (rows.length === 0) {
        return "No encontré stock con ese criterio.";
      }

      const filters = [
        parsed.query ? `texto=${parsed.query}` : "",
        parsed.product_ref ? `producto=${parsed.product_ref}` : "",
        parsed.brand ? `marca=${parsed.brand}` : "",
        parsed.status ? `estado=${parsed.status}` : "",
        parsed.location_code ? `ubicación=${parsed.location_code}` : "",
        parsed.has_imei != null ? `imei=${parsed.has_imei ? "sí" : "no"}` : "",
        buildDateRangeLabel(parsed.sold_from, parsed.sold_to) ? `vendido=${buildDateRangeLabel(parsed.sold_from, parsed.sold_to)}` : "",
        buildDateRangeLabel(parsed.acquired_from, parsed.acquired_to)
          ? `ingreso=${buildDateRangeLabel(parsed.acquired_from, parsed.acquired_to)}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return [
        `Stock${filters ? ` (${filters})` : ""} · ${rows.length}${parsed.all ? "" : ` máx. ${limit}`}`,
        ...rows.map(
          (row) =>
            `• #${row.id} · ${row.sku} · ${row.status} · ${row.location_code || "sin ubicación"} · ${
              row.serial_number || row.imei_1 || row.imei_2 || "sin serial/imei"
            }`
        ),
      ].join("\n");
    }
    case "get_stock_details": {
      const parsed = getStockDetailsSchema.parse(params);
      const stock = await resolveStock(parsed.stock_ref);
      const rows = await query<Record<string, unknown>>(
        `
          select
            su.*,
            p.sku as product_sku,
            p.slug as product_slug,
            p.brand as product_brand,
            p.model as product_model,
            p.title as product_title
          from public.stock_units su
          join public.products p on p.id = su.product_id
          where su.id = $1
          limit 1
        `,
        [stock.id]
      );

      if (rows.length === 0) {
        return `No pude cargar la fila completa del stock ${parsed.stock_ref}.`;
      }

      return formatRecordDump(`Fila completa de stock #${stock.id}:`, rows[0]);
    }
    case "list_settings": {
      const parsed = listSettingsSchema.parse(params);
      const limit = parsed.all ? 200 : parsed.limit ?? 36;
      const rows = await query<{ key: string; value: unknown }>(
        `
          select key, value
          from public.settings
          ${parsed.query ? "where key ilike $1" : ""}
          order by key asc
          limit ${limit}
        `,
        parsed.query ? [`%${parsed.query}%`] : []
      );

      if (rows.length === 0) {
        return "No encontré settings con ese criterio.";
      }

      return [`Settings (${rows.length}${parsed.all ? "" : ` máx. ${limit}`}) :`, ...rows.map((row) => `• ${row.key} = ${asText(row.value)}`)].join("\n");
    }
    case "get_setting_details": {
      const parsed = getSettingDetailsSchema.parse(params);
      const setting = await resolveSetting(parsed.key);
      const rows = await query<Record<string, unknown>>(
        `
          select key, value, description, created_at, updated_at
          from public.settings
          where key = $1
          limit 1
        `,
        [setting.key]
      );

      if (rows.length === 0) {
        return `No pude cargar la fila completa del setting ${parsed.key}.`;
      }

      return formatRecordDump(`Fila completa del setting ${setting.key}:`, rows[0]);
    }
    case "list_customers": {
      const parsed = listCustomersSchema.parse(params);
      const limit = parsed.all ? 200 : parsed.limit ?? 36;
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
          limit ${limit}
        `,
        parsed.query ? [`%${parsed.query}%`] : []
      );

      if (rows.length === 0) {
        return "No encontré clientes con ese criterio.";
      }

      return [
        `Clientes${parsed.query ? ` para "${parsed.query}"` : ""} (${rows.length}${parsed.all ? "" : ` máx. ${limit}`}) :`,
        ...rows.map(
          (row) =>
            `• #${row.id} · ${[row.first_name, row.last_name].filter(Boolean).join(" ") || "sin nombre"} · ${
              row.phone || row.email || row.external_ref || "sin referencia"
            }`
        ),
      ].join("\n");
    }
    case "get_customer_details": {
      const parsed = getCustomerDetailsSchema.parse(params);
      const customer = await resolveCustomer(parsed.customer_ref);
      const rows = await query<Record<string, unknown>>(
        `
          select *
          from public.customers
          where id = $1
          limit 1
        `,
        [customer.id]
      );

      if (rows.length === 0) {
        return `No pude cargar la fila completa del cliente ${parsed.customer_ref}.`;
      }

      return formatRecordDump(`Fila completa del cliente #${customer.id}:`, rows[0]);
    }
    case "list_orders": {
      const parsed = listOrdersSchema.parse(params);
      const limit = parsed.all ? 200 : parsed.limit ?? 36;
      const rows = await query<{ id: number; order_number: string; status: string; total_amount: string | number | null; currency_code: string }>(
        `
          select id, order_number, status, total_amount, currency_code
          from public.orders
          ${parsed.query ? "where order_number ilike $1 or coalesce(notes, '') ilike $1" : ""}
          order by created_at desc, id desc
          limit ${limit}
        `,
        parsed.query ? [`%${parsed.query}%`] : []
      );

      if (rows.length === 0) {
        return "No encontré órdenes con ese criterio.";
      }

      return [
        `Órdenes${parsed.query ? ` para "${parsed.query}"` : ""} (${rows.length}${parsed.all ? "" : ` máx. ${limit}`}) :`,
        ...rows.map((row) => `• ${row.order_number} · ${row.status} · ${formatMoney(row.total_amount, row.currency_code)}`),
      ].join("\n");
    }
    case "list_conversations": {
      const parsed = listConversationsSchema.parse(params);
      const limit = parsed.all ? 200 : parsed.limit ?? 36;
      const rows = await query<{ id: number; title: string | null; channel: string; status: string; channel_thread_key: string }>(
        `
          select id, title, channel, status, channel_thread_key
          from public.conversations
          ${parsed.query ? "where coalesce(title, '') ilike $1 or channel_thread_key ilike $1 or channel ilike $1" : ""}
          order by last_message_at desc nulls last, id desc
          limit ${limit}
        `,
        parsed.query ? [`%${parsed.query}%`] : []
      );

      if (rows.length === 0) {
        return "No encontré conversaciones con ese criterio.";
      }

      return [
        `Conversaciones${parsed.query ? ` para "${parsed.query}"` : ""} (${rows.length}${parsed.all ? "" : ` máx. ${limit}`}) :`,
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
    case "bulk_update_products": {
      const parsed = bulkUpdateProductsSchema.parse(rawParams);
      const resolved = await Promise.all(parsed.product_refs.map((productRef) => resolveProduct(productRef)));
      const uniqueProducts = Array.from(new Map(resolved.map((product) => [product.id, product])).values());

      return {
        command,
        summary: [
          `Actualizar ${uniqueProducts.length} productos`,
          `• Productos: ${uniqueProducts.map((product) => product.sku).join(", ")}`,
          `• Cambios: ${Object.entries(parsed.changes)
            .map(([key, value]) => `${key}=${formatJsonPreview(value)}`)
            .join(", ")}`,
        ].join("\n"),
        payload: {
          product_ids: uniqueProducts.map((product) => product.id),
          skus: uniqueProducts.map((product) => product.sku),
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
          parsed.imei_1 ? `• IMEI 1: ${parsed.imei_1}` : "",
          parsed.imei_2 ? `• IMEI 2: ${parsed.imei_2}` : "",
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
          `• Referencia actual: ${stock.serial_number || stock.imei_1 || stock.imei_2 || stock.sku}`,
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
    case "delete_stock_unit": {
      const parsed = deleteStockSchema.parse(rawParams);
      const stock = await resolveStock(parsed.stock_ref);
      return {
        command,
        summary: [
          `Borrar unidad de stock #${stock.id}`,
          `• Producto: ${stock.sku}`,
          `• Referencia: ${stock.serial_number || stock.imei_1 || stock.imei_2 || "sin serial/imei"}`,
          `• Estado: ${stock.status}`,
        ].join("\n"),
        payload: {
          stock_unit_id: stock.id,
          sku: stock.sku,
          status: stock.status,
          reference: stock.serial_number || stock.imei_1 || stock.imei_2 || null,
        },
      };
    }
    case "bulk_update_stock_units": {
      const parsed = bulkUpdateStockSchema.parse(rawParams);
      const resolved = await Promise.all(parsed.stock_refs.map((stockRef) => resolveStock(stockRef)));
      const uniqueStock = Array.from(new Map(resolved.map((stock) => [stock.id, stock])).values());
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
          `Actualizar ${uniqueStock.length} unidades de stock`,
          `• Referencias: ${uniqueStock
            .map((stock) => stock.serial_number || stock.imei_1 || stock.imei_2 || `#${stock.id}`)
            .join(", ")}`,
          `• Cambios: ${Object.entries(parsed.changes)
            .map(([key, value]) => `${key}=${formatJsonPreview(value)}`)
            .join(", ")}`,
        ].join("\n"),
        payload: {
          stock_unit_ids: uniqueStock.map((stock) => stock.id),
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
    case "bulk_update_products": {
      const parsed = z
        .object({
          product_ids: z.array(z.coerce.number().int().positive()).min(1),
          skus: z.array(z.string()).min(1),
          changes: updateProductSchema.shape.changes,
        })
        .parse(payload);

      const entries = Object.entries(parsed.changes);
      const sql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
      const values = entries.map(([, value]) => value);
      const result = await client.query<{ id: number; sku: string }>(
        `update public.products set ${sql} where id = any($${values.length + 1}::bigint[]) returning id, sku`,
        [...values, parsed.product_ids]
      );

      for (const row of result.rows) {
        await writeAudit(client, actor, "telegram.product.bulk_updated", "product", String(row.id), parsed.changes);
      }

      return [
        `Productos actualizados: ${result.rowCount ?? result.rows.length}`,
        ...result.rows.map((row) => `• ${row.sku}`),
      ].join("\n");
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
            product_id, serial_number, imei_1, imei_2, color, battery_health, status, location_code, cost_amount, currency_code, acquired_at, metadata
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          returning id
        `,
        [
          parsed.product_id,
          parsed.serial_number ?? null,
          parsed.imei_1 ?? null,
          parsed.imei_2 ?? null,
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
    case "delete_stock_unit": {
      const parsed = z
        .object({
          stock_unit_id: z.coerce.number().int().positive(),
          sku: z.string(),
          status: z.enum(stockStatusValues),
          reference: z.string().nullable().optional(),
        })
        .parse(payload);

      if (parsed.status === "sold") {
        throw new Error("No borro stock vendido. Si necesitás corregirlo, cambiá el estado o revisá la orden asociada.");
      }

      await client.query("delete from public.stock_units where id = $1", [parsed.stock_unit_id]);
      await writeAudit(client, actor, "telegram.stock.deleted", "stock_unit", String(parsed.stock_unit_id), {
        sku: parsed.sku,
        reference: parsed.reference ?? null,
        status: parsed.status,
      });
      return `Unidad borrada.\n• Stock ID: ${parsed.stock_unit_id}\n• Producto: ${parsed.sku}`;
    }
    case "bulk_update_stock_units": {
      const parsed = z
        .object({
          stock_unit_ids: z.array(z.coerce.number().int().positive()).min(1),
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
      const result = await client.query<{ id: number; status: string }>(
        `update public.stock_units set ${sql} where id = any($${values.length + 1}::bigint[]) returning id, status`,
        [...values, parsed.stock_unit_ids]
      );

      for (const row of result.rows) {
        await writeAudit(client, actor, "telegram.stock.bulk_updated", "stock_unit", String(row.id), nextChanges);
      }

      return [
        `Unidades actualizadas: ${result.rowCount ?? result.rows.length}`,
        ...result.rows.map((row) => `• #${row.id} · ${row.status}`),
      ].join("\n");
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
    await saveOperatorEventMessage(actor, `Acción vencida: ${token}`, {
      kind: "operator_confirmation_expired",
      token,
      command: pending.command,
    });
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
    await saveOperatorEventMessage(actor, `Acción ejecutada: ${pending.command}`, {
      kind: "operator_confirmation_executed",
      token,
      command: pending.command,
      payload: pending.payload,
      result_text: resultText,
    });
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

  await saveOperatorEventMessage(actor, `Acción cancelada: ${token}`, {
    kind: "operator_confirmation_cancelled",
    token,
  });

  return `Acción ${token} cancelada.`;
}

function buildChatPrompts(params: {
  actor: ActorContext;
  snapshot: Awaited<ReturnType<typeof buildOperatorSnapshot>>;
  conversationMemory: string;
}) {
  const systemPrompt = [
    "You are the trusted operator assistant for TechnoStore Ops.",
    "Respond in the same language the operator uses.",
    "Be concise, exact, and technical when needed.",
    "You know the operator schema contract below and should answer like an internal system operator, not like a generic chatbot.",
    OPERATOR_SCHEMA_GUIDE,
    OPERATOR_SKILL_GUIDE,
    "You must never claim a mutation happened unless the deterministic command layer executed it.",
    "If the user asks for a mutation but there is not enough information, ask for the missing field or exact reference.",
    "Use recent thread history to resolve follow-up references and preserve conversational continuity.",
    "Recent thread history:",
    params.conversationMemory,
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

const detailIntentPatterns = [
  "full row",
  "entire row",
  "all columns",
  "all information",
  "all the information",
  "all the data",
  "complete row",
  "complete details",
  "full details",
  "fila completa",
  "toda la fila",
  "todos los campos",
  "toda la info",
  "toda la informacion",
  "toda la información",
  "detalle completo",
  "detalles completos",
];

function cleanDetailReference(text: string) {
  return text
    .replace(/["'`]/g, " ")
    .replace(/\b(?:give me|show me|dame|mostrar|mostrame|muéstrame|quiero|please|por favor|yes|that one|ese|esa|ese producto|ese item|ese ítem)\b/gi, " ")
    .replace(/\b(?:all|the|of|for|on|about|product|producto|item|sku|stock|setting|customer|cliente|row|columns|information|data|entire|full|complete|completa|completo|fila|campos|detalles|info|sobre|del|de|para|that|this)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseExplicitDetailCommand(text: string): { command: ReadCommandName; params: Record<string, unknown> } | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (!detailIntentPatterns.some((pattern) => lower.includes(pattern))) {
    return null;
  }

  let command: ReadCommandName = "get_product_details";
  let paramKey: "product_ref" | "stock_ref" | "key" | "customer_ref" = "product_ref";

  if (
    /\b(stock|serial|serial_number|imei|unidad|inventory|inventario)\b/i.test(trimmed)
  ) {
    command = "get_stock_details";
    paramKey = "stock_ref";
  } else if (/\b(setting|config|configuration|configuracion|configuración|clave)\b/i.test(trimmed)) {
    command = "get_setting_details";
    paramKey = "key";
  } else if (/\b(customer|cliente|phone|email|external_ref)\b/i.test(trimmed)) {
    command = "get_customer_details";
    paramKey = "customer_ref";
  }

  const quotedRef = trimmed.match(/["'`]([^"'`]+)["'`]/);
  const skuLikeRef = trimmed.match(/\b[a-z0-9]+(?:-[a-z0-9]+){1,}\b/i);
  const suffixRef = trimmed.match(/\b(?:for|of|on|about|de|del|para|sobre)\b\s+(.+)$/i);

  const rawRef = quotedRef?.[1] ?? skuLikeRef?.[0] ?? suffixRef?.[1] ?? trimmed;
  const ref = cleanDetailReference(rawRef);

  if (!ref) {
    return null;
  }

  return { command, params: { [paramKey]: ref } };
}

function parseQuickReadCommand(text: string): { command: ReadCommandName; params: Record<string, unknown> } | null {
  const trimmed = text.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (trimmed === "/help" || trimmed === "help" || trimmed === "ayuda") {
    return { command: "help", params: {} };
  }

  if (trimmed === "skills" || trimmed === "skill" || trimmed === "capacidades" || trimmed === "habilidades") {
    return { command: "list_operator_skills", params: {} };
  }

  if (trimmed === "/health" || trimmed === "health" || trimmed === "status" || trimmed === "estado") {
    return { command: "health_check", params: {} };
  }

  if (trimmed.includes("workflow")) {
    return { command: "list_workflows", params: {} };
  }

  const detailCommand = parseExplicitDetailCommand(text);
  if (detailCommand) {
    return detailCommand;
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

function applyReadIntentDefaults(
  actor: ActorContext,
  command: WriteCommandName | ReadCommandName | undefined,
  rawParams: Record<string, unknown>
) {
  if (!command || !String(command).startsWith("list_")) {
    return rawParams;
  }

  const wantsAll = /\b(all|todos?|todas?|entire|full|completo|completa)\b/i.test(actor.userMessage);
  const nextParams = { ...rawParams };

  if (wantsAll && nextParams.all == null) {
    nextParams.all = true;
  }

  if (nextParams.limit == null) {
    switch (command) {
      case "list_products":
        nextParams.limit = wantsAll ? 200 : 24;
        break;
      case "list_stock":
      case "list_settings":
      case "list_customers":
      case "list_orders":
      case "list_conversations":
        nextParams.limit = wantsAll ? 200 : 36;
        break;
      default:
        break;
    }
  }

  return nextParams;
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
      conversationMemory: start.conversationMemory,
      snapshot: start.snapshot,
    });
  } catch {
    const chat = buildChatPrompts({ actor, snapshot: start.snapshot, conversationMemory: start.conversationMemory });
    return { kind: "chat", ...chat };
  }

  return resolveTelegramOperatorDraft(actor, draft, start.snapshot, start.conversationMemory);
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

  const looseControl = parseLooseControlAction(actor.userMessage);
  if (looseControl) {
    const pending = await getLatestPendingConfirmation(actor);
    if (pending) {
      const text =
        looseControl === "confirm"
          ? await confirmPendingAction(actor, pending.token)
          : await cancelPendingAction(actor, pending.token);
      return { kind: "reply", text };
    }
  }

  const syntheticMenuIntent = parseSyntheticMenuIntent(actor.userMessage);
  if (syntheticMenuIntent) {
    const menuReply = buildOperatorMenuReply(syntheticMenuIntent);
    const reportCommand = buildSyntheticReportCommand(menuReply.text);
    if (reportCommand) {
      return {
        kind: "reply",
        text: await executeReadCommand(reportCommand.command, reportCommand.params),
      };
    }
    return { kind: "reply", text: menuReply.text, buttons: menuReply.buttons };
  }

  const broadMenuIntent = parseBroadMenuIntent(actor.userMessage);
  if (broadMenuIntent) {
    const menuReply = buildOperatorMenuReply(broadMenuIntent);
    return { kind: "reply", text: menuReply.text, buttons: menuReply.buttons };
  }

  const quickCommand = parseQuickReadCommand(actor.userMessage);
  if (quickCommand) {
    return { kind: "reply", text: await executeReadCommand(quickCommand.command, quickCommand.params) };
  }

  const snapshot = await buildOperatorSnapshot();
  const conversationMemory = await loadConversationMemory(actor.conversationId);
  const prompts = buildDraftPrompts({
    text: actor.userMessage,
    imageBase64: actor.imageBase64,
    attachedImageUrl: actor.attachedImageUrl,
    conversationMemory,
    snapshot,
  });

  return {
    kind: "needs_ai",
    snapshot,
    conversationMemory,
    draftSystemPrompt: prompts.systemPrompt,
    draftPrompt: prompts.prompt,
  };
}

export async function resolveTelegramOperatorDraft(
  actor: ActorContext,
  draft: Draft,
  snapshot?: Awaited<ReturnType<typeof buildOperatorSnapshot>>,
  conversationMemory?: string
): Promise<OperatorMessageResult> {
  const liveSnapshot = snapshot ?? (await buildOperatorSnapshot());
  const liveConversationMemory = conversationMemory ?? (await loadConversationMemory(actor.conversationId));

  if (draft.mode === "clarify") {
    return {
      kind: "reply",
      text: draft.reply || "Necesito un poco más de detalle para hacer eso.",
      forceReply: true,
    };
  }

  if (draft.mode === "chat") {
    const chat = buildChatPrompts({ actor, snapshot: liveSnapshot, conversationMemory: liveConversationMemory });
    return { kind: "chat", ...chat };
  }

  if (!draft.command) {
    const chat = buildChatPrompts({ actor, snapshot: liveSnapshot, conversationMemory: liveConversationMemory });
    return { kind: "chat", ...chat };
  }

  const params = applyReadIntentDefaults(
    actor,
    draft.command,
    applyAttachedImageDefaults(actor, draft.command, draft.params || {})
  );

  try {
    if (draft.mode === "read") {
      return {
        kind: "reply",
        text: await executeReadCommand(draft.command as ReadCommandName, params),
      };
    }

    const prepared = await prepareWriteCommand(draft.command as WriteCommandName, params);
    const approvalMode = getApprovalMode(prepared);

    if (approvalMode === "auto") {
      const resultText = await executePreparedMutation(actor, prepared);
      await saveOperatorEventMessage(actor, `Acción autoejecutada: ${prepared.command}`, {
        kind: "operator_action_executed",
        command: prepared.command,
        summary: prepared.summary,
        payload: prepared.payload,
        approval_mode: approvalMode,
        result_text: resultText,
      });

      return {
        kind: "reply",
        text: `${resultText}\n\nEjecutado directamente porque era un cambio puntual de bajo riesgo.`,
      };
    }

    const token = await storeConfirmation(actor, prepared);
    await saveOperatorEventMessage(actor, `Acción pendiente de aprobación: ${prepared.command}`, {
      kind: "operator_action_pending",
      token,
      command: prepared.command,
      summary: prepared.summary,
      payload: prepared.payload,
      approval_mode: approvalMode,
    });
    return buildPendingActionReply(prepared, token);
  } catch (error) {
    return {
      kind: "reply",
      text: error instanceof Error ? error.message : "No pude preparar esa acción. Revisá la referencia y los campos.",
    };
  }
}
