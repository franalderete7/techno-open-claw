import { randomUUID } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import { pool, query } from "./db.js";
import { ollamaGenerate } from "./ollama.js";
import { buildOperatorHelpText, buildOperatorSkillGuide, buildOperatorSkillListText } from "./operator-skills.js";
import { calculateDerivedPricing, shouldRecalculatePricing } from "./pricing.js";
import { saveConversationMessage } from "./telegram-storage.js";
import {
  createInventoryPurchase,
  getInventoryPurchaseDetail,
  inventoryPurchaseStatusValues,
  listInventoryPurchases,
  updateInventoryPurchase,
} from "./inventory-purchases.js";
import {
  getMetaAd,
  getMetaAdSet,
  getMetaCampaign,
  listMetaAds,
  listMetaAdSets,
  listMetaCampaigns,
  type MetaAdRecord,
  type MetaAdSetRecord,
  type MetaCampaignRecord,
  updateMetaAd,
  updateMetaAdSet,
  updateMetaCampaign,
} from "./meta-ads.js";
import {
  countRecentTelegramImageBatch,
  extractStockCandidatesFromRecentImages,
  type ExtractedStockCandidate,
} from "./imei-images.js";

const exec = promisify(execCallback);

const productConditionValues = ["new", "used", "like_new", "refurbished"] as const;
const stockStatusValues = ["in_stock", "reserved", "sold", "damaged"] as const;
const metaFilterStatusValues = ["active", "paused", "archived", "deleted"] as const;
const metaWritableStatusValues = ["ACTIVE", "PAUSED"] as const;
const catalogSyncSectionKeys = ["xiaomi_redmi_poco", "samsung", "phone", "tablet", "motorola", "jbl"] as const;
const catalogSyncColorTokens = new Set([
  "blanco",
  "blanca",
  "white",
  "naranja",
  "orange",
  "azul",
  "blue",
  "negro",
  "negra",
  "black",
  "gris",
  "gray",
  "silver",
  "plata",
  "titanio",
  "natural",
  "gold",
  "oro",
]);
const catalogSyncTierTokens = new Set(["pro", "max", "plus", "ultra", "fe"]);
const catalogSyncEconomyTokens = new Set(["eco", "economico", "economica", "used", "usado", "usada"]);

function normalizeStockStatusValue(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, "_");

  switch (normalized) {
    case "available":
    case "disponible":
    case "in_stock":
    case "instock":
    case "stock":
      return "in_stock";
    case "reserved":
    case "reserva":
    case "reservado":
      return "reserved";
    case "sold":
    case "vendido":
      return "sold";
    case "damaged":
    case "broken":
    case "roto":
    case "danado":
    case "daniado":
      return "damaged";
    default:
      return value;
  }
}

const stockStatusSchema = z.preprocess(normalizeStockStatusValue, z.enum(stockStatusValues));

function normalizeMetaFilterStatusValue(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, "_");

  switch (normalized) {
    case "active":
    case "activo":
    case "activa":
    case "activas":
    case "activos":
    case "running":
      return "active";
    case "paused":
    case "pause":
    case "pausado":
    case "pausada":
    case "pausadas":
    case "pausados":
      return "paused";
    case "archived":
    case "archivado":
    case "archivada":
      return "archived";
    case "deleted":
    case "borrado":
    case "eliminado":
      return "deleted";
    default:
      return value;
  }
}

function normalizeMetaWritableStatusValue(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = normalizeMetaFilterStatusValue(value);
  if (normalized === "active") return "ACTIVE";
  if (normalized === "paused") return "PAUSED";
  return value;
}

const metaFilterStatusSchema = z.preprocess(normalizeMetaFilterStatusValue, z.enum(metaFilterStatusValues));
const metaWritableStatusSchema = z.preprocess(normalizeMetaWritableStatusValue, z.enum(metaWritableStatusValues));

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
  status: stockStatusSchema.optional(),
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
  inventory_purchase_ref: z.string().trim().optional(),
  serial_number: z.string().trim().optional().nullable(),
  imei_1: z.string().trim().optional().nullable(),
  imei_2: z.string().trim().optional().nullable(),
  color: z.string().trim().optional().nullable(),
  battery_health: z.coerce.number().int().min(0).max(100).optional().nullable(),
  status: stockStatusSchema.optional(),
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
      inventory_purchase_ref: z.string().trim().optional(),
      serial_number: z.string().trim().nullable().optional(),
      imei_1: z.string().trim().nullable().optional(),
      imei_2: z.string().trim().nullable().optional(),
      color: z.string().trim().nullable().optional(),
      battery_health: z.coerce.number().int().min(0).max(100).nullable().optional(),
      status: stockStatusSchema.optional(),
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

const inventoryPurchaseFunderSchema = z.object({
  funder_name: z.string().trim().min(1),
  payment_method: z.string().trim().optional().nullable(),
  amount_amount: z.coerce.number().finite().nonnegative().optional().nullable(),
  currency_code: z.string().trim().optional().nullable(),
  share_pct: z.coerce.number().finite().nonnegative().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

const listInventoryPurchasesSchema = z.object({
  query: z.string().trim().optional(),
  status: z.enum(inventoryPurchaseStatusValues).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  all: booleanishSchema.optional(),
});

const getInventoryPurchaseDetailsSchema = z.object({
  purchase_ref: z.string().trim().min(1),
});

const listMetaCampaignsSchema = z.object({
  query: z.string().trim().optional(),
  status: metaFilterStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  all: booleanishSchema.optional(),
});

const listMetaAdSetsSchema = z.object({
  query: z.string().trim().optional(),
  status: metaFilterStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  all: booleanishSchema.optional(),
});

const listMetaAdsSchema = z.object({
  query: z.string().trim().optional(),
  status: metaFilterStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  all: booleanishSchema.optional(),
});

const updateMetaCampaignSchema = z.object({
  campaign_ref: z.string().trim().min(1),
  changes: z
    .object({
      status: metaWritableStatusSchema.optional(),
      daily_budget: z.coerce.number().finite().positive().optional(),
      lifetime_budget: z.coerce.number().finite().positive().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Provide at least one Meta campaign field to update.")
    .refine(
      (value) => !(value.daily_budget != null && value.lifetime_budget != null),
      "Choose only one budget field at a time."
    ),
});

const updateMetaAdSetSchema = z.object({
  ad_set_ref: z.string().trim().min(1),
  changes: z
    .object({
      status: metaWritableStatusSchema.optional(),
      daily_budget: z.coerce.number().finite().positive().optional(),
      lifetime_budget: z.coerce.number().finite().positive().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Provide at least one Meta ad set field to update.")
    .refine(
      (value) => !(value.daily_budget != null && value.lifetime_budget != null),
      "Choose only one budget field at a time."
    ),
});

const updateMetaAdSchema = z.object({
  ad_ref: z.string().trim().min(1),
  changes: z
    .object({
      status: metaWritableStatusSchema,
    })
    .refine((value) => Object.keys(value).length > 0, "Provide at least one Meta ad field to update."),
});

const createInventoryPurchaseSchema = z.object({
  supplier_name: z.string().trim().optional().nullable(),
  currency_code: z.string().trim().optional(),
  total_amount: z.coerce.number().finite().nonnegative().optional().nullable(),
  status: z.enum(inventoryPurchaseStatusValues).optional(),
  acquired_at: z.string().datetime().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
  funders: z.array(inventoryPurchaseFunderSchema).optional(),
});

const updateInventoryPurchaseSchema = z.object({
  purchase_ref: z.string().trim().min(1),
  changes: createInventoryPurchaseSchema.refine((value) => Object.keys(value).length > 0, "Provide at least one purchase field to update."),
});

const bulkRepriceProductsSchema = z.object({
  items: z
    .array(
      z.object({
        product_ref: z.string().trim().min(1),
        cost_usd: z.coerce.number().finite().nonnegative(),
      })
    )
    .min(1)
    .max(50),
});

const bulkSyncProductsSchema = z.object({
  raw_list: z.string().trim().min(1).optional(),
  create_missing: z.boolean().optional().default(true),
  active: z.boolean().optional(),
  in_stock: z.boolean().optional(),
  condition: z.enum(productConditionValues).optional(),
});

const createStockFromImagesSchema = z.object({
  product_ref: z.string().trim().min(1),
  inventory_purchase_ref: z.string().trim().optional(),
  cost_amount: z.coerce.number().finite().nonnegative().optional().nullable(),
  currency_code: z.string().trim().optional(),
  status: stockStatusSchema.optional(),
  location_code: z.string().trim().optional().nullable(),
  acquired_at: z.string().datetime().optional().nullable(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
});

const createInventoryPurchaseFromImagesSchema = createInventoryPurchaseSchema.extend({
  product_ref: z.string().trim().min(1),
  cost_amount: z.coerce.number().finite().nonnegative().optional().nullable(),
  location_code: z.string().trim().optional().nullable(),
});

const updateStockStatusFromImagesSchema = z.object({
  status: stockStatusSchema,
  sold_at: z.string().datetime().optional().nullable(),
  location_code: z.string().trim().optional().nullable(),
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
      "list_inventory_purchases",
      "get_inventory_purchase_details",
      "list_meta_campaigns",
      "list_meta_ad_sets",
      "list_meta_ads",
      "create_product",
      "update_product",
      "bulk_update_products",
      "bulk_reprice_products",
      "bulk_sync_products",
      "delete_product",
      "create_inventory_purchase",
      "update_inventory_purchase",
      "update_meta_campaign",
      "update_meta_ad_set",
      "update_meta_ad",
      "create_stock_unit",
      "create_stock_from_images",
      "create_inventory_purchase_from_images",
      "update_stock_unit",
      "update_stock_status_from_images",
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

type ProductResolutionOption = {
  id: number;
  sku: string;
  slug: string;
  title: string;
  price_amount: string | number | null;
  promo_price_ars?: string | number | null;
  currency_code: string;
};

type ProductResolutionPathPart = string | number;

type ProductResolutionPromptPayload = {
  kind: "product_resolution_prompt";
  mode: "read" | "write";
  command: ReadCommandName | WriteCommandName;
  params: Record<string, unknown>;
  reference: string;
  reference_path: ProductResolutionPathPart[];
  options: ProductResolutionOption[];
};

type PurchaseResolutionOption = {
  id: number | null;
  purchase_number: string;
  supplier_name: string | null;
  status: string;
  total_amount: string | number | null;
  currency_code: string;
  is_create_new?: boolean;
};

type PurchaseResolutionPromptPayload = {
  kind: "purchase_resolution_prompt";
  mode: "write";
  command: WriteCommandName;
  params: Record<string, unknown>;
  reference: string;
  reference_path: ProductResolutionPathPart[];
  options: PurchaseResolutionOption[];
};

type MetaObjectResolutionOption = {
  id: string;
  name: string | null;
  status: string | null;
  effective_status: string | null;
  entity_kind: "campaign" | "ad_set" | "ad";
};

type MetaObjectResolutionPromptPayload = {
  kind: "meta_object_resolution_prompt";
  mode: "read" | "write";
  command: ReadCommandName | WriteCommandName;
  params: Record<string, unknown>;
  reference: string;
  reference_path: ProductResolutionPathPart[];
  entity_kind: "campaign" | "ad_set" | "ad";
  options: MetaObjectResolutionOption[];
};

type ResolutionPromptPayload =
  | ProductResolutionPromptPayload
  | PurchaseResolutionPromptPayload
  | MetaObjectResolutionPromptPayload;

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
  | "list_conversations"
  | "list_inventory_purchases"
  | "get_inventory_purchase_details"
  | "list_meta_campaigns"
  | "list_meta_ad_sets"
  | "list_meta_ads";

type WriteCommandName =
  | "create_product"
  | "update_product"
  | "bulk_update_products"
  | "bulk_reprice_products"
  | "bulk_sync_products"
  | "delete_product"
  | "create_inventory_purchase"
  | "update_inventory_purchase"
  | "update_meta_campaign"
  | "update_meta_ad_set"
  | "update_meta_ad"
  | "create_stock_unit"
  | "create_stock_from_images"
  | "create_inventory_purchase_from_images"
  | "update_stock_unit"
  | "update_stock_status_from_images"
  | "delete_stock_unit"
  | "bulk_update_stock_units"
  | "update_setting"
  | "delete_setting"
  | "create_customer"
  | "update_customer";

type InventoryPurchaseRow = QueryResultRow & {
  id: number;
  purchase_number: string;
  supplier_name: string | null;
  currency_code: string;
  total_amount: string | number | null;
  status: string;
  acquired_at: string | null;
  created_at?: string;
  funders_count?: number;
  stock_units_count?: number;
};

type ExistingStockMatchRow = QueryResultRow & {
  id: number;
  product_id: number;
  sku: string;
  title: string;
  serial_number: string | null;
  imei_1: string | null;
  imei_2: string | null;
  status: string;
  location_code: string | null;
};

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

type CatalogSyncSectionKey = (typeof catalogSyncSectionKeys)[number];

type CatalogSyncDraftItem = {
  sectionKey: CatalogSyncSectionKey;
  sectionLabel: string;
  rawName: string;
  costUsd: number;
  lineNumber: number;
  title: string;
  brand: string;
  model: string;
  sku: string;
  slug: string;
  category: string | null;
  condition: (typeof productConditionValues)[number];
  active: boolean;
  inStock: boolean;
  ramGb: number | null;
  storageGb: number | null;
  network: string | null;
  color: string | null;
  description: string | null;
  normalizedTitle: string;
  colorlessTitle: string;
  requiredTokens: string[];
  tierTokens: string[];
};

type CatalogSyncProductRow = ProductRow & {
  cost_usd: string | number | null;
  model: string;
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

type MetaObjectRow = {
  id: string;
  name: string | null;
  status: string | null;
  effective_status: string | null;
  entity_kind: "campaign" | "ad_set" | "ad";
  objective?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  daily_budget?: string | null;
  lifetime_budget?: string | null;
  updated_time?: string | null;
};

class ProductReferenceAmbiguityError extends Error {
  reference: string;
  options: ProductResolutionOption[];

  constructor(reference: string, options: ProductResolutionOption[]) {
    super(`Encontré varias coincidencias para "${reference}".`);
    this.name = "ProductReferenceAmbiguityError";
    this.reference = reference;
    this.options = options;
  }
}

class PurchaseReferenceAmbiguityError extends Error {
  reference: string;
  options: PurchaseResolutionOption[];
  referencePath: ProductResolutionPathPart[];

  constructor(reference: string, options: PurchaseResolutionOption[], referencePath: ProductResolutionPathPart[]) {
    super(`Necesito elegir una compra para "${reference}".`);
    this.name = "PurchaseReferenceAmbiguityError";
    this.reference = reference;
    this.options = options;
    this.referencePath = referencePath;
  }
}

class MetaObjectReferenceAmbiguityError extends Error {
  reference: string;
  entityKind: "campaign" | "ad_set" | "ad";
  options: MetaObjectResolutionOption[];
  referencePath: ProductResolutionPathPart[];

  constructor(
    reference: string,
    entityKind: "campaign" | "ad_set" | "ad",
    options: MetaObjectResolutionOption[],
    referencePath: ProductResolutionPathPart[]
  ) {
    super(`Necesito elegir un ${entityKind} para "${reference}".`);
    this.name = "MetaObjectReferenceAmbiguityError";
    this.reference = reference;
    this.entityKind = entityKind;
    this.options = options;
    this.referencePath = referencePath;
  }
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function formatNumber(value: string | number | null | undefined) {
  if (value == null) {
    return "-";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatPercentValue(value: string | number | null) {
  if (value == null) {
    return "-";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return `${(numeric * 100).toFixed(2)}%`;
}

function buildDateRangeLabel(from?: string, to?: string) {
  if (from && to) {
    return `${from} → ${to}`;
  }

  return from || to || "";
}

export function formatOperatorError(error: unknown) {
  if (error instanceof z.ZodError) {
    const statusIssue = error.issues.find((issue) => issue.path.at(-1) === "status");
    if (statusIssue) {
      const issueText = statusIssue.message.toLowerCase();
      if (issueText.includes("active") || issueText.includes("paused")) {
        return 'No pude usar ese estado. Para Meta Ads usá "active" o "paused".';
      }

      return 'No pude usar ese estado. Probá con "in_stock", "reserved", "sold" o "damaged".';
    }

    return "No pude validar esa acción. Revisá los datos y probá de nuevo.";
  }

  if (error instanceof Error) {
    if (/^\s*\[/.test(error.message.trim())) {
      return "No pude validar esa acción. Revisá los datos y probá de nuevo.";
    }

    return error.message;
  }

  return "No pude preparar esa acción. Revisá la referencia y los campos.";
}

function normalizeMatch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildProductResolutionOptionLabel(option: ProductResolutionOption, index: number) {
  return `${index + 1}. ${option.title} · ${option.sku} · ${formatMoney(
    option.promo_price_ars ?? option.price_amount,
    option.currency_code
  )}`;
}

function buildPurchaseResolutionOptionLabel(option: PurchaseResolutionOption, index: number) {
  if (option.is_create_new) {
    return `${index + 1}. Crear compra nueva`;
  }

  return `${index + 1}. ${option.purchase_number} · ${option.supplier_name || "sin proveedor"} · ${option.status} · ${formatMoney(
    option.total_amount,
    option.currency_code
  )}`;
}

function buildProductResolutionReply(prompt: ProductResolutionPromptPayload): OperatorMessageResult {
  return {
    kind: "reply",
    text: [
      `Encontré ${prompt.options.length} opciones para "${prompt.reference}".`,
      ...prompt.options.map((option, index) => buildProductResolutionOptionLabel(option, index)),
      "Elegí una.",
    ].join("\n"),
    buttons: prompt.options.slice(0, 5).map((option, index) => [
      {
        text: `${index + 1}. ${option.title}`,
        callback_data: buildOperatorCallbackData("pick", option.sku),
      },
    ]),
  };
}

function buildPurchaseResolutionReply(prompt: PurchaseResolutionPromptPayload): OperatorMessageResult {
  return {
    kind: "reply",
    text: [
      `Elegí la compra para "${prompt.reference}" o creá una nueva.`,
      ...prompt.options.map((option, index) => buildPurchaseResolutionOptionLabel(option, index)),
      "Elegí una.",
    ].join("\n"),
    buttons: prompt.options.slice(0, 5).map((option, index) => [
      {
        text: option.is_create_new ? "Crear compra nueva" : `${index + 1}. ${option.purchase_number}`,
        callback_data: buildOperatorCallbackData(
          "pick",
          option.is_create_new ? "purchase:new" : `purchase:${option.purchase_number}`
        ),
      },
    ]),
  };
}

function buildMetaObjectResolutionOptionLabel(option: MetaObjectResolutionOption, index: number) {
  return `${index + 1}. ${option.name || option.id} · ${option.effective_status || option.status || "-"} · ${option.id}`;
}

function buildMetaObjectResolutionReply(prompt: MetaObjectResolutionPromptPayload): OperatorMessageResult {
  return {
    kind: "reply",
    text: [
      `Encontré ${prompt.options.length} opciones para "${prompt.reference}".`,
      ...prompt.options.map((option, index) => buildMetaObjectResolutionOptionLabel(option, index)),
      "Elegí una.",
    ].join("\n"),
    buttons: prompt.options.slice(0, 5).map((option, index) => [
      {
        text: `${index + 1}. ${option.name || option.id}`,
        callback_data: buildOperatorCallbackData("pick", `meta:${prompt.entity_kind}:${option.id}`),
      },
    ]),
  };
}

function getMetaEntityLabel(entityKind: "campaign" | "ad_set" | "ad") {
  switch (entityKind) {
    case "campaign":
      return "campaña";
    case "ad_set":
      return "ad set";
    case "ad":
      return "anuncio";
  }
}

function getMetaEntityLabelPlural(entityKind: "campaign" | "ad_set" | "ad") {
  switch (entityKind) {
    case "campaign":
      return "campañas";
    case "ad_set":
      return "ad sets";
    case "ad":
      return "anuncios";
  }
}

function formatMetaBudget(value: string | number | null | undefined) {
  if (value == null) {
    return "-";
  }

  return formatNumber(value);
}

function formatMetaObjectLine(row: MetaObjectRow) {
  const budget = row.daily_budget ?? row.lifetime_budget;
  return [
    `• ${row.name || row.id}`,
    row.effective_status || row.status || "-",
    budget != null ? `presupuesto ${formatMetaBudget(budget)}` : "",
    `id ${row.id}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function findProductReferencePaths(
  value: unknown,
  reference: string,
  path: ProductResolutionPathPart[] = []
): ProductResolutionPathPart[][] {
  const normalizedReference = normalizeMatch(reference);

  if (typeof value === "string" && normalizeMatch(value) === normalizedReference) {
    return [path];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findProductReferencePaths(item, reference, [...path, index]));
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    if (key !== "product_ref" && key !== "product_refs" && key !== "changes" && key !== "items") {
      return [];
    }

    return findProductReferencePaths(nestedValue, reference, [...path, key]);
  });
}

function findPurchaseReferencePaths(
  value: unknown,
  reference: string,
  path: ProductResolutionPathPart[] = []
): ProductResolutionPathPart[][] {
  const normalizedReference = normalizeMatch(reference);

  if (typeof value === "string" && normalizeMatch(value) === normalizedReference) {
    return [path];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findPurchaseReferencePaths(item, reference, [...path, index]));
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    if (key !== "inventory_purchase_ref" && key !== "changes") {
      return [];
    }

    return findPurchaseReferencePaths(nestedValue, reference, [...path, key]);
  });
}

function findMetaReferencePaths(
  value: unknown,
  reference: string,
  path: ProductResolutionPathPart[] = []
): ProductResolutionPathPart[][] {
  const normalizedReference = normalizeMatch(reference);

  if (typeof value === "string" && normalizeMatch(value) === normalizedReference) {
    return [path];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findMetaReferencePaths(item, reference, [...path, index]));
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    if (key !== "campaign_ref" && key !== "ad_set_ref" && key !== "ad_ref" && key !== "changes") {
      return [];
    }

    return findMetaReferencePaths(nestedValue, reference, [...path, key]);
  });
}

function setValueAtPath<T>(value: T, path: ProductResolutionPathPart[], replacement: string): T {
  if (path.length === 0) {
    return replacement as T;
  }

  const [head, ...tail] = path;

  if (Array.isArray(value) && typeof head === "number") {
    return value.map((item, index) => (index === head ? setValueAtPath(item, tail, replacement) : item)) as T;
  }

  if (isRecord(value) && typeof head === "string") {
    return {
      ...value,
      [head]: setValueAtPath(value[head], tail, replacement),
    } as T;
  }

  return value;
}

function extractOrdinalIndex(text: string) {
  const normalized = normalizeMatch(text);
  if (!normalized) {
    return null;
  }

  const digitMatch = normalized.match(/\b([1-9])\b/);
  if (digitMatch) {
    return Number(digitMatch[1]) - 1;
  }

  if (/\b(primero|primera|first|uno|1ro|1ero)\b/.test(normalized)) return 0;
  if (/\b(segundo|segunda|second|dos|2do|2da)\b/.test(normalized)) return 1;
  if (/\b(tercero|tercera|third|tres|3ro|3ra)\b/.test(normalized)) return 2;
  if (/\b(cuarto|cuarta|fourth|cuatro|4to|4ta)\b/.test(normalized)) return 3;
  if (/\b(quinto|quinta|fifth|cinco|5to|5ta)\b/.test(normalized)) return 4;

  return null;
}

function resolveProductSelectionFromPrompt(text: string, prompt: ProductResolutionPromptPayload) {
  const normalized = normalizeMatch(text.replace(/^__pick_product:/, "").replace(/__$/, ""));
  if (!normalized) {
    return null;
  }

  const ordinalIndex = extractOrdinalIndex(text);
  if (ordinalIndex != null && ordinalIndex >= 0 && ordinalIndex < prompt.options.length) {
    return prompt.options[ordinalIndex];
  }

  return (
    prompt.options.find((option) => normalizeMatch(option.sku) === normalized || normalizeMatch(option.slug) === normalized) ||
    prompt.options.find((option) => normalizeMatch(option.title) === normalized) ||
    prompt.options.find((option) => normalizeMatch(option.title).includes(normalized))
  );
}

function resolvePurchaseSelectionFromPrompt(text: string, prompt: PurchaseResolutionPromptPayload) {
  const normalized = normalizeMatch(text.replace(/^__pick_purchase:/, "").replace(/__$/, ""));
  if (!normalized) {
    return null;
  }

  const ordinalIndex = extractOrdinalIndex(text);
  if (ordinalIndex != null && ordinalIndex >= 0 && ordinalIndex < prompt.options.length) {
    return prompt.options[ordinalIndex];
  }

  return (
    prompt.options.find((option) => normalizeMatch(option.purchase_number) === normalized) ||
    (normalized === "new" || normalized === "crear compra nueva"
      ? prompt.options.find((option) => option.is_create_new)
      : null)
  );
}

function resolveMetaObjectSelectionFromPrompt(text: string, prompt: MetaObjectResolutionPromptPayload) {
  const normalized = normalizeMatch(text.replace(/^__pick_meta:/, "").replace(/__$/, ""));
  if (!normalized) {
    return null;
  }

  const ordinalIndex = extractOrdinalIndex(text);
  if (ordinalIndex != null && ordinalIndex >= 0 && ordinalIndex < prompt.options.length) {
    return prompt.options[ordinalIndex];
  }

  return (
    prompt.options.find((option) => normalizeMatch(`${option.entity_kind} ${option.id}`) === normalized) ||
    prompt.options.find((option) => normalizeMatch(option.id) === normalized) ||
    prompt.options.find((option) => normalizeMatch(option.name || "") === normalized) ||
    prompt.options.find((option) => normalizeMatch(option.name || "").includes(normalized))
  );
}

function buildPricingPreviewLines(fields: {
  price_amount?: number | string | null;
  promo_price_ars?: number | string | null;
  cost_usd?: number | string | null;
  logistics_usd?: number | string | null;
  total_cost_usd?: number | string | null;
  margin_pct?: number | string | null;
  price_usd?: number | string | null;
  usd_rate?: number | string | null;
  bancarizada_total?: number | string | null;
  bancarizada_cuota?: number | string | null;
  bancarizada_interest?: number | string | null;
  macro_total?: number | string | null;
  macro_cuota?: number | string | null;
  macro_interest?: number | string | null;
  cuotas_qty?: number | string | null;
}) {
  return [
    fields.cost_usd != null ? `• cost_usd: ${fields.cost_usd}` : "",
    fields.logistics_usd != null ? `• logistics_usd: ${fields.logistics_usd}` : "",
    fields.total_cost_usd != null ? `• total_cost_usd: ${fields.total_cost_usd}` : "",
    fields.margin_pct != null ? `• margin_pct: ${formatPercentValue(fields.margin_pct)}` : "",
    fields.price_usd != null ? `• price_usd: ${fields.price_usd}` : "",
    fields.usd_rate != null ? `• usd_rate: ${fields.usd_rate}` : "",
    fields.price_amount != null ? `• price_amount: ${formatMoney(fields.price_amount, "ARS")}` : "",
    fields.promo_price_ars != null ? `• promo_price_ars: ${formatMoney(fields.promo_price_ars, "ARS")}` : "",
    fields.cuotas_qty != null ? `• cuotas_qty: ${fields.cuotas_qty}` : "",
    fields.bancarizada_interest != null
      ? `• bancarizada: ${formatMoney(fields.bancarizada_total ?? null, "ARS")} total · ${formatMoney(
          fields.bancarizada_cuota ?? null,
          "ARS"
        )} x cuota · interés ${formatPercentValue(fields.bancarizada_interest)}`
      : "",
    fields.macro_interest != null
      ? `• macro: ${formatMoney(fields.macro_total ?? null, "ARS")} total · ${formatMoney(
          fields.macro_cuota ?? null,
          "ARS"
        )} x cuota · interés ${formatPercentValue(fields.macro_interest)}`
      : "",
  ].filter(Boolean);
}

function asFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function roundAmount(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildFunderSummaryLines(funders: Array<Record<string, unknown>> | undefined) {
  return (funders || []).map((funder) => {
    const amount = asFiniteNumber(funder.amount_amount);
    const currencyCode =
      typeof funder.currency_code === "string" && funder.currency_code.trim() ? funder.currency_code.trim() : "USD";
    const sharePct = asFiniteNumber(funder.share_pct);

    return `• ${String(funder.funder_name || "sin nombre")}${
      funder.payment_method ? ` · ${String(funder.payment_method)}` : ""
    }${amount != null ? ` · ${formatMoney(amount, currencyCode)}` : ""}${
      sharePct != null ? ` · ${(sharePct * 100).toFixed(2)}%` : ""
    }`;
  });
}

function buildPurchaseSummaryLines(purchase: InventoryPurchaseRow | Record<string, unknown>) {
  return [
    `• Compra: ${String(purchase.purchase_number)}`,
    `• Estado: ${String(purchase.status)}`,
    purchase.supplier_name ? `• Proveedor: ${String(purchase.supplier_name)}` : "",
    purchase.total_amount != null ? `• Total: ${formatMoney(purchase.total_amount as string | number, String(purchase.currency_code || "USD"))}` : "",
    purchase.acquired_at ? `• Fecha: ${String(purchase.acquired_at)}` : "",
  ].filter(Boolean);
}

function buildStockCandidateLabel(candidate: ExtractedStockCandidate, index: number) {
  return `• ${index + 1}. ${candidate.imei_1 || candidate.imei_2 || candidate.serial_number || "sin identificador"}${
    candidate.imei_2 ? ` / ${candidate.imei_2}` : ""
  }${candidate.serial_number ? ` · serial ${candidate.serial_number}` : ""}`;
}

function buildImageBatchSummaryLines(candidates: ExtractedStockCandidate[], warnings: string[], maxPreview = 8) {
  return [
    `• Unidades detectadas: ${candidates.length}`,
    ...candidates.slice(0, maxPreview).map((candidate, index) => buildStockCandidateLabel(candidate, index)),
    candidates.length > maxPreview ? `• … y ${candidates.length - maxPreview} más.` : "",
    warnings.length > 0 ? "• Advertencias OCR:" : "",
    ...warnings.slice(0, 5).map((warning) => `  - ${warning}`),
    warnings.length > 5 ? `  - … y ${warnings.length - 5} más.` : "",
  ].filter(Boolean);
}

async function getRecentImageBatchOrThrow(actor: ActorContext) {
  if (!actor.conversationId) {
    throw new Error("No pude asociar estas imágenes a una conversación activa.");
  }

  const extracted = await extractStockCandidatesFromRecentImages(actor.conversationId, 20);
  if (extracted.images.length === 0) {
    throw new Error("No encontré imágenes recientes en este chat. Mandame las fotos y después pedime la acción.");
  }

  if (extracted.candidates.length === 0) {
    throw new Error("No pude extraer IMEIs o seriales válidos de las imágenes recientes.");
  }

  return extracted;
}

async function findExistingStockMatches(candidates: ExtractedStockCandidate[]) {
  const imeis = Array.from(
    new Set(
      candidates.flatMap((candidate) => [candidate.imei_1, candidate.imei_2]).filter((value): value is string => Boolean(value))
    )
  );
  const serials = Array.from(
    new Set(candidates.map((candidate) => candidate.serial_number).filter((value): value is string => Boolean(value)))
  );

  if (imeis.length === 0 && serials.length === 0) {
    return [] as ExistingStockMatchRow[];
  }

  return query<ExistingStockMatchRow>(
    `
      select su.id, su.product_id, su.serial_number, su.imei_1, su.imei_2, su.status, su.location_code, p.sku, p.title
      from public.stock_units su
      join public.products p on p.id = su.product_id
      where
        (${imeis.length > 0 ? `(su.imei_1 = any($1::text[]) or su.imei_2 = any($1::text[]))` : "false"})
        or (${serials.length > 0 ? `coalesce(su.serial_number, '') = any($2::text[])` : "false"})
      order by su.id asc
    `,
    [imeis, serials]
  );
}

async function assertNoExistingStockConflicts(candidates: ExtractedStockCandidate[]) {
  const existing = await findExistingStockMatches(candidates);
  if (existing.length === 0) {
    return;
  }

  throw new Error(
    `Ya existen unidades con esos identificadores: ${existing
      .slice(0, 10)
      .map((row) => `#${row.id} ${row.sku} ${row.imei_1 || row.imei_2 || row.serial_number || ""}`.trim())
      .join(" | ")}`
  );
}

async function resolveStockMatchesFromCandidates(candidates: ExtractedStockCandidate[]) {
  const existing = await findExistingStockMatches(candidates);
  const byIdentifier = new Map<string, ExistingStockMatchRow>();

  for (const row of existing) {
    [row.imei_1, row.imei_2, row.serial_number]
      .filter((value): value is string => Boolean(value))
      .forEach((value) => byIdentifier.set(value, row));
  }

  const matches = new Map<number, ExistingStockMatchRow & { source_candidates: ExtractedStockCandidate[] }>();
  const unmatched: ExtractedStockCandidate[] = [];

  for (const candidate of candidates) {
    const identifiers = [candidate.imei_1, candidate.imei_2, candidate.serial_number].filter(
      (value): value is string => Boolean(value)
    );
    const matched = identifiers.map((identifier) => byIdentifier.get(identifier)).find(Boolean) ?? null;

    if (!matched) {
      unmatched.push(candidate);
      continue;
    }

    const current = matches.get(matched.id);
    if (current) {
      current.source_candidates.push(candidate);
      continue;
    }

    matches.set(matched.id, {
      ...matched,
      source_candidates: [candidate],
    });
  }

  return {
    matches: Array.from(matches.values()),
    unmatched,
  };
}

async function loadProductPricingState(productId: number) {
  const rows = await query<Record<string, unknown>>(
    `
      select
        id,
        sku,
        title,
        cost_usd,
        logistics_usd,
        total_cost_usd,
        margin_pct,
        price_usd,
        usd_rate,
        price_amount,
        promo_price_ars,
        bancarizada_interest,
        bancarizada_total,
        bancarizada_cuota,
        macro_interest,
        macro_total,
        macro_cuota,
        cuotas_qty
      from public.products
      where id = $1
      limit 1
    `,
    [productId]
  );

  return rows[0] ?? null;
}

function toPreviewValue(value: unknown): string | number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return JSON.stringify(value);
}

function toPricingCarrierValue(value: unknown): string | number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return null;
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

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (/^\d+[a-z]$/i.test(token)) {
        return token.toUpperCase();
      }
      if (/^(5g|4g|wifi|jbl|poco)$/i.test(token)) {
        return token.toUpperCase() === "WIFI" ? "WiFi" : token.toUpperCase();
      }
      if (/^(iphone)$/i.test(token)) {
        return "iPhone";
      }
      if (/^(redmi|xiaomi|motorola|lenovo|samsung|apple|charge|flip|boombox|edge|pad|note)$/i.test(token)) {
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
      }
      if (/^fe$/i.test(token)) {
        return "FE";
      }
      if (/^(max|plus|ultra|pro)$/i.test(token)) {
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");
}

function normalizeCatalogSyncName(value: string) {
  return value
    .replace(/\bxaomi\b/gi, "Xiaomi")
    .replace(/\bsamsug\b/gi, "Samsung")
    .replace(/\bedgue\b/gi, "Edge")
    .replace(/\bchargue\b/gi, "Charge")
    .replace(/\bflips\b/gi, "Flip")
    .replace(/\bbombox\b/gi, "Boombox")
    .replace(/\bpad8\b/gi, "Pad 8")
    .replace(/\b15\s+c\b/gi, "15C")
    .replace(/\b([asg])\s+(\d{2,3})\b/gi, (_, prefix: string, digits: string) => `${prefix.toUpperCase()}${digits}`)
    .replace(/\bg\s+(\d{2,3})\b/gi, (_, digits: string) => `G${digits}`)
    .replace(/\bpro\s*\+\s*/gi, "Pro+ ")
    .replace(/\bwi[\s-]*fi\b/gi, "WiFi")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCatalogSpecs(value: string) {
  const normalized = normalizeCatalogSyncName(value);
  const pairMatch = normalized.match(/(\d{1,2})\s*(?:gb)?\s*(?:\/|\+)\s*(\d{2,4})\s*(?:gb)?/i);
  const ramGb = pairMatch ? Number(pairMatch[1]) : null;
  const storageFromPair = pairMatch ? Number(pairMatch[2]) : null;
  const standaloneStorageMatch = normalized.match(/(?:^|\s)(64|128|256|512|1024)(?:\s*gb)?(?:\s|$)/i);
  const storageGb = storageFromPair ?? (standaloneStorageMatch ? Number(standaloneStorageMatch[1]) : null);
  const networkMatch = normalized.match(/\b(4g|5g)\b/i);
  const colorMatch = normalized.match(/\b(blanco|blanca|white|naranja|orange|azul|blue|negro|negra|black|gris|gray|silver|plata)\b/i);
  return {
    ramGb,
    storageGb,
    network: networkMatch ? networkMatch[1].toUpperCase() : null,
    color: colorMatch ? titleCaseWords(colorMatch[1]) : null,
  };
}

function buildCatalogDescription(specs: {
  ramGb: number | null;
  storageGb: number | null;
  network: string | null;
  color: string | null;
}) {
  const bits: string[] = [];
  if (specs.ramGb != null) bits.push(`${specs.ramGb}GB RAM`);
  if (specs.storageGb != null) bits.push(`${specs.storageGb}GB`);
  if (specs.network) bits.push(specs.network);
  if (specs.color) bits.push(specs.color);
  return bits.length > 0 ? bits.join(", ") : null;
}

function canonicalizeCatalogSyncSection(line: string): { key: CatalogSyncSectionKey; label: string } | null {
  const normalized = normalizeMatch(line).replace(/\//g, " ");
  if (/(xiaomi|redmi|poco)/.test(normalized)) return { key: "xiaomi_redmi_poco", label: "XIAOMI/REDMI/POCO" };
  if (/\bsamsung\b/.test(normalized)) return { key: "samsung", label: "SAMSUNG" };
  if (/\b(phone|iphone)\b/.test(normalized)) return { key: "phone", label: "PHONE" };
  if (/\btablet\b/.test(normalized)) return { key: "tablet", label: "TABLET" };
  if (/\b(motorola|moto)\b/.test(normalized)) return { key: "motorola", label: "MOTOROLA" };
  if (/\b(jbl|parlantes)\b/.test(normalized)) return { key: "jbl", label: "PARLANTES JBL" };
  return null;
}

function buildCatalogSyncTokens(value: string) {
  return normalizeMatch(value)
    .replace(/\bpro\+\b/g, "pro plus")
    .replace(/\bwi[\s-]*fi\b/g, "wifi")
    .replace(/\bgb\b/g, " ")
    .replace(/[/+]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function buildColorlessCatalogKey(value: string) {
  return buildCatalogSyncTokens(value)
    .filter((token) => !catalogSyncColorTokens.has(token))
    .join(" ");
}

function detectCatalogTierTokens(value: string) {
  const normalized = normalizeMatch(value).replace(/\bpro\+\b/g, "pro plus");
  const tiers: string[] = [];
  if (/\bpro max\b/.test(normalized)) tiers.push("pro", "max");
  else {
    if (/\bpro\b/.test(normalized)) tiers.push("pro");
    if (/\bmax\b/.test(normalized)) tiers.push("max");
  }
  if (/\bplus\b/.test(normalized)) tiers.push("plus");
  if (/\bultra\b/.test(normalized)) tiers.push("ultra");
  if (/\bfe\b/.test(normalized)) tiers.push("fe");
  return Array.from(new Set(tiers));
}

function buildCatalogCategory(sectionKey: CatalogSyncSectionKey, brand: string) {
  switch (sectionKey) {
    case "phone":
      return "IPHONE";
    case "samsung":
      return "SAMSUNG";
    case "xiaomi_redmi_poco":
      return "REDMI/POCO";
    case "tablet":
      return "TABLET";
    case "motorola":
      return "MOTOROLA";
    case "jbl":
      return "AUDIO";
    default:
      return brand.toUpperCase();
  }
}

function buildAppleCatalogDraft(rawName: string) {
  const normalized = normalizeCatalogSyncName(rawName);
  const specs = extractCatalogSpecs(normalized);
  const familyMatch = normalized.match(/\b(13|14|15|16|17)\b/);
  if (!familyMatch) {
    throw new Error(`No pude leer la familia del iPhone en "${rawName}".`);
  }
  const family = familyMatch[1];
  const lower = normalizeMatch(normalized);
  const tier = /\bpro max\b/.test(lower) ? "Pro Max" : /\bpro\b/.test(lower) ? "Pro" : /\bplus\b/.test(lower) ? "Plus" : "";
  const model = `iPhone ${family}${tier ? ` ${tier}` : ""}`;
  const title = `${model}${specs.storageGb != null ? ` ${specs.storageGb}GB` : ""}${specs.color ? ` ${specs.color}` : ""}`;
  const skuParts = ["iphone", family];
  if (tier) skuParts.push(...slugify(tier).split("-"));
  if (specs.storageGb != null) skuParts.push(String(specs.storageGb));
  if (specs.color) skuParts.push(slugify(specs.color));
  return {
    brand: "Apple",
    model,
    title,
    sku: skuParts.join("-"),
    specs: { ...specs, ramGb: null },
  };
}

function buildSamsungCatalogDraft(rawName: string) {
  const normalized = normalizeCatalogSyncName(rawName).replace(/^Samsung\s+/i, "");
  const specs = extractCatalogSpecs(normalized);
  const modelSource = normalized
    .replace(/(\d{1,2})\s*(?:gb)?\s*(?:\/|\+)\s*(\d{2,4})\s*(?:gb)?/i, " ")
    .replace(/\b(64|128|256|512|1024)\s*gb?\b/i, " ")
    .replace(/\b(4g|5g)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const modelDisplay = titleCaseWords(modelSource);
  const title = `Samsung ${modelDisplay}${specs.network ? ` ${specs.network}` : ""}${
    specs.ramGb != null && specs.storageGb != null ? ` ${specs.ramGb}GB/${specs.storageGb}GB` : specs.storageGb != null ? ` ${specs.storageGb}GB` : ""
  }`;
  const skuParts = ["samsung", ...slugify(modelDisplay).split("-")];
  if (specs.network) skuParts.push(specs.network.toLowerCase());
  if (specs.ramGb != null) skuParts.push(String(specs.ramGb));
  if (specs.storageGb != null) skuParts.push(String(specs.storageGb));
  return {
    brand: "Samsung",
    model: `Galaxy ${modelDisplay}`,
    title,
    sku: skuParts.join("-"),
    specs,
  };
}

function buildXiaomiCatalogDraft(rawName: string) {
  const normalized = normalizeCatalogSyncName(rawName);
  const specs = extractCatalogSpecs(normalized);
  const lower = normalizeMatch(normalized);
  const brand = /^xiaomi\b/i.test(normalized)
    ? "Xiaomi"
    : /^redmi\b/i.test(normalized)
      ? "Redmi"
      : /^poco\b/i.test(normalized) || /^[xf]\d{1,2}\b/i.test(normalized)
        ? "POCO"
        : /^note\b/i.test(normalized) || /^a\d{1,2}\b/i.test(normalized) || /^\d{2}c\b/i.test(lower)
          ? "Redmi"
          : "Xiaomi";
  const withoutBrand = normalized.replace(/^(xiaomi|redmi|poco)\s+/i, "").trim();
  const modelSource = withoutBrand
    .replace(/(\d{1,2})\s*(?:gb)?\s*(?:\/|\+)\s*(\d{2,4})\s*(?:gb)?/i, " ")
    .replace(/\b(64|128|256|512|1024)\s*gb?\b/i, " ")
    .replace(/\b(4g|5g)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bpro plus\b/i, "Pro+");
  const modelDisplay = titleCaseWords(modelSource.replace(/\b15c\b/i, "15C"));
  const title = `${brand === "POCO" ? "Poco" : brand} ${modelDisplay}${specs.network ? ` ${specs.network}` : ""}${
    specs.ramGb != null && specs.storageGb != null ? ` ${specs.ramGb}GB/${specs.storageGb}GB` : specs.storageGb != null ? ` ${specs.storageGb}GB` : ""
  }`;
  const skuParts = [slugify(brand), ...slugify(modelDisplay).split("-")];
  if (specs.network) skuParts.push(specs.network.toLowerCase());
  if (specs.ramGb != null) skuParts.push(String(specs.ramGb));
  if (specs.storageGb != null) skuParts.push(String(specs.storageGb));
  return {
    brand,
    model: modelDisplay,
    title,
    sku: skuParts.join("-"),
    specs,
  };
}

function buildTabletCatalogDraft(rawName: string) {
  const normalized = normalizeCatalogSyncName(rawName);
  const specs = extractCatalogSpecs(normalized);
  const brand = /^xiaomi\b/i.test(normalized)
    ? "Xiaomi"
    : /^lenovo\b/i.test(normalized)
      ? "Lenovo"
      : /^samsung\b/i.test(normalized)
        ? "Samsung"
        : inferBrand(normalized);
  const withoutBrand = normalized.replace(new RegExp(`^${brand}\\s+`, "i"), "").trim();
  const modelSource = withoutBrand
    .replace(/(\d{1,2})\s*(?:gb)?\s*(?:\/|\+)\s*(\d{2,4})\s*(?:gb)?/i, " ")
    .replace(/\b(64|128|256|512|1024)\s*gb?\b/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const modelDisplay = titleCaseWords(modelSource);
  const title = `${brand} ${modelDisplay}${
    specs.ramGb != null && specs.storageGb != null ? ` ${specs.ramGb}GB/${specs.storageGb}GB` : specs.storageGb != null ? ` ${specs.storageGb}GB` : ""
  }`;
  const skuParts = [slugify(brand), ...slugify(modelDisplay).split("-")];
  if (specs.ramGb != null) skuParts.push(String(specs.ramGb));
  if (specs.storageGb != null) skuParts.push(String(specs.storageGb));
  return {
    brand,
    model: modelDisplay,
    title,
    sku: skuParts.join("-"),
    specs,
  };
}

function buildMotorolaCatalogDraft(rawName: string) {
  const normalized = normalizeCatalogSyncName(rawName).replace(/^Motorola\s+/i, "");
  const specs = extractCatalogSpecs(normalized);
  const modelSource = normalized
    .replace(/(\d{1,2})\s*(?:gb)?\s*(?:\/|\+)\s*(\d{2,4})\s*(?:gb)?/i, " ")
    .replace(/\b(64|128|256|512|1024)\s*gb?\b/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const modelDisplay = titleCaseWords(modelSource);
  const title = `Motorola ${modelDisplay}${
    specs.ramGb != null && specs.storageGb != null ? ` ${specs.ramGb}GB/${specs.storageGb}GB` : specs.storageGb != null ? ` ${specs.storageGb}GB` : ""
  }`;
  const skuParts = ["motorola", ...slugify(modelDisplay).split("-")];
  if (specs.ramGb != null) skuParts.push(String(specs.ramGb));
  if (specs.storageGb != null) skuParts.push(String(specs.storageGb));
  return {
    brand: "Motorola",
    model: modelDisplay,
    title,
    sku: skuParts.join("-"),
    specs,
  };
}

function buildJblCatalogDraft(rawName: string) {
  const normalized = normalizeCatalogSyncName(rawName).replace(/^JBL\s+/i, "");
  const modelDisplay = titleCaseWords(normalized.replace(/\bWi Fi\b/g, "WiFi"));
  const title = `JBL ${modelDisplay}`;
  return {
    brand: "JBL",
    model: modelDisplay,
    title,
    sku: ["jbl", ...slugify(modelDisplay).split("-")].join("-"),
    specs: { ramGb: null, storageGb: null, network: null, color: null },
  };
}

function buildCatalogSyncDraftItem(
  sectionKey: CatalogSyncSectionKey,
  sectionLabel: string,
  rawName: string,
  costUsd: number,
  lineNumber: number,
  defaults: { active: boolean; inStock: boolean; condition: (typeof productConditionValues)[number] }
): CatalogSyncDraftItem {
  const bySection =
    sectionKey === "phone"
      ? buildAppleCatalogDraft(rawName)
      : sectionKey === "samsung"
        ? buildSamsungCatalogDraft(rawName)
        : sectionKey === "xiaomi_redmi_poco"
          ? buildXiaomiCatalogDraft(rawName)
          : sectionKey === "tablet"
            ? buildTabletCatalogDraft(rawName)
            : sectionKey === "motorola"
              ? buildMotorolaCatalogDraft(rawName)
              : buildJblCatalogDraft(rawName);
  const slug = slugify(bySection.sku);
  return {
    sectionKey,
    sectionLabel,
    rawName,
    costUsd,
    lineNumber,
    title: bySection.title,
    brand: bySection.brand,
    model: bySection.model,
    sku: slug,
    slug,
    category: buildCatalogCategory(sectionKey, bySection.brand),
    condition: defaults.condition,
    active: defaults.active,
    inStock: defaults.inStock,
    ramGb: bySection.specs.ramGb,
    storageGb: bySection.specs.storageGb,
    network: bySection.specs.network,
    color: bySection.specs.color,
    description: buildCatalogDescription(bySection.specs),
    normalizedTitle: normalizeMatch(bySection.title),
    colorlessTitle: buildColorlessCatalogKey(bySection.title),
    requiredTokens: buildCatalogSyncTokens(bySection.title),
    tierTokens: detectCatalogTierTokens(bySection.title),
  };
}

function parseCatalogSyncPriceList(
  rawList: string,
  defaults: { active: boolean; inStock: boolean; condition: (typeof productConditionValues)[number] }
) {
  const lines = rawList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: CatalogSyncDraftItem[] = [];
  let currentSection: { key: CatalogSyncSectionKey; label: string } | null = null;

  for (const [index, line] of lines.entries()) {
    const section = canonicalizeCatalogSyncSection(line);
    if (section) {
      currentSection = section;
      continue;
    }

    const match = line.match(/^(.*)\s*[-–—]\s*([0-9]+(?:[.,][0-9]+)?)\s*usd\s*$/i);
    if (!match) {
      continue;
    }

    if (!currentSection) {
      throw new Error(`La línea ${index + 1} tiene precio USD pero no tiene sección arriba: "${line}".`);
    }

    const rawName = match[1].trim();
    const costUsd = Number(match[2].replace(",", "."));
    if (!Number.isFinite(costUsd)) {
      throw new Error(`No pude leer el cost_usd de la línea ${index + 1}: "${line}".`);
    }

    items.push(buildCatalogSyncDraftItem(currentSection.key, currentSection.label, rawName, costUsd, index + 1, defaults));
  }

  if (items.length === 0) {
    throw new Error("No encontré líneas del tipo “Producto - 123 USD” en el mensaje.");
  }

  return items;
}

function buildCatalogRowTokens(product: CatalogSyncProductRow) {
  return new Set(buildCatalogSyncTokens([product.brand, product.model, product.title, product.sku, product.slug].join(" ")));
}

function scoreCatalogSyncMatch(item: CatalogSyncDraftItem, product: CatalogSyncProductRow) {
  const rowTokens = buildCatalogRowTokens(product);
  if (!rowTokens.has(normalizeMatch(item.brand).split(" ")[0])) {
    if (!(item.brand === "Apple" && rowTokens.has("iphone"))) return Number.NEGATIVE_INFINITY;
  }

  for (const token of item.requiredTokens) {
    if (!rowTokens.has(token)) {
      return Number.NEGATIVE_INFINITY;
    }
  }

  const normalizedTitle = normalizeMatch(product.title);
  const colorlessTitle = buildColorlessCatalogKey(product.title);
  const candidateTiers = detectCatalogTierTokens(product.title);
  const itemHasColor = item.color != null;
  const productHasEconomyToken = buildCatalogSyncTokens(product.title).some((token) => catalogSyncEconomyTokens.has(token));
  const itemHasEconomyToken = item.requiredTokens.some((token) => catalogSyncEconomyTokens.has(token));
  let score = item.requiredTokens.length * 12;

  if (normalizedTitle === item.normalizedTitle) score += 40;
  if (colorlessTitle === item.colorlessTitle) score += 24;
  if (normalizeMatch(product.sku) === normalizeMatch(item.sku)) score += 60;
  if (item.brand === "Apple" && item.tierTokens.length === 0 && candidateTiers.length > 0) score -= 30;
  if (!itemHasEconomyToken && productHasEconomyToken) score -= 30;
  if (!itemHasColor && buildCatalogSyncTokens(product.title).some((token) => catalogSyncColorTokens.has(token))) score -= 4;
  if (item.network == null && /\b(4g|5g)\b/i.test(product.title)) score -= 2;
  if (item.ramGb == null && /\b\d{1,2}gb\/\d{2,4}gb\b/i.test(product.title)) score -= 2;

  return score;
}

async function loadCatalogSyncProducts() {
  return query<CatalogSyncProductRow>(
    `
      select
        id,
        sku,
        slug,
        brand,
        model,
        title,
        active,
        price_amount,
        promo_price_ars,
        currency_code,
        image_url,
        ram_gb,
        storage_gb,
        cost_usd
      from public.products
      order by active desc, updated_at desc, id desc
    `
  );
}

function resolveCatalogSyncMatches(item: CatalogSyncDraftItem, products: CatalogSyncProductRow[]) {
  const scored = products
    .map((product) => ({ product, score: scoreCatalogSyncMatch(item, product) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0 || scored[0].score < 22) {
    return { kind: "missing" as const };
  }

  const topScore = scored[0].score;
  const nearTop = scored.filter((entry) => topScore - entry.score <= 10);
  if (nearTop.length === 1) {
    return { kind: "matched" as const, products: [nearTop[0].product] };
  }

  const itemSkuNorm = normalizeMatch(item.sku);
  const skuHit = nearTop.find(
    (entry) =>
      normalizeMatch(entry.product.sku) === itemSkuNorm || normalizeMatch(entry.product.slug ?? "") === itemSkuNorm
  );
  if (skuHit) {
    return { kind: "matched" as const, products: [skuHit.product] };
  }

  const colorlessKeys = new Set(nearTop.map((entry) => buildColorlessCatalogKey(entry.product.title)));
  if (item.color == null && colorlessKeys.size === 1) {
    return { kind: "matched" as const, products: nearTop.map((entry) => entry.product) };
  }

  return { kind: "ambiguous" as const, products: nearTop.map((entry) => entry.product) };
}

function limitCatalogSyncSummary(lines: string[], maxLines = 18) {
  if (lines.length <= maxLines) {
    return lines;
  }
  return [...lines.slice(0, maxLines), `• ... y ${lines.length - maxLines} líneas más`];
}

function buildToken() {
  return randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

function buildOperatorCallbackData(kind: "approve" | "cancel" | "edit" | "menu" | "pick", value: string) {
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
  | "purchases"
  | "settings"
  | "reports"
  | "products_list_help"
  | "products_create_help"
  | "products_update_help"
  | "products_bulk_reprice_help"
  | "products_bulk_sync_help"
  | "products_delete_help"
  | "stock_list_help"
  | "stock_create_help"
  | "stock_from_images_help"
  | "stock_update_help"
  | "stock_mark_from_images_help"
  | "stock_delete_help"
  | "purchases_list_help"
  | "purchases_create_help"
  | "settings_update_help"
  | "settings_list_help"
  | "report_sold_last_30d"
  | "report_in_stock"
  | "report_missing_images";

function parseSyntheticMenuIntent(text: string): MenuIntent | null {
  const match = text.trim().match(/^__menu:([a-z0-9_]+)__$/i);
  return (match?.[1] as MenuIntent | undefined) ?? null;
}

function parseWorkflowHelpIntent(text: string): MenuIntent | null {
  const trimmed = text.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (/(como|cómo|ayuda|explicame|explícame).*(crear|cargar).*(stock|inventario|unidad)/i.test(trimmed)) {
    return /(foto|fotos|imagen|imagenes|im[áa]genes|imei)/i.test(trimmed) ? "stock_from_images_help" : "stock_create_help";
  }

  if (/(como|cómo|ayuda|explicame|explícame).*(crear).*(compra|purchase)/i.test(trimmed)) {
    return "purchases_create_help";
  }

  if (/(como|cómo|ayuda|explicame|explícame).*(actualizar|cambiar|subir|bajar).*(costo|costos|precio|precios)/i.test(trimmed)) {
    return "products_bulk_reprice_help";
  }

  return null;
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

  if (/^(compras?|purchase|purchases|proveedores?)\W*$/i.test(trimmed)) {
    return "purchases";
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
        text: "¿Qué querés hacer? También podés escribir directo cosas como “actualizá esta lista de costos”, “cargá stock con estas fotos” o “marcá estas unidades como vendidas”.",
        buttons: [
          [
            { text: "Productos", callback_data: buildOperatorCallbackData("menu", "products") },
            { text: "Stock", callback_data: buildOperatorCallbackData("menu", "stock") },
          ],
          [
            { text: "Compras", callback_data: buildOperatorCallbackData("menu", "purchases") },
            { text: "Settings", callback_data: buildOperatorCallbackData("menu", "settings") },
          ],
          [
            { text: "Reportes", callback_data: buildOperatorCallbackData("menu", "reports") },
          ],
        ],
      };
    case "products":
      return {
        text: "Productos. ¿Qué querés hacer?",
        buttons: [
          [
            { text: "Listar / filtrar", callback_data: buildOperatorCallbackData("menu", "products_list_help") },
            { text: "Crear", callback_data: buildOperatorCallbackData("menu", "products_create_help") },
          ],
          [
            { text: "Lista USD (sync)", callback_data: buildOperatorCallbackData("menu", "products_bulk_sync_help") },
            { text: "Repricing SKU", callback_data: buildOperatorCallbackData("menu", "products_bulk_reprice_help") },
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
        text: "Stock. ¿Qué querés hacer?",
        buttons: [
          [
            { text: "Listar / filtrar", callback_data: buildOperatorCallbackData("menu", "stock_list_help") },
            { text: "Crear", callback_data: buildOperatorCallbackData("menu", "stock_create_help") },
          ],
          [
            { text: "Cargar con fotos", callback_data: buildOperatorCallbackData("menu", "stock_from_images_help") },
            { text: "Editar", callback_data: buildOperatorCallbackData("menu", "stock_update_help") },
          ],
          [
            { text: "Marcar por fotos", callback_data: buildOperatorCallbackData("menu", "stock_mark_from_images_help") },
            { text: "Borrar", callback_data: buildOperatorCallbackData("menu", "stock_delete_help") },
          ],
          [{ text: "Inicio", callback_data: buildOperatorCallbackData("menu", "home") }],
        ],
      };
    case "purchases":
      return {
        text: "Compras. ¿Qué querés hacer?",
        buttons: [
          [
            { text: "Listar", callback_data: buildOperatorCallbackData("menu", "purchases_list_help") },
            { text: "Crear", callback_data: buildOperatorCallbackData("menu", "purchases_create_help") },
          ],
          [{ text: "Inicio", callback_data: buildOperatorCallbackData("menu", "home") }],
        ],
      };
    case "settings":
      return {
        text: "Settings. ¿Qué querés hacer?",
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
        text: "Reportes rápidos.",
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
        text: "Decime qué querés listar. Ejemplos: “listá Samsung entre 400000 y 900000”, “mostrá Apple activos con stock”, “buscá A56 8/256”.",
      };
    case "products_create_help":
      return {
        text: "Para crear un producto necesito al menos SKU y título. Si mandás una foto, la uso como imagen. Ejemplo: “crear producto sku samsung-a56-5g-8-256 titulo Samsung A56 5G 8/256 promo 589000”.",
      };
    case "products_update_help":
      return {
        text: "Decime el producto y el cambio. Si hay varias coincidencias, te muestro opciones para elegir.",
      };
    case "products_bulk_reprice_help":
      return {
        text:
          "Repricing por SKU conocido: una línea por producto con referencia y costo USD. Si pegás una lista de proveedor con rubros (XIAOMI, SAMSUNG, PHONE…) y líneas “Producto - 123 USD”, usá el botón “Lista USD (sync)”: el servidor matchea, crea faltantes y recalcula ARS.",
      };
    case "products_bulk_sync_help":
      return {
        text:
          "Pegá la lista con títulos de rubro (ej: XIAOMI/REDMI/POCO, SAMSUNG, PHONE, TABLET, MOTOROLA, PARLANTES JBL) y debajo líneas “Nombre del equipo - 123 USD” (una por fila). El bot detecta el pegado solo y prepara sync masivo (crear faltantes + actualizar costos). Si algo queda ambiguo te aviso antes de ejecutar.",
        buttons: [[{ text: "Volver a Productos", callback_data: buildOperatorCallbackData("menu", "products") }]],
      };
    case "products_delete_help":
      return {
        text:
          "Podés pedirme archivar o borrar un producto. Si querés borrarlo de verdad, decilo explícito. Si tiene stock, no lo borro; en ese caso conviene archivarlo. Los checkout intents del storefront se limpian automáticamente.",
      };
    case "stock_list_help":
      return {
        text: "Podés filtrar por estado, marca, producto, ubicación o fechas. Ejemplos: “listá stock vendido el último mes”, “mostrá stock Samsung en SALTA”, “buscá imei 356...”.",
      };
    case "stock_create_help":
      return {
        text:
          "Para crear stock necesito producto + compra. Si ya mandaste fotos con IMEI, usá “cargá stock con estas fotos”. Si es manual, decime producto, compra e IMEI/serial y yo preparo todo.",
        buttons: [
          [
            { text: "Cargar con fotos", callback_data: buildOperatorCallbackData("menu", "stock_from_images_help") },
            { text: "Crear compra", callback_data: buildOperatorCallbackData("menu", "purchases_create_help") },
          ],
          [{ text: "Volver a Stock", callback_data: buildOperatorCallbackData("menu", "stock") }],
        ],
      };
    case "stock_from_images_help":
      return {
        text:
          "Mandame las fotos con IMEI y después decime “cargá stock del iPhone 17 Pro Max con estas fotos”. Siempre las voy a vincular a una compra existente o te hago elegir / crear una.",
        buttons: [
          [
            { text: "Crear compra", callback_data: buildOperatorCallbackData("menu", "purchases_create_help") },
            { text: "Volver a Stock", callback_data: buildOperatorCallbackData("menu", "stock") },
          ],
        ],
      };
    case "stock_update_help":
      return {
        text: "Podés cambiar estado, ubicación, IMEI, serial o costo. Ejemplos: “marcá como sold el imei 356...”, “mové el stock 44 a SALTA”.",
      };
    case "stock_mark_from_images_help":
      return {
        text: "Mandame las fotos de IMEI y después pedime “marcá estas unidades como vendidas” o “pasá estas unidades a reserved”.",
      };
    case "stock_delete_help":
      return {
        text:
          "Para borrar una unidad, decime la referencia exacta. Por seguridad no borro stock vendido.",
      };
    case "purchases_list_help":
      return {
        text: "Podés pedirme compras por proveedor, estado o número. Ejemplos: “listá compras received”, “mostrá compras de Juan” o “detalle de la compra PUR-AB12CD34”.",
      };
    case "purchases_create_help":
      return {
        text:
          "Podés crear una compra sola o compra + stock desde fotos. Si ya tenés imágenes, mandame algo como: “registrá compra desde estas imágenes, 10 iPhone 17 Pro Max, total 5000 USD, Fran 50% cash y Agus 50% crypto”.",
        buttons: [
          [
            { text: "Crear con fotos", callback_data: buildOperatorCallbackData("menu", "stock_from_images_help") },
            { text: "Volver a Compras", callback_data: buildOperatorCallbackData("menu", "purchases") },
          ],
        ],
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
  const [inventoryPurchases] = await query<{ count: string }>("select count(*)::text as count from public.inventory_purchases");
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
  const recentImageBatchCount = await countRecentTelegramImageBatch();

  return {
    counts: {
      products: Number(products?.count ?? 0),
      stock: Number(stock?.count ?? 0),
      customers: Number(customers?.count ?? 0),
      orders: Number(orders?.count ?? 0),
      inventoryPurchases: Number(inventoryPurchases?.count ?? 0),
      conversations: Number(conversations?.count ?? 0),
    },
    recentProducts: recentProducts.map((item) => `${item.sku}: ${item.title}`),
    settingKeys: settingKeys.map((item) => item.key),
    recentImageBatchCount,
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
  "- When cost_usd, logistics_usd, usd_rate, or cuotas_qty change on a product, the API recalculates derived pricing fields deterministically from settings before saving.",
  "- public.stock_units stores physical inventory. Stable refs: id, serial_number, imei_1, imei_2. Required for creation: product_ref. Common editable fields: inventory_purchase_id, serial_number, imei_1, imei_2, color, battery_health, status, location_code, cost_amount, currency_code, acquired_at, sold_at, metadata.",
  "- public.inventory_purchases stores inbound stock purchases. Stable refs: id or purchase_number. Common editable fields: supplier_name, currency_code, total_amount, status, acquired_at, notes, metadata.",
  "- public.inventory_purchase_funders stores how a purchase was funded. Fields: funder_name, payment_method, amount_amount, currency_code, share_pct, notes.",
  "- stock_units can link directly to inventory_purchases through inventory_purchase_id.",
  "- Meta Ads live reads come from the configured ad account and business. Read commands can list campaigns, ad sets, and ads by status or text query.",
  "- Meta Ads write commands can only activate, pause, or change budget fields on campaigns/ad sets, and activate/pause ads. Those changes must always stay behind inline approval buttons.",
  "- public.settings stores key/value configuration. Stable ref: key. update_setting requires key and value. delete_setting removes the key.",
  "- public.customers stores operator and customer contacts. Stable refs: id, external_ref, phone, email. create_customer requires at least one of external_ref, phone, or email.",
  "- public.conversations stores thread headers by channel_thread_key. public.messages stores the actual interaction timeline. Each Telegram inbound and outbound message is saved in public.messages.",
  "- Product images can use public URLs. If the operator attached a Telegram image, the API can persist it on the VPS and provide a /media/... URL for image_url.",
  "- Recent Telegram image batches can be used to extract IMEIs and serials for bulk stock creation or stock status updates. Those flows must preview matches before execution.",
  "- public.operator_confirmations stores pending write actions. Low-risk single-row writes can auto-execute. Higher-risk actions use inline approve/edit/cancel buttons.",
  "- public.audit_logs stores executed mutations and important operator actions.",
  "- public.orders and public.order_items store commercial orders. They are readable in the operator chat even if writes are not yet exposed there.",
  "Mutation rules:",
  "- Never invent IDs or hidden fields.",
  "- Use product_ref, stock_ref, customer_ref, and setting key exactly from the operator request until deterministic resolution happens.",
  "- Never claim a row was created, updated, or deleted unless the deterministic command layer executed it.",
  "- If the operator asks to archive a product, prefer update_product with active=false. Use delete_product only for explicit permanent deletion intent.",
  "- delete_product must remove associated storefront checkout intents automatically before deleting the product row. Do not block deletion because of storefront intents.",
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
    "Allowed read commands: help, list_operator_skills, health_check, list_workflows, list_products, get_product_details, list_stock, get_stock_details, list_settings, get_setting_details, list_customers, get_customer_details, list_orders, list_conversations, list_inventory_purchases, get_inventory_purchase_details, list_meta_campaigns, list_meta_ad_sets, list_meta_ads.",
    "Allowed write commands: create_product, update_product, bulk_update_products, bulk_reprice_products, bulk_sync_products, delete_product, create_inventory_purchase, update_inventory_purchase, update_meta_campaign, update_meta_ad_set, update_meta_ad, create_stock_unit, create_stock_from_images, create_inventory_purchase_from_images, update_stock_unit, update_stock_status_from_images, delete_stock_unit, bulk_update_stock_units, update_setting, delete_setting, create_customer, update_customer.",
    "If the user is asking a general question or casual operator chat, return mode=chat and include the full operator-facing response in reply.",
    "If information is missing for a mutation, return mode=clarify and put the full clarification question in reply.",
    "If the operator asks for a concrete mutation that can be prepared safely, prefer mode=write over mode=chat. Do not answer with an execution plan when the command layer can already prepare the action.",
    "If the workflow has multiple steps and there is no single combined command, choose the first required deterministic step and keep the reply minimal.",
    "If the user asks for full row, all columns, entire row, toda la fila, or all information about a product/stock/customer/setting, prefer the matching get_*_details read command instead of any list_* command.",
    "Use recent thread history to resolve follow-up references like 'that one', 'same product', 'that SKU', 'those settings', or 'do it now'.",
    "If the reference is clear from recent thread history, do not ask the operator to repeat it.",
    "Never invent IDs. Keep product_ref, stock_ref, customer_ref and setting keys as plain text from the user's request.",
    "User-facing reply text must sound like an ops assistant, not like schema docs. Never mention internal tool names, table names, or confirmation tokens unless the operator explicitly asks.",
    "For update commands, only include the fields the user explicitly wants to change.",
    "If the user pastes a supplier-style list grouped by headings with lines like “Producto - 123 USD”, prefer bulk_sync_products and pass raw_list with the pasted text so the server can update existing rows, create missing products, and recalculate pricing. Default create_missing=true unless the user explicitly asks to only update existing rows (no new products).",
    "If the user pastes multiple product names each with different cost_usd values and they are all definitely existing products, bulk_reprice_products is still valid.",
    "For delete commands, only use them if the user explicitly asked to delete, remove, or permanently erase.",
    "For product archive/deactivate intent, use update_product with active=false.",
    "If the operator changes cost_usd, logistics_usd, usd_rate, or cuotas_qty on a product, the server will recalculate derived pricing fields from settings. You should frame the action as a repricing preview, not as a manual field edit list only.",
    "If the operator refers to the latest Telegram images for new stock or sold devices, prefer the image-based stock commands rather than requesting manual IMEIs.",
    "Normalize stock status wording like available/disponible to in_stock.",
    "Normalize Meta Ads status wording like activa/activo to ACTIVE and pausada/pausado to PAUSED when preparing updates.",
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
    throw new ProductReferenceAmbiguityError(
      productRef,
      rows.slice(0, 5).map((row) => ({
        id: row.id,
        sku: row.sku,
        slug: row.slug,
        title: row.title,
        price_amount: row.price_amount,
        promo_price_ars: row.promo_price_ars,
        currency_code: row.currency_code,
      }))
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

async function listRecentInventoryPurchaseOptions(limit = 4): Promise<PurchaseResolutionOption[]> {
  const rows = await listInventoryPurchases(pool, { limit });
  return rows.map((row) => ({
    id: typeof row.id === "number" ? row.id : Number(row.id),
    purchase_number: String(row.purchase_number),
    supplier_name: typeof row.supplier_name === "string" ? row.supplier_name : null,
    status: String(row.status),
    total_amount: (row.total_amount as string | number | null) ?? null,
    currency_code: typeof row.currency_code === "string" ? row.currency_code : "USD",
  }));
}

async function resolveInventoryPurchaseForOperator(purchaseRef: string) {
  const trimmed = purchaseRef.trim();
  const exactId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const rows = await query<InventoryPurchaseRow>(
    `
      select id, purchase_number, supplier_name, currency_code, total_amount, status, acquired_at, created_at
      from public.inventory_purchases
      where
        ($1::bigint is not null and id = $1)
        or lower(purchase_number) = lower($2)
        or coalesce(supplier_name, '') ilike $3
        or coalesce(notes, '') ilike $3
      order by
        case
          when ($1::bigint is not null and id = $1) then 0
          when lower(purchase_number) = lower($2) then 1
          else 2
        end,
        coalesce(acquired_at, created_at) desc,
        id desc
      limit 5
    `,
    [exactId, trimmed, `%${trimmed}%`]
  );

  if (rows.length === 0) {
    throw new Error(`No encontré una compra para "${purchaseRef}".`);
  }

  const exactRows = rows.filter(
    (row) => row.id === exactId || row.purchase_number.toLowerCase() === trimmed.toLowerCase()
  );

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (rows.length > 1) {
    throw new PurchaseReferenceAmbiguityError(
      purchaseRef,
      rows.slice(0, 5).map((row) => ({
        id: row.id,
        purchase_number: row.purchase_number,
        supplier_name: row.supplier_name,
        status: row.status,
        total_amount: row.total_amount,
        currency_code: row.currency_code,
      })),
      ["inventory_purchase_ref"]
    );
  }

  return rows[0];
}

function mapMetaCampaignRow(row: MetaCampaignRecord): MetaObjectRow {
  return {
    id: row.id,
    name: row.name ?? null,
    status: row.status ?? null,
    effective_status: row.effective_status ?? null,
    entity_kind: "campaign",
    objective: row.objective ?? null,
    daily_budget: row.daily_budget ?? null,
    lifetime_budget: row.lifetime_budget ?? null,
    updated_time: row.updated_time ?? null,
  };
}

function mapMetaAdSetRow(row: MetaAdSetRecord): MetaObjectRow {
  return {
    id: row.id,
    name: row.name ?? null,
    status: row.status ?? null,
    effective_status: row.effective_status ?? null,
    entity_kind: "ad_set",
    campaign_id: row.campaign_id ?? null,
    daily_budget: row.daily_budget ?? null,
    lifetime_budget: row.lifetime_budget ?? null,
    updated_time: row.updated_time ?? null,
  };
}

function mapMetaAdRow(row: MetaAdRecord): MetaObjectRow {
  return {
    id: row.id,
    name: row.name ?? null,
    status: row.status ?? null,
    effective_status: row.effective_status ?? null,
    entity_kind: "ad",
    campaign_id: row.campaign_id ?? null,
    adset_id: row.adset_id ?? null,
    updated_time: row.updated_time ?? null,
  };
}

async function resolveMetaCampaign(campaignRef: string) {
  const trimmed = campaignRef.trim();
  const rowsMap = new Map<string, MetaObjectRow>();

  if (/^\d+$/.test(trimmed)) {
    try {
      const direct = await getMetaCampaign(trimmed);
      rowsMap.set(direct.id, mapMetaCampaignRow(direct));
    } catch {
      // Ignore direct lookup failure and fall back to filtered listing.
    }
  }

  const rows = await listMetaCampaigns({ query: trimmed, limit: 100 });
  for (const row of rows) {
    rowsMap.set(row.id, mapMetaCampaignRow(row));
  }

  const options = Array.from(rowsMap.values());
  if (options.length === 0) {
    throw new Error(`No encontré una campaña para "${campaignRef}".`);
  }

  const normalizedReference = normalizeMatch(trimmed);
  const exactRows = options.filter(
    (row) => row.id === trimmed || normalizeMatch(row.name || "") === normalizedReference
  );

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (options.length > 1) {
    throw new MetaObjectReferenceAmbiguityError(
      campaignRef,
      "campaign",
      options.slice(0, 5).map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        effective_status: row.effective_status,
        entity_kind: "campaign",
      })),
      []
    );
  }

  return options[0];
}

async function resolveMetaAdSet(adSetRef: string) {
  const trimmed = adSetRef.trim();
  const rowsMap = new Map<string, MetaObjectRow>();

  if (/^\d+$/.test(trimmed)) {
    try {
      const direct = await getMetaAdSet(trimmed);
      rowsMap.set(direct.id, mapMetaAdSetRow(direct));
    } catch {
      // Ignore direct lookup failure and fall back to filtered listing.
    }
  }

  const rows = await listMetaAdSets({ query: trimmed, limit: 100 });
  for (const row of rows) {
    rowsMap.set(row.id, mapMetaAdSetRow(row));
  }

  const options = Array.from(rowsMap.values());
  if (options.length === 0) {
    throw new Error(`No encontré un ad set para "${adSetRef}".`);
  }

  const normalizedReference = normalizeMatch(trimmed);
  const exactRows = options.filter(
    (row) => row.id === trimmed || normalizeMatch(row.name || "") === normalizedReference
  );

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (options.length > 1) {
    throw new MetaObjectReferenceAmbiguityError(
      adSetRef,
      "ad_set",
      options.slice(0, 5).map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        effective_status: row.effective_status,
        entity_kind: "ad_set",
      })),
      []
    );
  }

  return options[0];
}

async function resolveMetaAdEntity(adRef: string) {
  const trimmed = adRef.trim();
  const rowsMap = new Map<string, MetaObjectRow>();

  if (/^\d+$/.test(trimmed)) {
    try {
      const direct = await getMetaAd(trimmed);
      rowsMap.set(direct.id, mapMetaAdRow(direct));
    } catch {
      // Ignore direct lookup failure and fall back to filtered listing.
    }
  }

  const rows = await listMetaAds({ query: trimmed, limit: 100 });
  for (const row of rows) {
    rowsMap.set(row.id, mapMetaAdRow(row));
  }

  const options = Array.from(rowsMap.values());
  if (options.length === 0) {
    throw new Error(`No encontré un anuncio para "${adRef}".`);
  }

  const normalizedReference = normalizeMatch(trimmed);
  const exactRows = options.filter(
    (row) => row.id === trimmed || normalizeMatch(row.name || "") === normalizedReference
  );

  if (exactRows.length === 1) {
    return exactRows[0];
  }

  if (options.length > 1) {
    throw new MetaObjectReferenceAmbiguityError(
      adRef,
      "ad",
      options.slice(0, 5).map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        effective_status: row.effective_status,
        entity_kind: "ad",
      })),
      []
    );
  }

  return options[0];
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

async function getLatestResolutionPrompt(actor: ActorContext): Promise<ResolutionPromptPayload | null> {
  if (!actor.conversationId) {
    return null;
  }

  const rows = await query<{ payload: Record<string, unknown> }>(
    `
      select payload
      from public.messages
      where conversation_id = $1
        and payload ->> 'kind' in (
          'product_resolution_prompt',
          'product_resolution_selected',
          'purchase_resolution_prompt',
          'purchase_resolution_selected',
          'meta_object_resolution_prompt',
          'meta_object_resolution_selected'
        )
      order by created_at desc, id desc
      limit 1
    `,
    [actor.conversationId]
  );

  const payload = rows[0]?.payload;
  if (!payload) {
    return null;
  }

  if (payload.kind === "product_resolution_prompt") {
    if (
      (payload.mode !== "read" && payload.mode !== "write") ||
      typeof payload.command !== "string" ||
      !isRecord(payload.params) ||
      typeof payload.reference !== "string" ||
      !Array.isArray(payload.reference_path) ||
      !Array.isArray(payload.options)
    ) {
      return null;
    }

    const referencePath = payload.reference_path.filter(
      (part): part is ProductResolutionPathPart => typeof part === "string" || typeof part === "number"
    );

    const options = payload.options
      .filter((option): option is ProductResolutionOption => {
        return (
          isRecord(option) &&
          typeof option.id === "number" &&
          typeof option.sku === "string" &&
          typeof option.slug === "string" &&
          typeof option.title === "string" &&
          typeof option.currency_code === "string"
        );
      })
      .map((option) => ({
        id: option.id,
        sku: option.sku,
        slug: option.slug,
        title: option.title,
        price_amount:
          option.price_amount == null || typeof option.price_amount === "string" || typeof option.price_amount === "number"
            ? option.price_amount
            : null,
        promo_price_ars:
          option.promo_price_ars == null ||
          typeof option.promo_price_ars === "string" ||
          typeof option.promo_price_ars === "number"
            ? option.promo_price_ars
            : null,
        currency_code: option.currency_code,
      }));

    if (referencePath.length === 0 || options.length === 0) {
      return null;
    }

    return {
      kind: "product_resolution_prompt",
      mode: payload.mode,
      command: payload.command as ReadCommandName | WriteCommandName,
      params: payload.params,
      reference: payload.reference,
      reference_path: referencePath,
      options,
    };
  }

  if (payload.kind === "purchase_resolution_prompt") {
    if (
      payload.mode !== "write" ||
      typeof payload.command !== "string" ||
      !isRecord(payload.params) ||
      typeof payload.reference !== "string" ||
      !Array.isArray(payload.reference_path) ||
      !Array.isArray(payload.options)
    ) {
      return null;
    }

    const referencePath = payload.reference_path.filter(
      (part): part is ProductResolutionPathPart => typeof part === "string" || typeof part === "number"
    );

    const options = payload.options
      .filter((option): option is PurchaseResolutionOption => {
        return (
          isRecord(option) &&
          (typeof option.id === "number" || option.id === null) &&
          typeof option.purchase_number === "string" &&
          typeof option.status === "string" &&
          typeof option.currency_code === "string"
        );
      })
      .map((option) => ({
        id: option.id,
        purchase_number: option.purchase_number,
        supplier_name: option.supplier_name ?? null,
        status: option.status,
        total_amount:
          option.total_amount == null || typeof option.total_amount === "string" || typeof option.total_amount === "number"
            ? option.total_amount
            : null,
        currency_code: option.currency_code,
        is_create_new: Boolean(option.is_create_new),
      }));

    if (referencePath.length === 0 || options.length === 0) {
      return null;
    }

    return {
      kind: "purchase_resolution_prompt",
      mode: "write",
      command: payload.command as WriteCommandName,
      params: payload.params,
      reference: payload.reference,
      reference_path: referencePath,
      options,
    };
  }

  if (payload.kind === "meta_object_resolution_prompt") {
    if (
      (payload.mode !== "read" && payload.mode !== "write") ||
      typeof payload.command !== "string" ||
      !isRecord(payload.params) ||
      typeof payload.reference !== "string" ||
      !Array.isArray(payload.reference_path) ||
      !Array.isArray(payload.options) ||
      (payload.entity_kind !== "campaign" && payload.entity_kind !== "ad_set" && payload.entity_kind !== "ad")
    ) {
      return null;
    }

    const referencePath = payload.reference_path.filter(
      (part): part is ProductResolutionPathPart => typeof part === "string" || typeof part === "number"
    );

    const options = payload.options
      .filter((option): option is MetaObjectResolutionOption => {
        return (
          isRecord(option) &&
          typeof option.id === "string" &&
          (typeof option.name === "string" || option.name == null) &&
          (typeof option.status === "string" || option.status == null) &&
          (typeof option.effective_status === "string" || option.effective_status == null) &&
          (option.entity_kind === "campaign" || option.entity_kind === "ad_set" || option.entity_kind === "ad")
        );
      })
      .map((option) => ({
        id: option.id,
        name: option.name ?? null,
        status: option.status ?? null,
        effective_status: option.effective_status ?? null,
        entity_kind: option.entity_kind,
      }));

    if (referencePath.length === 0 || options.length === 0) {
      return null;
    }

    return {
      kind: "meta_object_resolution_prompt",
      mode: payload.mode,
      command: payload.command as ReadCommandName | WriteCommandName,
      params: payload.params,
      reference: payload.reference,
      reference_path: referencePath,
      entity_kind: payload.entity_kind,
      options,
    };
  }

  return null;
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
    text: [prepared.summary, "", "¿Lo hago?"].join("\n"),
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
        `• Compras de inventario: ${snapshot.counts.inventoryPurchases}`,
        `• Conversaciones abiertas: ${snapshot.counts.conversations}`,
        `• Órdenes: ${snapshot.counts.orders}`,
        snapshot.recentImageBatchCount > 0 ? `• Último lote de imágenes: ${snapshot.recentImageBatchCount}` : "",
      ]
        .filter(Boolean)
        .join("\n");
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
    case "list_inventory_purchases": {
      const parsed = listInventoryPurchasesSchema.parse(params);
      const limit = parsed.all ? 200 : parsed.limit ?? 36;
      const rows = await listInventoryPurchases(pool, {
        query: parsed.query,
        status: parsed.status,
        limit,
      });

      if (rows.length === 0) {
        return "No encontré compras de inventario con ese criterio.";
      }

      return [
        `Compras de inventario${parsed.query ? ` para "${parsed.query}"` : ""} (${rows.length}${parsed.all ? "" : ` máx. ${limit}`}) :`,
        ...rows.map(
          (row) =>
            `• ${row.purchase_number} · ${row.status} · ${formatMoney(row.total_amount as string | number | null, row.currency_code)} · ${
              row.supplier_name || "sin proveedor"
            } · funders ${row.funders_count ?? 0} · stock ${row.stock_units_count ?? 0}`
        ),
      ].join("\n");
    }
    case "get_inventory_purchase_details": {
      const parsed = getInventoryPurchaseDetailsSchema.parse(params);
      const purchase = await resolveInventoryPurchaseForOperator(parsed.purchase_ref);
      const detail = await getInventoryPurchaseDetail(pool, purchase.id);

      if (!detail) {
        return `No pude cargar la compra ${parsed.purchase_ref}.`;
      }

      return formatRecordDump(`Fila completa de compra ${detail.purchase_number}:`, detail as Record<string, unknown>);
    }
    case "list_meta_campaigns": {
      const parsed = listMetaCampaignsSchema.parse(params);
      const limit = parsed.all ? 100 : parsed.limit ?? 24;
      const rows = await listMetaCampaigns({
        query: parsed.query,
        status: parsed.status,
        limit,
      });

      if (rows.length === 0) {
        return "No encontré campañas Meta con ese criterio.";
      }

      const filters = [parsed.query ? `texto=${parsed.query}` : "", parsed.status ? `estado=${parsed.status}` : ""]
        .filter(Boolean)
        .join(" · ");

      return [
        `${getMetaEntityLabelPlural("campaign")} Meta${filters ? ` (${filters})` : ""} · ${rows.length}`,
        ...rows.map((row) => formatMetaObjectLine(mapMetaCampaignRow(row))),
      ].join("\n");
    }
    case "list_meta_ad_sets": {
      const parsed = listMetaAdSetsSchema.parse(params);
      const limit = parsed.all ? 100 : parsed.limit ?? 24;
      const rows = await listMetaAdSets({
        query: parsed.query,
        status: parsed.status,
        limit,
      });

      if (rows.length === 0) {
        return "No encontré ad sets Meta con ese criterio.";
      }

      const filters = [parsed.query ? `texto=${parsed.query}` : "", parsed.status ? `estado=${parsed.status}` : ""]
        .filter(Boolean)
        .join(" · ");

      return [
        `${getMetaEntityLabelPlural("ad_set")} Meta${filters ? ` (${filters})` : ""} · ${rows.length}`,
        ...rows.map((row) => formatMetaObjectLine(mapMetaAdSetRow(row))),
      ].join("\n");
    }
    case "list_meta_ads": {
      const parsed = listMetaAdsSchema.parse(params);
      const limit = parsed.all ? 100 : parsed.limit ?? 24;
      const rows = await listMetaAds({
        query: parsed.query,
        status: parsed.status,
        limit,
      });

      if (rows.length === 0) {
        return "No encontré anuncios Meta con ese criterio.";
      }

      const filters = [parsed.query ? `texto=${parsed.query}` : "", parsed.status ? `estado=${parsed.status}` : ""]
        .filter(Boolean)
        .join(" · ");

      return [
        `${getMetaEntityLabelPlural("ad")} Meta${filters ? ` (${filters})` : ""} · ${rows.length}`,
        ...rows.map((row) => formatMetaObjectLine(mapMetaAdRow(row))),
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

async function prepareWriteCommand(
  actor: ActorContext,
  command: WriteCommandName,
  rawParams: Record<string, unknown>
): Promise<PreparedMutation> {
  switch (command) {
    case "create_product": {
      const parsed = createProductSchema.parse(rawParams);
      const title = parsed.title.trim();
      const brand = parsed.brand?.trim() || inferBrand(title);
      const model = parsed.model?.trim() || inferModel(title, brand);
      const payload: Record<string, unknown> = {
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
      const pricingPreview =
        parsed.cost_usd !== undefined ||
        parsed.logistics_usd !== undefined ||
        parsed.usd_rate !== undefined ||
        parsed.cuotas_qty !== undefined
          ? buildPricingPreviewLines(
              Object.assign(payload, await calculateDerivedPricing(payload, pool)) as Record<string, unknown>
            )
          : [];

      return {
        command,
        summary: [
          "Crear producto",
          `• SKU: ${payload.sku}`,
          `• Título: ${payload.title}`,
          `• Marca / modelo: ${payload.brand} / ${payload.model}`,
          payload.price_amount != null ? `• Precio: ${formatMoney(payload.price_amount as string | number, String(payload.currency_code || "ARS"))}` : "",
          pricingPreview.length > 0 ? "• Pricing derivado:" : "",
          ...pricingPreview,
        ]
          .filter(Boolean)
          .join("\n"),
        payload,
      };
    }
    case "update_product": {
      const parsed = updateProductSchema.parse(rawParams);
      const product = await resolveProduct(parsed.product_ref);
      let nextChanges = { ...parsed.changes } as Record<string, unknown>;
      let beforePricing: Record<string, unknown> | null = null;
      let pricingPreview: string[] = [];

      if (shouldRecalculatePricing(nextChanges)) {
        const rows = await query<Record<string, unknown>>(
          `
            select
              cost_usd,
              logistics_usd,
              total_cost_usd,
              margin_pct,
              price_usd,
              usd_rate,
              price_amount,
              promo_price_ars,
              bancarizada_interest,
              bancarizada_total,
              bancarizada_cuota,
              macro_interest,
              macro_total,
              macro_cuota,
              cuotas_qty
            from public.products
            where id = $1
            limit 1
          `,
          [product.id]
        );

        beforePricing = rows[0] ?? null;
        nextChanges = {
          ...nextChanges,
          ...(await calculateDerivedPricing(
            {
              cost_usd: toPricingCarrierValue(nextChanges.cost_usd ?? beforePricing?.cost_usd ?? null),
              logistics_usd: toPricingCarrierValue(nextChanges.logistics_usd ?? beforePricing?.logistics_usd ?? null),
              usd_rate: toPricingCarrierValue(nextChanges.usd_rate ?? beforePricing?.usd_rate ?? null),
              cuotas_qty: toPricingCarrierValue(nextChanges.cuotas_qty ?? beforePricing?.cuotas_qty ?? null),
            },
            pool
          )),
        };
        pricingPreview = buildPricingPreviewLines({
          cost_usd: toPreviewValue(nextChanges.cost_usd),
          logistics_usd: toPreviewValue(nextChanges.logistics_usd),
          total_cost_usd: toPreviewValue(nextChanges.total_cost_usd),
          margin_pct: toPreviewValue(nextChanges.margin_pct),
          price_usd: toPreviewValue(nextChanges.price_usd),
          usd_rate: toPreviewValue(nextChanges.usd_rate),
          price_amount: toPreviewValue(nextChanges.price_amount),
          promo_price_ars: toPreviewValue(nextChanges.promo_price_ars),
          bancarizada_interest: toPreviewValue(nextChanges.bancarizada_interest),
          bancarizada_total: toPreviewValue(nextChanges.bancarizada_total),
          bancarizada_cuota: toPreviewValue(nextChanges.bancarizada_cuota),
          macro_interest: toPreviewValue(nextChanges.macro_interest),
          macro_total: toPreviewValue(nextChanges.macro_total),
          macro_cuota: toPreviewValue(nextChanges.macro_cuota),
          cuotas_qty: toPreviewValue(nextChanges.cuotas_qty),
        });
      }

      return {
        command,
        summary: [
          `Actualizar producto ${product.sku}`,
          `• ${product.title}`,
          `• Cambios: ${Object.entries(nextChanges)
            .map(([key, value]) => `${key}=${formatJsonPreview(value)}`)
            .join(", ")}`,
          pricingPreview.length > 0 ? "• Pricing recalculado desde settings:" : "",
          ...pricingPreview,
        ].join("\n"),
        payload: {
          product_id: product.id,
          sku: product.sku,
          title: product.title,
          before_pricing: beforePricing,
          pricing_recalculated: pricingPreview.length > 0,
          changes: nextChanges,
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
    case "bulk_reprice_products": {
      const parsed = bulkRepriceProductsSchema.parse(rawParams);
      const items: Array<{
        product_id: number;
        sku: string;
        title: string;
        previous_cost_usd: string | number | null;
        previous_price_amount: string | number | null;
        changes: Record<string, unknown>;
      }> = [];
      const seenProductIds = new Set<number>();

      for (const item of parsed.items) {
        const product = await resolveProduct(item.product_ref);
        if (seenProductIds.has(product.id)) {
          throw new Error(`El producto ${product.sku} aparece repetido en el lote. Dejame una sola línea por producto.`);
        }

        seenProductIds.add(product.id);
        const current = await loadProductPricingState(product.id);
        if (!current) {
          throw new Error(`No pude cargar pricing actual para ${product.sku}.`);
        }

        const derived = await calculateDerivedPricing(
          {
            cost_usd: item.cost_usd,
            logistics_usd: toPricingCarrierValue(current.logistics_usd ?? null),
            usd_rate: toPricingCarrierValue(current.usd_rate ?? null),
            cuotas_qty: toPricingCarrierValue(current.cuotas_qty ?? null),
          },
          pool
        );

        items.push({
          product_id: product.id,
          sku: product.sku,
          title: product.title,
          previous_cost_usd: current.cost_usd as string | number | null,
          previous_price_amount: current.price_amount as string | number | null,
          changes: {
            cost_usd: item.cost_usd,
            ...derived,
          },
        });
      }

      return {
        command,
        summary: [
          `Repricing masivo de ${items.length} productos`,
          ...items.map(
            (item) =>
              `• ${item.sku} · cost_usd ${item.previous_cost_usd ?? "-"} → ${item.changes.cost_usd} · ${formatMoney(
                item.previous_price_amount,
                "ARS"
              )} → ${formatMoney(item.changes.price_amount as string | number | null, "ARS")}`
          ),
        ].join("\n"),
        payload: { items },
      };
    }
    case "bulk_sync_products": {
      const parsed = bulkSyncProductsSchema.parse(rawParams);
      const defaults = {
        active: parsed.active ?? true,
        inStock: parsed.in_stock ?? false,
        condition: parsed.condition ?? "new",
      } as const;
      const rawList = parsed.raw_list?.trim() || actor.userMessage;
      const draftItems = parseCatalogSyncPriceList(rawList, defaults);
      const catalogProducts = await loadCatalogSyncProducts();
      const seenProductIds = new Map<number, string>();
      const seenCreateSkus = new Set<string>();
      const updateItems: Array<{
        source_line: string;
        source_section: string;
        product_id: number;
        sku: string;
        title: string;
        previous_cost_usd: string | number | null;
        previous_price_amount: string | number | null;
        changes: Record<string, unknown>;
      }> = [];
      const createItems: Array<Record<string, unknown>> = [];
      const summaryLines: string[] = [];

      for (const item of draftItems) {
        const match = resolveCatalogSyncMatches(item, catalogProducts);

        if (match.kind === "ambiguous") {
          throw new Error(
            `La línea ${item.lineNumber} "${item.rawName}" es ambigua. Coincidencias posibles: ${match.products
              .slice(0, 5)
              .map((product) => `${product.sku} (${product.title})`)
              .join(" | ")}`
          );
        }

        if (match.kind === "missing") {
          if (parsed.create_missing === false) {
            throw new Error(`No encontré un producto existente para "${item.rawName}" (línea ${item.lineNumber}).`);
          }

          if (seenCreateSkus.has(item.sku)) {
            throw new Error(`La línea ${item.lineNumber} repite el SKU ${item.sku}. Dejame una sola línea por producto.`);
          }

          seenCreateSkus.add(item.sku);
          const derived = await calculateDerivedPricing({ cost_usd: item.costUsd }, pool);
          const payload = {
            sku: item.sku,
            slug: item.slug,
            brand: item.brand,
            model: item.model,
            title: item.title,
            description: item.description,
            condition: item.condition,
            price_amount: derived.price_amount,
            currency_code: "ARS",
            active: item.active,
            category: item.category,
            cost_usd: item.costUsd,
            logistics_usd: derived.logistics_usd,
            total_cost_usd: derived.total_cost_usd,
            margin_pct: derived.margin_pct,
            price_usd: derived.price_usd,
            promo_price_ars: derived.promo_price_ars,
            bancarizada_total: derived.bancarizada_total,
            bancarizada_cuota: derived.bancarizada_cuota,
            bancarizada_interest: derived.bancarizada_interest,
            macro_total: derived.macro_total,
            macro_cuota: derived.macro_cuota,
            macro_interest: derived.macro_interest,
            cuotas_qty: derived.cuotas_qty,
            in_stock: item.inStock,
            delivery_type: null,
            delivery_days: null,
            usd_rate: derived.usd_rate,
            image_url: null,
            ram_gb: item.ramGb,
            storage_gb: item.storageGb,
            network: item.network,
            color: item.color,
            battery_health: null,
            source_line: item.rawName,
            source_section: item.sectionLabel,
          };
          createItems.push(payload);
          summaryLines.push(
            `• Crear ${item.sku} · ${item.title} · cost_usd ${item.costUsd} · ${formatMoney(
              derived.price_amount,
              "ARS"
            )}`
          );
          continue;
        }

        for (const product of match.products) {
          const duplicateSource = seenProductIds.get(product.id);
          if (duplicateSource) {
            throw new Error(
              `El producto ${product.sku} entró dos veces en la lista: "${duplicateSource}" y "${item.rawName}".`
            );
          }

          seenProductIds.set(product.id, item.rawName);
          const current = await loadProductPricingState(product.id);
          if (!current) {
            throw new Error(`No pude cargar pricing actual para ${product.sku}.`);
          }

          const derived = await calculateDerivedPricing(
            {
              cost_usd: item.costUsd,
              logistics_usd: toPricingCarrierValue(current.logistics_usd ?? null),
              usd_rate: toPricingCarrierValue(current.usd_rate ?? null),
              cuotas_qty: toPricingCarrierValue(current.cuotas_qty ?? null),
            },
            pool
          );

          updateItems.push({
            source_line: item.rawName,
            source_section: item.sectionLabel,
            product_id: product.id,
            sku: product.sku,
            title: product.title,
            previous_cost_usd: current.cost_usd as string | number | null,
            previous_price_amount: current.price_amount as string | number | null,
            changes: {
              cost_usd: item.costUsd,
              ...derived,
            },
          });
        }

        summaryLines.push(
          match.products.length === 1
            ? `• ${match.products[0].sku} · cost_usd ${item.costUsd} · ${formatMoney(
                updateItems[updateItems.length - 1]?.changes.price_amount as string | number | null,
                "ARS"
              )}`
            : `• ${item.rawName} · ${match.products.length} variantes (${match.products.map((product) => product.sku).join(", ")}) · cost_usd ${item.costUsd}`
        );
      }

      const updateCount = updateItems.length;
      const createCount = createItems.length;
      return {
        command,
        summary: [
          `Sync masivo de lista de costos (${draftItems.length} líneas)`,
          `• ${updateCount} actualizaciones`,
          `• ${createCount} productos nuevos`,
          ...limitCatalogSyncSummary(summaryLines),
        ].join("\n"),
        payload: {
          update_items: updateItems,
          create_items: createItems,
        },
      };
    }
    case "delete_product": {
      const parsed = deleteProductSchema.parse(rawParams);
      const product = await resolveProduct(parsed.product_ref);
      const [stockCount, checkoutIntentCount] = await Promise.all([
        query<{ count: string }>("select count(*)::text as count from public.stock_units where product_id = $1", [product.id]),
        query<{ count: string }>(
          "select count(*)::text as count from public.storefront_checkout_intents where product_id = $1",
          [product.id]
        ),
      ]);

      if (Number(stockCount[0]?.count ?? 0) > 0) {
        throw new Error(
          `No puedo borrar ${product.sku} porque todavía tiene unidades de stock. Mové o liquidá el stock primero, o archivá el producto con update_product (active=false) en vez de borrarlo.`
        );
      }

      return {
        command,
        summary: [
          `Borrar producto`,
          `• ${product.sku}`,
          `• ${product.title}`,
          Number(checkoutIntentCount[0]?.count ?? 0) > 0
            ? `• También se borran ${Number(checkoutIntentCount[0]?.count ?? 0)} checkout intents del storefront`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          product_id: product.id,
          sku: product.sku,
          title: product.title,
          checkout_intent_count: Number(checkoutIntentCount[0]?.count ?? 0),
        },
      };
    }
    case "create_inventory_purchase": {
      const parsed = createInventoryPurchaseSchema.parse(rawParams);
      const payload = {
        ...parsed,
        currency_code: parsed.currency_code?.trim() || "USD",
        status: parsed.status || "draft",
      };

      return {
        command,
        summary: [
          "Crear compra de inventario",
          payload.supplier_name ? `• Proveedor: ${payload.supplier_name}` : "",
          payload.total_amount != null ? `• Total: ${formatMoney(payload.total_amount, payload.currency_code)}` : "",
          `• Estado: ${payload.status}`,
          payload.acquired_at ? `• Fecha: ${payload.acquired_at}` : "",
          payload.notes ? `• Notas: ${payload.notes}` : "",
          payload.funders?.length ? "• Funders:" : "",
          ...buildFunderSummaryLines(payload.funders as Array<Record<string, unknown>> | undefined),
        ]
          .filter(Boolean)
          .join("\n"),
        payload,
      };
    }
    case "update_inventory_purchase": {
      const parsed = updateInventoryPurchaseSchema.parse(rawParams);
      const purchase = await resolveInventoryPurchaseForOperator(parsed.purchase_ref);
      const nextChanges = {
        ...parsed.changes,
        currency_code:
          parsed.changes.currency_code === undefined ? undefined : parsed.changes.currency_code?.trim() || "USD",
      };

      return {
        command,
        summary: [
          `Actualizar compra ${purchase.purchase_number}`,
          purchase.supplier_name ? `• Compra actual: ${purchase.supplier_name}` : "",
          `• Cambios: ${Object.entries(nextChanges)
            .map(([key, value]) => `${key}=${formatJsonPreview(value)}`)
            .join(", ")}`,
          Array.isArray(nextChanges.funders) && nextChanges.funders.length > 0 ? "• Funders propuestos:" : "",
          ...buildFunderSummaryLines(nextChanges.funders as Array<Record<string, unknown>> | undefined),
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          purchase_id: purchase.id,
          purchase_number: purchase.purchase_number,
          changes: nextChanges,
        },
      };
    }
    case "update_meta_campaign": {
      const parsed = updateMetaCampaignSchema.parse(rawParams);
      const campaign = await resolveMetaCampaign(parsed.campaign_ref);

      return {
        command,
        summary: [
          "Actualizar campaña Meta",
          `• ${campaign.name || campaign.id}`,
          `• ID: ${campaign.id}`,
          campaign.effective_status || campaign.status ? `• Estado actual: ${campaign.effective_status || campaign.status}` : "",
          parsed.changes.status ? `• Nuevo estado: ${parsed.changes.status}` : "",
          parsed.changes.daily_budget != null ? `• Presupuesto diario: ${formatMetaBudget(parsed.changes.daily_budget)}` : "",
          parsed.changes.lifetime_budget != null
            ? `• Presupuesto vitalicio: ${formatMetaBudget(parsed.changes.lifetime_budget)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          campaign_id: campaign.id,
          name: campaign.name,
          current_status: campaign.effective_status || campaign.status,
          current_daily_budget: campaign.daily_budget ?? null,
          current_lifetime_budget: campaign.lifetime_budget ?? null,
          changes: parsed.changes,
        },
      };
    }
    case "update_meta_ad_set": {
      const parsed = updateMetaAdSetSchema.parse(rawParams);
      const adSet = await resolveMetaAdSet(parsed.ad_set_ref);

      return {
        command,
        summary: [
          "Actualizar ad set Meta",
          `• ${adSet.name || adSet.id}`,
          `• ID: ${adSet.id}`,
          adSet.campaign_id ? `• Campaign ID: ${adSet.campaign_id}` : "",
          adSet.effective_status || adSet.status ? `• Estado actual: ${adSet.effective_status || adSet.status}` : "",
          parsed.changes.status ? `• Nuevo estado: ${parsed.changes.status}` : "",
          parsed.changes.daily_budget != null ? `• Presupuesto diario: ${formatMetaBudget(parsed.changes.daily_budget)}` : "",
          parsed.changes.lifetime_budget != null
            ? `• Presupuesto vitalicio: ${formatMetaBudget(parsed.changes.lifetime_budget)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          ad_set_id: adSet.id,
          name: adSet.name,
          campaign_id: adSet.campaign_id ?? null,
          current_status: adSet.effective_status || adSet.status,
          current_daily_budget: adSet.daily_budget ?? null,
          current_lifetime_budget: adSet.lifetime_budget ?? null,
          changes: parsed.changes,
        },
      };
    }
    case "update_meta_ad": {
      const parsed = updateMetaAdSchema.parse(rawParams);
      const ad = await resolveMetaAdEntity(parsed.ad_ref);

      return {
        command,
        summary: [
          "Actualizar anuncio Meta",
          `• ${ad.name || ad.id}`,
          `• ID: ${ad.id}`,
          ad.campaign_id ? `• Campaign ID: ${ad.campaign_id}` : "",
          ad.adset_id ? `• Ad set ID: ${ad.adset_id}` : "",
          ad.effective_status || ad.status ? `• Estado actual: ${ad.effective_status || ad.status}` : "",
          parsed.changes.status ? `• Nuevo estado: ${parsed.changes.status}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          ad_id: ad.id,
          name: ad.name,
          campaign_id: ad.campaign_id ?? null,
          adset_id: ad.adset_id ?? null,
          current_status: ad.effective_status || ad.status,
          changes: parsed.changes,
        },
      };
    }
    case "create_stock_unit": {
      const parsed = createStockSchema.parse(rawParams);
      const product = await resolveProduct(parsed.product_ref);
      const purchase = parsed.inventory_purchase_ref ? await resolveInventoryPurchaseForOperator(parsed.inventory_purchase_ref) : null;

      if (!purchase) {
        throw new PurchaseReferenceAmbiguityError(
          `${product.title} stock manual`,
          [
            ...(await listRecentInventoryPurchaseOptions(4)),
            {
              id: null,
              purchase_number: "new",
              supplier_name: null,
              status: "draft",
              total_amount: null,
              currency_code: "USD",
              is_create_new: true,
            },
          ],
          ["inventory_purchase_ref"]
        );
      }

      return {
        command,
        summary: [
          `Crear unidad de stock para ${product.sku}`,
          `• Producto: ${product.title}`,
          `• Compra: ${purchase.purchase_number}`,
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
          inventory_purchase_id: purchase.id,
          inventory_purchase_number: purchase.purchase_number,
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
      let nextInventoryPurchaseId: number | null = null;
      let nextInventoryPurchaseNumber: string | null = null;

      if (parsed.changes.product_ref) {
        const product = await resolveProduct(parsed.changes.product_ref);
        nextProductId = product.id;
        nextSku = product.sku;
      }

      if (parsed.changes.inventory_purchase_ref) {
        const purchase = await resolveInventoryPurchaseForOperator(parsed.changes.inventory_purchase_ref);
        nextInventoryPurchaseId = purchase.id;
        nextInventoryPurchaseNumber = purchase.purchase_number;
      }

      return {
        command,
        summary: [
          `Actualizar stock #${stock.id}`,
          `• Referencia actual: ${stock.serial_number || stock.imei_1 || stock.imei_2 || stock.sku}`,
          nextInventoryPurchaseNumber ? `• Compra destino: ${nextInventoryPurchaseNumber}` : "",
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
          inventory_purchase_id: nextInventoryPurchaseId,
          inventory_purchase_number: nextInventoryPurchaseNumber,
        },
      };
    }
    case "create_stock_from_images": {
      const parsed = createStockFromImagesSchema.parse(rawParams);
      const product = await resolveProduct(parsed.product_ref);
      const purchase = parsed.inventory_purchase_ref ? await resolveInventoryPurchaseForOperator(parsed.inventory_purchase_ref) : null;

      if (!purchase) {
        throw new PurchaseReferenceAmbiguityError(
          product.title,
          [
            ...(await listRecentInventoryPurchaseOptions(4)),
            {
              id: null,
              purchase_number: "new",
              supplier_name: null,
              status: "draft",
              total_amount: null,
              currency_code: "USD",
              is_create_new: true,
            },
          ],
          ["inventory_purchase_ref"]
        );
      }

      const extracted = await getRecentImageBatchOrThrow(actor);
      await assertNoExistingStockConflicts(extracted.candidates);
      const current = await loadProductPricingState(product.id);
      const fallbackCost = asFiniteNumber(current?.cost_usd ?? null);
      const purchaseTotal = asFiniteNumber(purchase?.total_amount ?? null);
      const derivedCost =
        parsed.cost_amount ??
        (purchaseTotal != null && extracted.candidates.length > 0 ? roundAmount(purchaseTotal / extracted.candidates.length) : null) ??
        fallbackCost;
      const currencyCode =
        parsed.currency_code?.trim() ||
        purchase?.currency_code ||
        (fallbackCost != null ? "USD" : "ARS");

      return {
        command,
        summary: [
          `Crear ${extracted.candidates.length} unidades desde imágenes`,
          `• Producto: ${product.sku} · ${product.title}`,
          `• Compra asociada: ${purchase.purchase_number}`,
          `• Imágenes usadas: ${extracted.images.length}`,
          derivedCost != null ? `• Costo por unidad: ${formatMoney(derivedCost, currencyCode)}` : "",
          `• Estado inicial: ${parsed.status || "in_stock"}`,
          parsed.location_code ? `• Ubicación: ${parsed.location_code}` : "",
          ...buildImageBatchSummaryLines(extracted.candidates, extracted.warnings),
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          product_id: product.id,
          sku: product.sku,
          title: product.title,
          inventory_purchase_id: purchase.id,
          inventory_purchase_number: purchase.purchase_number,
          candidates: extracted.candidates,
          warnings: extracted.warnings,
          cost_amount: derivedCost,
          currency_code: currencyCode,
          status: parsed.status || "in_stock",
          location_code: parsed.location_code ?? null,
          acquired_at: parsed.acquired_at ?? purchase.acquired_at ?? null,
          metadata: parsed.metadata || {},
        },
      };
    }
    case "create_inventory_purchase_from_images": {
      const parsed = createInventoryPurchaseFromImagesSchema.parse(rawParams);
      const product = await resolveProduct(parsed.product_ref);
      const extracted = await getRecentImageBatchOrThrow(actor);
      await assertNoExistingStockConflicts(extracted.candidates);
      const current = await loadProductPricingState(product.id);
      const fallbackCost = asFiniteNumber(current?.cost_usd ?? null);
      const currencyCode = parsed.currency_code?.trim() || "USD";
      const explicitTotal = asFiniteNumber(parsed.total_amount ?? null);
      const derivedUnitCost =
        parsed.cost_amount ??
        (explicitTotal != null && extracted.candidates.length > 0 ? roundAmount(explicitTotal / extracted.candidates.length) : null) ??
        fallbackCost;
      const totalAmount =
        explicitTotal ?? (derivedUnitCost != null ? roundAmount(derivedUnitCost * extracted.candidates.length) : null);
      const purchaseInput = {
        supplier_name: parsed.supplier_name ?? null,
        currency_code: currencyCode,
        total_amount: totalAmount,
        status: parsed.status || "received",
        acquired_at: parsed.acquired_at ?? new Date().toISOString(),
        notes: parsed.notes ?? null,
        metadata: {
          ...(parsed.metadata || {}),
          source: "telegram-image-batch",
          product_sku: product.sku,
          image_count: extracted.images.length,
          source_media_urls: extracted.images.map((image) => image.media_url),
          extracted_warnings: extracted.warnings,
        },
        funders: parsed.funders || [],
      };

      return {
        command,
        summary: [
          `Crear compra + ${extracted.candidates.length} unidades desde imágenes`,
          `• Producto: ${product.sku} · ${product.title}`,
          purchaseInput.supplier_name ? `• Proveedor: ${purchaseInput.supplier_name}` : "",
          totalAmount != null ? `• Total compra: ${formatMoney(totalAmount, currencyCode)}` : "",
          derivedUnitCost != null ? `• Costo unitario: ${formatMoney(derivedUnitCost, currencyCode)}` : "",
          `• Estado compra: ${purchaseInput.status}`,
          parsed.location_code ? `• Ubicación stock: ${parsed.location_code}` : "",
          purchaseInput.funders.length > 0 ? "• Funders:" : "",
          ...buildFunderSummaryLines(purchaseInput.funders as Array<Record<string, unknown>>),
          ...buildImageBatchSummaryLines(extracted.candidates, extracted.warnings),
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          purchase_input: purchaseInput,
          stock_input: {
            product_id: product.id,
            sku: product.sku,
            title: product.title,
            candidates: extracted.candidates,
            warnings: extracted.warnings,
            cost_amount: derivedUnitCost,
            currency_code: currencyCode,
            status: "in_stock",
            location_code: parsed.location_code ?? null,
            acquired_at: purchaseInput.acquired_at,
            metadata: parsed.metadata || {},
          },
        },
      };
    }
    case "update_stock_status_from_images": {
      const parsed = updateStockStatusFromImagesSchema.parse(rawParams);
      const extracted = await getRecentImageBatchOrThrow(actor);
      const resolved = await resolveStockMatchesFromCandidates(extracted.candidates);

      if (resolved.matches.length === 0) {
        throw new Error("No encontré unidades existentes para los IMEIs/seriales de las imágenes recientes.");
      }

      if (resolved.unmatched.length > 0) {
        throw new Error(
          `No encontré stock para: ${resolved.unmatched
            .slice(0, 10)
            .map((candidate) => candidate.imei_1 || candidate.imei_2 || candidate.serial_number || "sin identificador")
            .join(" | ")}`
        );
      }

      const computedSoldAt = parsed.status === "sold" ? parsed.sold_at ?? new Date().toISOString() : parsed.sold_at;

      return {
        command,
        summary: [
          `Actualizar ${resolved.matches.length} unidades desde imágenes`,
          `• Estado nuevo: ${parsed.status}`,
          computedSoldAt ? `• sold_at: ${computedSoldAt}` : "",
          parsed.location_code ? `• location_code: ${parsed.location_code}` : "",
          ...resolved.matches.map(
            (match) =>
              `• #${match.id} · ${match.sku} · ${match.imei_1 || match.imei_2 || match.serial_number || "sin ref"} · ${match.status} → ${parsed.status}`
          ),
          extracted.warnings.length > 0 ? "• Advertencias OCR:" : "",
          ...extracted.warnings.slice(0, 5).map((warning) => `  - ${warning}`),
        ]
          .filter(Boolean)
          .join("\n"),
        payload: {
          status: parsed.status,
          sold_at: computedSoldAt ?? null,
          apply_sold_at: parsed.sold_at !== undefined || parsed.status === "sold",
          location_code: parsed.location_code ?? null,
          apply_location_code: parsed.location_code !== undefined,
          matches: resolved.matches.map((match) => ({
            stock_unit_id: match.id,
            sku: match.sku,
            title: match.title,
            current_status: match.status,
            serial_number: match.serial_number,
            imei_1: match.imei_1,
            imei_2: match.imei_2,
            source_message_ids: match.source_candidates.map((candidate) => candidate.source_message_id),
          })),
          warnings: extracted.warnings,
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
      let nextInventoryPurchaseId: number | null = null;
      let nextInventoryPurchaseNumber: string | null = null;

      if (parsed.changes.product_ref) {
        const product = await resolveProduct(parsed.changes.product_ref);
        nextProductId = product.id;
        nextSku = product.sku;
      }

      if (parsed.changes.inventory_purchase_ref) {
        const purchase = await resolveInventoryPurchaseForOperator(parsed.changes.inventory_purchase_ref);
        nextInventoryPurchaseId = purchase.id;
        nextInventoryPurchaseNumber = purchase.purchase_number;
      }

      return {
        command,
        summary: [
          `Actualizar ${uniqueStock.length} unidades de stock`,
          `• Referencias: ${uniqueStock
            .map((stock) => stock.serial_number || stock.imei_1 || stock.imei_2 || `#${stock.id}`)
            .join(", ")}`,
          nextInventoryPurchaseNumber ? `• Compra destino: ${nextInventoryPurchaseNumber}` : "",
          `• Cambios: ${Object.entries(parsed.changes)
            .map(([key, value]) => `${key}=${formatJsonPreview(value)}`)
            .join(", ")}`,
        ].join("\n"),
        payload: {
          stock_unit_ids: uniqueStock.map((stock) => stock.id),
          changes: parsed.changes,
          product_id: nextProductId,
          next_sku: nextSku,
          inventory_purchase_id: nextInventoryPurchaseId,
          inventory_purchase_number: nextInventoryPurchaseNumber,
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
          returning
            id,
            sku,
            title,
            cost_usd,
            logistics_usd,
            total_cost_usd,
            margin_pct,
            price_usd,
            usd_rate,
            price_amount,
            promo_price_ars,
            bancarizada_interest,
            bancarizada_total,
            bancarizada_cuota,
            macro_interest,
            macro_total,
            macro_cuota,
            cuotas_qty
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
      return [
        "Producto creado.",
        `• ID: ${product.id}`,
        `• SKU: ${product.sku}`,
        `• Título: ${product.title}`,
        ...buildPricingPreviewLines(product),
      ].join("\n");
    }
    case "update_product": {
      const parsed = z
        .object({
          product_id: z.coerce.number().int().positive(),
          sku: z.string(),
          title: z.string(),
          before_pricing: z.record(z.string(), z.unknown()).nullable().optional(),
          pricing_recalculated: z.boolean().optional(),
          changes: updateProductSchema.shape.changes,
        })
        .parse(payload);

      const entries = Object.entries(parsed.changes);
      const sql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
      const values = entries.map(([, value]) => value);
      const result = await client.query(
        `
          update public.products
          set ${sql}
          where id = $${values.length + 1}
          returning
            id,
            sku,
            title,
            cost_usd,
            logistics_usd,
            total_cost_usd,
            margin_pct,
            price_usd,
            usd_rate,
            price_amount,
            promo_price_ars,
            bancarizada_interest,
            bancarizada_total,
            bancarizada_cuota,
            macro_interest,
            macro_total,
            macro_cuota,
            cuotas_qty
        `,
        [...values, parsed.product_id]
      );

      const product = result.rows[0];
      await writeAudit(client, actor, "telegram.product.updated", "product", String(product.id), parsed.changes);
      return [
        "Producto actualizado.",
        `• ID: ${product.id}`,
        `• SKU: ${product.sku}`,
        `• Título: ${product.title}`,
        "• Campos aplicados:",
        ...Object.entries(parsed.changes).map(([key, value]) => `  - ${key}: ${formatJsonPreview(value)}`),
        parsed.pricing_recalculated ? "• Repricing aplicado desde settings." : "",
        ...buildPricingPreviewLines(product),
      ]
        .filter(Boolean)
        .join("\n");
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
    case "bulk_reprice_products": {
      const parsed = z
        .object({
          items: z
            .array(
              z.object({
                product_id: z.coerce.number().int().positive(),
                sku: z.string(),
                title: z.string(),
                previous_cost_usd: z.union([z.string(), z.number()]).nullable().optional(),
                previous_price_amount: z.union([z.string(), z.number()]).nullable().optional(),
                changes: z.record(z.string(), z.unknown()),
              })
            )
            .min(1),
        })
        .parse(payload);

      const updatedRows: Array<{ sku: string; price_amount: string | number | null; cost_usd: string | number | null }> = [];

      for (const item of parsed.items) {
        const entries = Object.entries(item.changes);
        const sql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
        const values = entries.map(([, value]) => value);
        const result = await client.query<{
          id: number;
          sku: string;
          cost_usd: string | number | null;
          price_amount: string | number | null;
        }>(
          `update public.products set ${sql} where id = $${values.length + 1} returning id, sku, cost_usd, price_amount`,
          [...values, item.product_id]
        );

        const row = result.rows[0];
        await writeAudit(client, actor, "telegram.product.repriced", "product", String(row.id), item.changes);
        updatedRows.push(row);
      }

      return [
        `Productos recalculados: ${updatedRows.length}`,
        ...updatedRows.map(
          (row) => `• ${row.sku} · cost_usd ${row.cost_usd ?? "-"} · precio ${formatMoney(row.price_amount, "ARS")}`
        ),
      ].join("\n");
    }
    case "bulk_sync_products": {
      const parsed = z
        .object({
          update_items: z
            .array(
              z.object({
                source_line: z.string(),
                source_section: z.string(),
                product_id: z.coerce.number().int().positive(),
                sku: z.string(),
                title: z.string(),
                previous_cost_usd: z.union([z.string(), z.number()]).nullable().optional(),
                previous_price_amount: z.union([z.string(), z.number()]).nullable().optional(),
                changes: z.record(z.string(), z.unknown()),
              })
            )
            .default([]),
          create_items: z.array(createProductSchema.extend({ source_line: z.string(), source_section: z.string() })).default([]),
        })
        .parse(payload);

      const resultLines: string[] = [];
      let updatedCount = 0;
      let createdCount = 0;

      for (const item of parsed.update_items) {
        const entries = Object.entries(item.changes);
        const sql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
        const values = entries.map(([, value]) => value);
        const result = await client.query<{
          id: number;
          sku: string;
          cost_usd: string | number | null;
          price_amount: string | number | null;
        }>(
          `update public.products set ${sql} where id = $${values.length + 1} returning id, sku, cost_usd, price_amount`,
          [...values, item.product_id]
        );

        const row = result.rows[0];
        await writeAudit(client, actor, "telegram.product.synced_repriced", "product", String(row.id), {
          source_line: item.source_line,
          source_section: item.source_section,
          changes: item.changes,
        });
        updatedCount += 1;
        resultLines.push(`• ${row.sku} actualizado · cost_usd ${row.cost_usd ?? "-"} · ${formatMoney(row.price_amount, "ARS")}`);
      }

      for (const createItem of parsed.create_items) {
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
            returning id, sku, title, cost_usd, price_amount
          `,
          [
            createItem.sku,
            createItem.slug || slugify(createItem.sku),
            createItem.brand || inferBrand(createItem.title),
            createItem.model || inferModel(createItem.title, createItem.brand || inferBrand(createItem.title)),
            createItem.title,
            createItem.description ?? null,
            createItem.condition || "new",
            createItem.price_amount ?? null,
            createItem.currency_code || "ARS",
            createItem.active ?? true,
            createItem.category ?? null,
            createItem.cost_usd ?? null,
            createItem.logistics_usd ?? null,
            createItem.total_cost_usd ?? null,
            createItem.margin_pct ?? null,
            createItem.price_usd ?? null,
            createItem.promo_price_ars ?? null,
            createItem.bancarizada_total ?? null,
            createItem.bancarizada_cuota ?? null,
            createItem.bancarizada_interest ?? null,
            createItem.macro_total ?? null,
            createItem.macro_cuota ?? null,
            createItem.macro_interest ?? null,
            createItem.cuotas_qty ?? null,
            createItem.in_stock ?? false,
            createItem.delivery_type ?? null,
            createItem.delivery_days ?? null,
            createItem.usd_rate ?? null,
            createItem.image_url || null,
            createItem.ram_gb ?? null,
            createItem.storage_gb ?? null,
            createItem.network ?? null,
            createItem.color ?? null,
            createItem.battery_health ?? null,
          ]
        );

        const row = result.rows[0];
        await writeAudit(client, actor, "telegram.product.synced_created", "product", String(row.id), {
          sku: row.sku,
          source_line: createItem.source_line,
          source_section: createItem.source_section,
        });
        createdCount += 1;
        resultLines.push(`• ${row.sku} creado · cost_usd ${row.cost_usd ?? "-"} · ${formatMoney(row.price_amount, "ARS")}`);
      }

      return [
        `Lista sincronizada.`,
        `• ${updatedCount} actualizados`,
        `• ${createdCount} creados`,
        ...limitCatalogSyncSummary(resultLines),
      ].join("\n");
    }
    case "delete_product": {
      const parsed = z
        .object({
          product_id: z.coerce.number().int().positive(),
          sku: z.string(),
          title: z.string(),
          checkout_intent_count: z.coerce.number().int().nonnegative().optional(),
        })
        .parse(payload);

      const stockCount = await client.query<{ count: string }>(
        "select count(*)::text as count from public.stock_units where product_id = $1",
        [parsed.product_id]
      );

      if (Number(stockCount.rows[0]?.count ?? 0) > 0) {
        throw new Error(
          `No puedo borrar ${parsed.sku} porque todavía tiene unidades de stock. Mové o liquidá el stock primero, o archivá el producto (active=false) en vez de borrarlo.`
        );
      }

      const checkoutIntentDelete = await client.query<{ id: string }>(
        "delete from public.storefront_checkout_intents where product_id = $1 returning id",
        [parsed.product_id]
      );

      await client.query("delete from public.products where id = $1", [parsed.product_id]);
      await writeAudit(client, actor, "telegram.product.deleted", "product", String(parsed.product_id), {
        sku: parsed.sku,
        title: parsed.title,
        deleted_checkout_intents: checkoutIntentDelete.rowCount ?? 0,
      });
      return [
        `Producto borrado.`,
        `• ID: ${parsed.product_id}`,
        `• SKU: ${parsed.sku}`,
        `• Checkout intents borrados: ${checkoutIntentDelete.rowCount ?? 0}`,
      ].join("\n");
    }
    case "update_meta_campaign": {
      const parsed = z
        .object({
          campaign_id: z.string().trim().min(1),
          name: z.string().nullable().optional(),
          current_status: z.string().nullable().optional(),
          current_daily_budget: z.union([z.string(), z.number()]).nullable().optional(),
          current_lifetime_budget: z.union([z.string(), z.number()]).nullable().optional(),
          changes: updateMetaCampaignSchema.shape.changes,
        })
        .parse(payload);

      const result = await updateMetaCampaign(parsed.campaign_id, parsed.changes);
      await writeAudit(client, actor, "telegram.meta.campaign.updated", "meta_campaign", parsed.campaign_id, parsed.changes);
      return [
        "Campaña actualizada.",
        `• ${result.name || parsed.name || parsed.campaign_id}`,
        `• ID: ${result.id}`,
        `• Estado: ${result.effective_status || result.status || "-"}`,
        result.daily_budget != null ? `• Presupuesto diario: ${formatMetaBudget(result.daily_budget)}` : "",
        result.lifetime_budget != null ? `• Presupuesto vitalicio: ${formatMetaBudget(result.lifetime_budget)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "update_meta_ad_set": {
      const parsed = z
        .object({
          ad_set_id: z.string().trim().min(1),
          name: z.string().nullable().optional(),
          campaign_id: z.string().nullable().optional(),
          current_status: z.string().nullable().optional(),
          current_daily_budget: z.union([z.string(), z.number()]).nullable().optional(),
          current_lifetime_budget: z.union([z.string(), z.number()]).nullable().optional(),
          changes: updateMetaAdSetSchema.shape.changes,
        })
        .parse(payload);

      const result = await updateMetaAdSet(parsed.ad_set_id, parsed.changes);
      await writeAudit(client, actor, "telegram.meta.ad_set.updated", "meta_ad_set", parsed.ad_set_id, parsed.changes);
      return [
        "Ad set actualizado.",
        `• ${result.name || parsed.name || parsed.ad_set_id}`,
        `• ID: ${result.id}`,
        result.campaign_id ? `• Campaign ID: ${result.campaign_id}` : "",
        `• Estado: ${result.effective_status || result.status || "-"}`,
        result.daily_budget != null ? `• Presupuesto diario: ${formatMetaBudget(result.daily_budget)}` : "",
        result.lifetime_budget != null ? `• Presupuesto vitalicio: ${formatMetaBudget(result.lifetime_budget)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "update_meta_ad": {
      const parsed = z
        .object({
          ad_id: z.string().trim().min(1),
          name: z.string().nullable().optional(),
          campaign_id: z.string().nullable().optional(),
          adset_id: z.string().nullable().optional(),
          current_status: z.string().nullable().optional(),
          changes: updateMetaAdSchema.shape.changes,
        })
        .parse(payload);

      const result = await updateMetaAd(parsed.ad_id, parsed.changes);
      await writeAudit(client, actor, "telegram.meta.ad.updated", "meta_ad", parsed.ad_id, parsed.changes);
      return [
        "Anuncio actualizado.",
        `• ${result.name || parsed.name || parsed.ad_id}`,
        `• ID: ${result.id}`,
        result.campaign_id ? `• Campaign ID: ${result.campaign_id}` : "",
        result.adset_id ? `• Ad set ID: ${result.adset_id}` : "",
        `• Estado: ${result.effective_status || result.status || "-"}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "create_inventory_purchase": {
      const parsed = createInventoryPurchaseSchema.parse(payload);
      const purchase = await createInventoryPurchase(client, parsed);

      if (!purchase) {
        throw new Error("No pude crear la compra de inventario.");
      }

      await writeAudit(client, actor, "telegram.inventory_purchase.created", "inventory_purchase", String(purchase.id), parsed);
      return [
        "Compra de inventario creada.",
        ...buildPurchaseSummaryLines(purchase),
        Array.isArray(purchase.funders) && purchase.funders.length > 0 ? "• Funders:" : "",
        ...buildFunderSummaryLines(purchase.funders as Array<Record<string, unknown>> | undefined),
        `• Stock vinculado: ${purchase.stock_units_total ?? 0}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "update_inventory_purchase": {
      const parsed = z
        .object({
          purchase_id: z.coerce.number().int().positive(),
          purchase_number: z.string(),
          changes: createInventoryPurchaseSchema,
        })
        .parse(payload);
      const purchase = await updateInventoryPurchase(client, parsed.purchase_id, parsed.changes);

      if (!purchase) {
        throw new Error(`No encontré la compra ${parsed.purchase_number}.`);
      }

      await writeAudit(
        client,
        actor,
        "telegram.inventory_purchase.updated",
        "inventory_purchase",
        String(purchase.id),
        parsed.changes
      );
      return [
        "Compra de inventario actualizada.",
        ...buildPurchaseSummaryLines(purchase),
        Array.isArray(purchase.funders) && purchase.funders.length > 0 ? "• Funders:" : "",
        ...buildFunderSummaryLines(purchase.funders as Array<Record<string, unknown>> | undefined),
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "create_stock_unit": {
      const parsed = createStockSchema
        .extend({
          product_id: z.coerce.number().int().positive(),
          inventory_purchase_id: z.coerce.number().int().positive(),
          sku: z.string(),
        })
        .parse(payload);

      const result = await client.query(
        `
          insert into public.stock_units (
            product_id, serial_number, imei_1, imei_2, inventory_purchase_id, color, battery_health, status, location_code, cost_amount, currency_code, acquired_at, metadata
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          returning id
        `,
        [
          parsed.product_id,
          parsed.serial_number ?? null,
          parsed.imei_1 ?? null,
          parsed.imei_2 ?? null,
          parsed.inventory_purchase_id,
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
          inventory_purchase_id: z.coerce.number().int().positive().optional(),
        })
        .parse(payload);

      const nextChanges = { ...parsed.changes } as Record<string, unknown>;
      delete nextChanges.product_ref;
      delete nextChanges.inventory_purchase_ref;
      if (parsed.product_id != null) {
        nextChanges.product_id = parsed.product_id;
      }
      if (parsed.inventory_purchase_id !== undefined) {
        nextChanges.inventory_purchase_id = parsed.inventory_purchase_id;
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
    case "create_stock_from_images": {
      const parsed = z
        .object({
          product_id: z.coerce.number().int().positive(),
          sku: z.string(),
          title: z.string(),
          inventory_purchase_id: z.coerce.number().int().positive(),
          inventory_purchase_number: z.string(),
          candidates: z.array(
            z.object({
              imei_1: z.string().nullable(),
              imei_2: z.string().nullable(),
              serial_number: z.string().nullable(),
              source_message_id: z.coerce.number().int().positive(),
              source_media_url: z.string(),
              notes: z.string().nullable(),
            })
          ),
          warnings: z.array(z.string()).optional(),
          cost_amount: z.coerce.number().finite().nonnegative().nullable().optional(),
          currency_code: z.string(),
          status: stockStatusSchema,
          location_code: z.string().nullable().optional(),
          acquired_at: z.string().datetime().nullable().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(payload);

      const createdRows: Array<{ id: number; ref: string }> = [];

      for (const candidate of parsed.candidates) {
        const result = await client.query<{ id: number }>(
          `
            insert into public.stock_units (
              product_id,
              serial_number,
              imei_1,
              imei_2,
              inventory_purchase_id,
              status,
              location_code,
              cost_amount,
              currency_code,
              acquired_at,
              metadata
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            returning id
          `,
          [
            parsed.product_id,
            candidate.serial_number ?? null,
            candidate.imei_1 ?? null,
            candidate.imei_2 ?? null,
            parsed.inventory_purchase_id,
            parsed.status,
            parsed.location_code ?? null,
            parsed.cost_amount ?? null,
            parsed.currency_code,
            parsed.acquired_at ?? null,
            {
              ...(parsed.metadata || {}),
              source: "telegram-image-batch",
              source_message_id: candidate.source_message_id,
              source_media_url: candidate.source_media_url,
              extracted_notes: candidate.notes ?? null,
              extraction_warnings: parsed.warnings || [],
            },
          ]
        );

        const stockId = result.rows[0].id;
        createdRows.push({
          id: stockId,
          ref: candidate.imei_1 || candidate.imei_2 || candidate.serial_number || `#${stockId}`,
        });
        await writeAudit(client, actor, "telegram.stock.created_from_images", "stock_unit", String(stockId), {
          product_id: parsed.product_id,
          sku: parsed.sku,
          inventory_purchase_id: parsed.inventory_purchase_id,
          source_message_id: candidate.source_message_id,
          source_media_url: candidate.source_media_url,
        });
      }

      return [
        `Stock creado desde imágenes: ${createdRows.length}`,
        `• Producto: ${parsed.sku}`,
        `• Compra: ${parsed.inventory_purchase_number}`,
        ...createdRows.map((row) => `• #${row.id} · ${row.ref}`),
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "create_inventory_purchase_from_images": {
      const parsed = z
        .object({
          purchase_input: createInventoryPurchaseSchema,
          stock_input: z.object({
            product_id: z.coerce.number().int().positive(),
            sku: z.string(),
            title: z.string(),
            candidates: z.array(
              z.object({
                imei_1: z.string().nullable(),
                imei_2: z.string().nullable(),
                serial_number: z.string().nullable(),
                source_message_id: z.coerce.number().int().positive(),
                source_media_url: z.string(),
                notes: z.string().nullable(),
              })
            ),
            warnings: z.array(z.string()).optional(),
            cost_amount: z.coerce.number().finite().nonnegative().nullable().optional(),
            currency_code: z.string(),
            status: stockStatusSchema,
            location_code: z.string().nullable().optional(),
            acquired_at: z.string().datetime().nullable().optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          }),
        })
        .parse(payload);

      const purchase = await createInventoryPurchase(client, parsed.purchase_input);
      if (!purchase) {
        throw new Error("No pude crear la compra de inventario.");
      }

      const createdRows: Array<{ id: number; ref: string }> = [];

      for (const candidate of parsed.stock_input.candidates) {
        const result = await client.query<{ id: number }>(
          `
            insert into public.stock_units (
              product_id,
              serial_number,
              imei_1,
              imei_2,
              inventory_purchase_id,
              status,
              location_code,
              cost_amount,
              currency_code,
              acquired_at,
              metadata
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            returning id
          `,
          [
            parsed.stock_input.product_id,
            candidate.serial_number ?? null,
            candidate.imei_1 ?? null,
            candidate.imei_2 ?? null,
            purchase.id,
            parsed.stock_input.status,
            parsed.stock_input.location_code ?? null,
            parsed.stock_input.cost_amount ?? null,
            parsed.stock_input.currency_code,
            parsed.stock_input.acquired_at ?? null,
            {
              ...(parsed.stock_input.metadata || {}),
              source: "telegram-image-batch",
              source_message_id: candidate.source_message_id,
              source_media_url: candidate.source_media_url,
              extracted_notes: candidate.notes ?? null,
              extraction_warnings: parsed.stock_input.warnings || [],
            },
          ]
        );

        const stockId = result.rows[0].id;
        createdRows.push({
          id: stockId,
          ref: candidate.imei_1 || candidate.imei_2 || candidate.serial_number || `#${stockId}`,
        });
        await writeAudit(client, actor, "telegram.stock.created_from_purchase_images", "stock_unit", String(stockId), {
          product_id: parsed.stock_input.product_id,
          sku: parsed.stock_input.sku,
          inventory_purchase_id: purchase.id,
          purchase_number: purchase.purchase_number,
          source_message_id: candidate.source_message_id,
        });
      }

      await writeAudit(client, actor, "telegram.inventory_purchase.created_from_images", "inventory_purchase", String(purchase.id), {
        product_id: parsed.stock_input.product_id,
        sku: parsed.stock_input.sku,
        stock_units_created: createdRows.length,
      });

      return [
        "Compra + stock creados desde imágenes.",
        ...buildPurchaseSummaryLines(purchase),
        `• Producto: ${parsed.stock_input.sku}`,
        `• Unidades creadas: ${createdRows.length}`,
        ...createdRows.map((row) => `• #${row.id} · ${row.ref}`),
      ].join("\n");
    }
    case "delete_stock_unit": {
      const parsed = z
        .object({
          stock_unit_id: z.coerce.number().int().positive(),
          sku: z.string(),
          status: stockStatusSchema,
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
          inventory_purchase_id: z.coerce.number().int().positive().optional(),
        })
        .parse(payload);

      const nextChanges = { ...parsed.changes } as Record<string, unknown>;
      delete nextChanges.product_ref;
      delete nextChanges.inventory_purchase_ref;
      if (parsed.product_id != null) {
        nextChanges.product_id = parsed.product_id;
      }
      if (parsed.inventory_purchase_id !== undefined) {
        nextChanges.inventory_purchase_id = parsed.inventory_purchase_id;
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
    case "update_stock_status_from_images": {
      const parsed = z
        .object({
          status: stockStatusSchema,
          sold_at: z.string().datetime().nullable().optional(),
          apply_sold_at: z.boolean().optional(),
          location_code: z.string().nullable().optional(),
          apply_location_code: z.boolean().optional(),
          matches: z.array(
            z.object({
              stock_unit_id: z.coerce.number().int().positive(),
              sku: z.string(),
              title: z.string(),
              current_status: z.string(),
              serial_number: z.string().nullable().optional(),
              imei_1: z.string().nullable().optional(),
              imei_2: z.string().nullable().optional(),
              source_message_ids: z.array(z.coerce.number().int().positive()).optional(),
            })
          ),
        })
        .parse(payload);

      const results: Array<{ id: number; sku: string; status: string }> = [];

      for (const match of parsed.matches) {
        const nextChanges: Record<string, unknown> = {
          status: parsed.status,
        };

        if (parsed.apply_location_code) {
          nextChanges.location_code = parsed.location_code ?? null;
        }

        if (parsed.apply_sold_at) {
          nextChanges.sold_at = parsed.sold_at ?? null;
        }

        const entries = Object.entries(nextChanges);
        const sql = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
        const values = entries.map(([, value]) => value);
        const result = await client.query<{ id: number; status: string }>(
          `update public.stock_units set ${sql} where id = $${values.length + 1} returning id, status`,
          [...values, match.stock_unit_id]
        );

        const row = result.rows[0];
        results.push({ id: row.id, sku: match.sku, status: row.status });
        await writeAudit(client, actor, "telegram.stock.updated_from_images", "stock_unit", String(row.id), {
          ...nextChanges,
          source_message_ids: match.source_message_ids || [],
        });
      }

      return [
        `Stock actualizado desde imágenes: ${results.length}`,
        ...results.map((row) => `• #${row.id} · ${row.sku} · ${row.status}`),
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
    return "No encontré una acción pendiente para aprobar.";
  }

  if (pending.status !== "pending") {
    return `Esa acción ya no está pendiente (${pending.status}).`;
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
    return "Esa acción venció. Pedime una nueva.";
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
    return resultText;
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
    return "No encontré una acción pendiente para cancelar.";
  }

  await saveOperatorEventMessage(actor, `Acción cancelada: ${token}`, {
    kind: "operator_confirmation_cancelled",
    token,
  });

  return "Listo, cancelado.";
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
    "Keep the reply short and natural. Do not dump schema explanations, command names, or validation rules unless explicitly asked.",
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

function parseLooseLocaleNumber(value: string) {
  const trimmed = value.replace(/[^\d,.-]/g, "").trim();
  if (!trimmed) {
    return null;
  }

  const normalized =
    trimmed.includes(",") && trimmed.includes(".")
      ? trimmed.replace(/\./g, "").replace(",", ".")
      : trimmed.includes(",")
        ? trimmed.replace(",", ".")
        : trimmed;

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanMetaReferenceText(value: string) {
  return value
    .replace(/^[\s:,-]+/, "")
    .replace(/\b(?:la|el|los|las|de|del|al|para|en)\b/gi, " ")
    .replace(/\b(?:a|en|por)\b\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMetaStatusFilter(text: string) {
  if (/\b(active|activo|activa|activos|activas)\b/i.test(text)) return "active";
  if (/\b(paused|pausado|pausada|pausados|pausadas)\b/i.test(text)) return "paused";
  if (/\b(archived|archivado|archivada)\b/i.test(text)) return "archived";
  if (/\b(deleted|borrado|eliminado)\b/i.test(text)) return "deleted";
  return undefined;
}

function stripMetaReadNoise(text: string, entityPattern: RegExp, status?: string) {
  let next = text;
  next = next.replace(/\b(?:mostrame|mostra|mostrar|mostrame|ver|dame|decime|quiero ver|listame|lista|listá|mostra me)\b/gi, " ");
  next = next.replace(entityPattern, " ");
  if (status) {
    const statusPattern =
      status === "active"
        ? /\b(active|activo|activa|activos|activas)\b/gi
        : status === "paused"
          ? /\b(paused|pausado|pausada|pausados|pausadas)\b/gi
          : status === "archived"
            ? /\b(archived|archivado|archivada)\b/gi
            : /\b(deleted|borrado|eliminado)\b/gi;
    next = next.replace(statusPattern, " ");
  }

  next = next.replace(/\b(?:de|del|la|el|los|las)\b/gi, " ");
  next = next.replace(/\s+/g, " ").trim();
  return next || undefined;
}

function parseQuickMetaDraft(text: string): Draft | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const entityDefinitions = [
    {
      entityKind: "campaign" as const,
      readCommand: "list_meta_campaigns" as const,
      writeCommand: "update_meta_campaign" as const,
      refKey: "campaign_ref" as const,
      nounPattern: /\b(campa(?:ñ|n)as?|campaigns?)\b/i,
      budgetAllowed: true,
    },
    {
      entityKind: "ad_set" as const,
      readCommand: "list_meta_ad_sets" as const,
      writeCommand: "update_meta_ad_set" as const,
      refKey: "ad_set_ref" as const,
      nounPattern: /\b(ad sets?|adsets?|conjuntos?)\b/i,
      budgetAllowed: true,
    },
    {
      entityKind: "ad" as const,
      readCommand: "list_meta_ads" as const,
      writeCommand: "update_meta_ad" as const,
      refKey: "ad_ref" as const,
      nounPattern: /\b(ads?|anuncios?)\b/i,
      budgetAllowed: false,
    },
  ];

  for (const definition of entityDefinitions) {
    if (!definition.nounPattern.test(trimmed)) {
      continue;
    }

    const readStatus = parseMetaStatusFilter(trimmed);
    const wantsRead =
      /\b(?:mostrame|mostra|mostrar|ver|dame|decime|listame|lista|listá)\b/i.test(trimmed) ||
      (Boolean(readStatus) && !/\b(?:paus[aá]|pausa|deten[eé]|par[aá]|stop|activ[aá]|activa|activar|habilit[aá]|habilita|reanuda|encend[eé]|presupuesto)\b/i.test(trimmed));

    if (wantsRead) {
      const status = readStatus;
      const query = stripMetaReadNoise(trimmed, definition.nounPattern, status);
      return {
        mode: "read",
        command: definition.readCommand,
        params: {
          ...(status ? { status } : {}),
          ...(query ? { query } : {}),
          limit: 24,
        },
      };
    }

    const nextStatus = /\b(?:paus[aá]|pausa|deten[eé]|par[aá]|stop)\b/i.test(trimmed)
      ? "PAUSED"
      : /\b(?:activ[aá]|activa|activar|habilit[aá]|habilita|reanuda|encend[eé])\b/i.test(trimmed)
        ? "ACTIVE"
        : null;

    if (nextStatus) {
      const entityMatch = trimmed.match(definition.nounPattern);
      const reference = cleanMetaReferenceText(trimmed.slice((entityMatch?.index ?? 0) + (entityMatch?.[0].length ?? 0)));
      if (!reference) {
        return {
          mode: "clarify",
          reply: `Decime qué ${getMetaEntityLabel(definition.entityKind)} querés ${nextStatus === "PAUSED" ? "pausar" : "activar"}.`,
        };
      }

      return {
        mode: "write",
        command: definition.writeCommand,
        params: {
          [definition.refKey]: reference,
          changes: { status: nextStatus },
        },
      };
    }

    if (definition.budgetAllowed && /\bpresupuesto\b/i.test(trimmed)) {
      const amountMatches = [...trimmed.matchAll(/[$]?\s*([0-9][0-9.,]*)/g)];
      const amountMatch = amountMatches.at(-1);
      const amount = amountMatch ? parseLooseLocaleNumber(amountMatch[1]) : null;
      const entityMatch = trimmed.match(definition.nounPattern);

      if (!amountMatch || amount == null || !entityMatch) {
        return {
          mode: "clarify",
          reply: `Pasame el ${getMetaEntityLabel(definition.entityKind)} y el presupuesto nuevo.`,
        };
      }

      const reference = cleanMetaReferenceText(
        trimmed.slice((entityMatch.index ?? 0) + entityMatch[0].length, amountMatch.index ?? trimmed.length)
      );
      if (!reference) {
        return {
          mode: "clarify",
          reply: `Decime qué ${getMetaEntityLabel(definition.entityKind)} querés actualizar.`,
        };
      }

      const budgetKey =
        /\b(vitalicio|lifetime|por vida|total)\b/i.test(trimmed) ? "lifetime_budget" : "daily_budget";

      return {
        mode: "write",
        command: definition.writeCommand,
        params: {
          [definition.refKey]: reference,
          changes: { [budgetKey]: amount },
        },
      };
    }
  }

  return null;
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

  const productSearchCommand = parseQuickProductSearchCommand(text);
  if (productSearchCommand) {
    return productSearchCommand;
  }

  return null;
}

function parseQuickProductSearchCommand(text: string): { command: ReadCommandName; params: Record<string, unknown> } | null {
  const normalized = normalizeMatch(text);

  if (!normalized) {
    return null;
  }

  const hasSearchVerb =
    /\b(search|find|look|show|list|browse|buscar|busca|mostrar|mostrame|lista|listar|ver)\b/.test(normalized) ||
    normalized.includes("look for") ||
    normalized.includes("show me");
  const hasProductNoun = /\b(product|products|producto|productos|catalog|catalogo|catalogos)\b/.test(normalized);
  const hasDeviceHint =
    /\b(iphone|samsung|galaxy|xiaomi|redmi|poco|pixel|motorola|moto|infinix|realme|oppo|vivo|nokia|oneplus)\b/.test(
      normalized
    );

  if (!hasSearchVerb || (!hasProductNoun && !hasDeviceHint)) {
    return null;
  }

  const wantsCheapest =
    /\b(cheap|cheapest|economico|economica|barato|barata)\b/.test(normalized) ||
    normalized.includes("mas barato") ||
    normalized.includes("mas barata");
  const wantsInStock = /\b(in stock|available|available now|disponible|disponibles|stock)\b/.test(normalized);
  const wantsImages = /\b(with image|with images|image|images|con imagen|con imagenes)\b/.test(normalized);

  const query = normalized
    .replace(/\bsearch for\b/g, " ")
    .replace(/\blook for\b/g, " ")
    .replace(/\bshow me\b/g, " ")
    .replace(/\b(search|find|look|show|list|browse|buscar|busca|mostrar|mostrame|lista|listar|ver)\b/g, " ")
    .replace(/\b(product|products|producto|productos|catalog|catalogo|catalogos)\b/g, " ")
    .replace(/\b(cheap|cheapest|economico|economica|barato|barata)\b/g, " ")
    .replace(/\b(with image|with images|image|images|con imagen|con imagenes)\b/g, " ")
    .replace(/\b(in stock|available now|available|disponible|disponibles|stock)\b/g, " ")
    .replace(/\b(my|the|me|a|an|el|la|los|las|un|una|unos|unas)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const params: Record<string, unknown> = {
    active: true,
    limit: 24,
  };

  if (query) {
    params.query = query;
  }

  if (wantsCheapest) {
    params.sort_by = "price";
    params.sort_dir = "asc";
  }

  if (wantsInStock) {
    params.in_stock = true;
  }

  if (wantsImages) {
    params.has_image = true;
  }

  return {
    command: "list_products",
    params,
  };
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

async function tryResumePendingResolution(actor: ActorContext): Promise<OperatorMessageResult | null> {
  const prompt = await getLatestResolutionPrompt(actor);
  if (!prompt) {
    return null;
  }

  if (prompt.kind === "product_resolution_prompt") {
    const selected = resolveProductSelectionFromPrompt(actor.userMessage, prompt);
    if (!selected) {
      return null;
    }

    await saveOperatorEventMessage(actor, `Producto resuelto: ${selected.sku}`, {
      kind: "product_resolution_selected",
      reference: prompt.reference,
      sku: selected.sku,
      title: selected.title,
    });

    const resumedDraft: Draft = {
      mode: prompt.mode,
      command: prompt.command,
      params: setValueAtPath(prompt.params, prompt.reference_path, selected.sku),
    };

    return resolveTelegramOperatorDraft(actor, resumedDraft);
  }

  if (prompt.kind === "purchase_resolution_prompt") {
    const selected = resolvePurchaseSelectionFromPrompt(actor.userMessage, prompt);
    if (!selected) {
      return null;
    }

    await saveOperatorEventMessage(
      actor,
      selected.is_create_new ? "Compra nueva seleccionada" : `Compra resuelta: ${selected.purchase_number}`,
      {
        kind: "purchase_resolution_selected",
        reference: prompt.reference,
        purchase_number: selected.purchase_number,
        is_create_new: Boolean(selected.is_create_new),
      }
    );

    if (selected.is_create_new) {
      if (prompt.command === "create_stock_from_images") {
        const resumedDraft: Draft = {
          mode: "write",
          command: "create_inventory_purchase_from_images",
          params: {
            ...prompt.params,
            status: "draft",
          },
        };
        return resolveTelegramOperatorDraft(actor, resumedDraft);
      }

      return {
        kind: "reply",
        text:
          "Perfecto. Para esa carga primero necesito una compra nueva. Podés responder algo como: “creá compra nueva total 5000 USD, Fran 50% cash y Agus 50% crypto” o usar la opción de compra + stock desde fotos.",
        forceReply: true,
      };
    }

    const resumedDraft: Draft = {
      mode: prompt.mode,
      command: prompt.command,
      params: setValueAtPath(prompt.params, prompt.reference_path, selected.purchase_number),
    };

    return resolveTelegramOperatorDraft(actor, resumedDraft);
  }

  const selected = resolveMetaObjectSelectionFromPrompt(actor.userMessage, prompt);
  if (!selected) {
    return null;
  }

  await saveOperatorEventMessage(actor, `${getMetaEntityLabel(prompt.entity_kind)} resuelto: ${selected.id}`, {
    kind: "meta_object_resolution_selected",
    reference: prompt.reference,
    entity_kind: prompt.entity_kind,
    entity_id: selected.id,
    name: selected.name,
  });

  const resumedDraft: Draft = {
    mode: prompt.mode,
    command: prompt.command,
    params: setValueAtPath(prompt.params, prompt.reference_path, selected.id),
  };

  return resolveTelegramOperatorDraft(actor, resumedDraft);
}

function looksLikeCatalogSyncPaste(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return false;
  }

  let priceLines = 0;
  let sectionLines = 0;
  for (const line of lines) {
    if (canonicalizeCatalogSyncSection(line)) {
      sectionLines += 1;
    }
    if (/^(.*)\s*[-–—]\s*([0-9]+(?:[.,][0-9]+)?)\s*usd\s*$/i.test(line)) {
      priceLines += 1;
    }
  }

  if (sectionLines >= 1 && priceLines >= 2) {
    return true;
  }
  if (priceLines >= 5) {
    return true;
  }
  return false;
}

function tryParseQuickBulkSyncDraft(text: string): Draft | null {
  if (!looksLikeCatalogSyncPaste(text)) {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length < 24) {
    return null;
  }

  if (/^(hola|hey|buenas|help|ayuda|menu|menú|\/start)\b/i.test(trimmed) && trimmed.length < 100) {
    return null;
  }

  return {
    mode: "write",
    command: "bulk_sync_products",
    params: {
      raw_list: trimmed,
      create_missing: true,
    },
  };
}

export async function handleTelegramOperatorMessage(actor: ActorContext): Promise<OperatorMessageResult> {
  const resumedResolution = await tryResumePendingResolution(actor);
  if (resumedResolution) {
    return resumedResolution;
  }

  const quickBulkSync = tryParseQuickBulkSyncDraft(actor.userMessage);
  if (quickBulkSync) {
    const snapshot = await buildOperatorSnapshot();
    const conversationMemory = await loadConversationMemory(actor.conversationId);
    return resolveTelegramOperatorDraft(actor, quickBulkSync, snapshot, conversationMemory);
  }

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

  const workflowHelpIntent = parseWorkflowHelpIntent(actor.userMessage);
  if (workflowHelpIntent) {
    const menuReply = buildOperatorMenuReply(workflowHelpIntent);
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

  const quickMetaDraft = parseQuickMetaDraft(actor.userMessage);
  if (quickMetaDraft) {
    const result = await resolveTelegramOperatorDraft(actor, quickMetaDraft);
    if (result.kind === "reply") {
      return result;
    }

    return {
      kind: "reply",
      text: await generateChatReply({
        systemPrompt: result.systemPrompt,
        prompt: result.prompt,
        imageBase64: actor.imageBase64,
      }),
    };
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

    const prepared = await prepareWriteCommand(actor, draft.command as WriteCommandName, params);
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
        text: resultText,
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
    if (error instanceof ProductReferenceAmbiguityError) {
      const referencePath = findProductReferencePaths(params, error.reference)[0] ?? [];
      const promptPayload: ProductResolutionPromptPayload | null =
        referencePath.length > 0
          ? {
              kind: "product_resolution_prompt",
              mode: draft.mode,
              command: draft.command as ReadCommandName | WriteCommandName,
              params,
              reference: error.reference,
              reference_path: referencePath,
              options: error.options,
            }
          : null;

      if (promptPayload) {
        await saveOperatorEventMessage(actor, `Resolución pendiente para producto: ${error.reference}`, promptPayload);
        return buildProductResolutionReply(promptPayload);
      }
    }

    if (error instanceof PurchaseReferenceAmbiguityError) {
      const referencePath =
        error.referencePath.length > 0
          ? error.referencePath
          : findPurchaseReferencePaths(params, error.reference)[0] ?? [];
      const promptPayload: PurchaseResolutionPromptPayload | null =
        referencePath.length > 0
          ? {
              kind: "purchase_resolution_prompt",
              mode: "write",
              command: draft.command as WriteCommandName,
              params,
              reference: error.reference,
              reference_path: referencePath,
              options: error.options,
            }
          : null;

      if (promptPayload) {
        await saveOperatorEventMessage(actor, `Resolución pendiente para compra: ${error.reference}`, promptPayload);
        return buildPurchaseResolutionReply(promptPayload);
      }
    }

    if (error instanceof MetaObjectReferenceAmbiguityError) {
      const referencePath =
        error.referencePath.length > 0
          ? error.referencePath
          : findMetaReferencePaths(params, error.reference)[0] ?? [];
      const promptPayload: MetaObjectResolutionPromptPayload | null =
        referencePath.length > 0
          ? {
              kind: "meta_object_resolution_prompt",
              mode: draft.mode,
              command: draft.command as ReadCommandName | WriteCommandName,
              params,
              reference: error.reference,
              reference_path: referencePath,
              entity_kind: error.entityKind,
              options: error.options,
            }
          : null;

      if (promptPayload) {
        await saveOperatorEventMessage(
          actor,
          `Resolución pendiente para ${getMetaEntityLabel(error.entityKind)}: ${error.reference}`,
          promptPayload
        );
        return buildMetaObjectResolutionReply(promptPayload);
      }
    }

    const message = formatOperatorError(error);
    return {
      kind: "reply",
      text: message,
      forceReply: /ambigu/i.test(message),
    };
  }
}
