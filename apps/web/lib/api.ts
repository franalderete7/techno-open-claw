import { existsSync } from "node:fs";

export function normalizeApiBaseUrl(rawUrl: string) {
  if (existsSync("/.dockerenv")) {
    return rawUrl;
  }

  try {
    const url = new URL(rawUrl);

    if (url.hostname === "api") {
      url.hostname = "127.0.0.1";
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

const apiBaseUrl = normalizeApiBaseUrl(process.env.INTERNAL_API_BASE_URL || "http://127.0.0.1:4000");
const apiBearerToken = process.env.INTERNAL_API_BEARER_TOKEN || "";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiBearerToken}`);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function apiFetch<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export type DashboardResponse = {
  products: number;
  inStockUnits: number;
  customers: number;
  openConversations: number;
  orders: number;
  inventoryPurchases: number;
};

export type ListResponse<T> = {
  items: T[];
};

export type ProductRecord = {
  id: number;
  legacy_source_id?: number | null;
  sku: string;
  slug: string;
  brand: string;
  model: string;
  title: string;
  description: string | null;
  category?: string | null;
  condition: string;
  price_amount: number | null;
  cost_usd?: number | null;
  logistics_usd?: number | null;
  total_cost_usd?: number | null;
  margin_pct?: number | null;
  price_usd?: number | null;
  currency_code: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  in_stock: boolean;
  stock_units_total: number;
  stock_units_available: number;
  stock_units_reserved: number;
  stock_units_sold: number;
  promo_price_ars: number | null;
  bancarizada_total?: number | null;
  bancarizada_cuota?: number | null;
  bancarizada_interest?: number | null;
  macro_total?: number | null;
  macro_cuota?: number | null;
  macro_interest?: number | null;
  cuotas_qty?: number | null;
  delivery_type?: string | null;
  delivery_days?: number | null;
  usd_rate?: number | null;
  image_url: string | null;
  ram_gb: number | null;
  storage_gb: number | null;
  network: string | null;
  color: string | null;
  battery_health: number | null;
};

export type StockRecord = {
  id: number;
  serial_number: string | null;
  imei_1: string | null;
  imei_2: string | null;
  inventory_purchase_id: number;
  color: string | null;
  battery_health: number | null;
  status: string;
  location_code: string | null;
  cost_amount: number | null;
  currency_code: string;
  acquired_at: string | null;
  sold_at: string | null;
  metadata: Record<string, unknown>;
  product_id: number;
  sku: string;
  brand: string;
  model: string;
  title: string;
};

export type InventoryPurchaseFunderRecord = {
  id: number;
  funder_name: string;
  payment_method: string | null;
  amount_amount: number | null;
  currency_code: string;
  share_pct: number | null;
  notes?: string | null;
};

export type InventoryPurchaseListRecord = {
  id: number;
  purchase_number: string;
  supplier_name: string | null;
  currency_code: string;
  total_amount: number | null;
  status: string;
  acquired_at: string | null;
  created_at: string;
  funders: InventoryPurchaseFunderRecord[];
  funders_count: number;
  stock_units_count: number;
  stock_units_in_stock: number;
  stock_units_sold: number;
};

export type InventoryPurchaseStockUnitRecord = {
  id: number;
  product_id: number;
  serial_number: string | null;
  imei_1: string | null;
  imei_2: string | null;
  color: string | null;
  battery_health: number | null;
  status: string;
  location_code: string | null;
  cost_amount: number | null;
  currency_code: string;
  acquired_at: string | null;
  sold_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  sku: string;
  slug: string;
  brand: string;
  model: string;
  title: string;
  sold_order_id: number | null;
  sold_order_number: string | null;
  sale_currency_code: string | null;
  sale_amount: number | null;
  sale_recorded_at: string | null;
  usd_rate_used: number;
  revenue_amount_ars: number | null;
  cost_amount_ars: number | null;
  profit_amount_ars: number | null;
};

export type InventoryPurchaseDetailRecord = {
  id: number;
  purchase_number: string;
  supplier_name: string | null;
  currency_code: string;
  total_amount: number | null;
  status: string;
  acquired_at: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  default_usd_rate: number;
  funders: InventoryPurchaseFunderRecord[];
  stock_units_total: number;
  stock_units_in_stock: number;
  stock_units_sold: number;
  stock_units: InventoryPurchaseStockUnitRecord[];
};

export type CustomerRecord = {
  id: number;
  external_ref: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationRecord = {
  id: number;
  channel: string;
  channel_thread_key: string;
  status: string;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  customer_id: number | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

export type ConversationMessageRecord = {
  id: number;
  direction: string;
  sender_kind: string;
  message_type: string;
  text_body: string | null;
  media_url: string | null;
  transcript: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type OrderRecord = {
  id: number;
  order_number: string;
  status: string;
  source: string;
  currency_code: string;
  subtotal_amount: number | null;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customer_id: number | null;
  customer_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

export type OrderItemRecord = {
  id: number;
  order_id: number;
  product_id: number | null;
  stock_unit_id: number | null;
  title_snapshot: string;
  quantity: number;
  unit_price_amount: number;
  currency_code: string;
  created_at: string;
  sku: string | null;
  slug: string | null;
  brand: string | null;
  model: string | null;
  product_title: string | null;
  serial_number: string | null;
  imei_1: string | null;
  imei_2: string | null;
  stock_status: string | null;
  location_code: string | null;
};

export type OrderCheckoutIntentRecord = {
  id: number;
  order_id: number;
  product_id: number;
  token: string;
  channel: string;
  source_host: string | null;
  status: string;
  customer_phone: string | null;
  customer_name: string | null;
  title_snapshot: string;
  unit_price_amount: number;
  currency_code: string;
  image_url_snapshot: string | null;
  delivery_days_snapshot: number | null;
  galio_reference_id: string | null;
  galio_payment_url: string | null;
  galio_proof_token: string | null;
  galio_payment_id: string | null;
  galio_payment_status: string | null;
  metadata: Record<string, unknown>;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  sku: string | null;
  slug: string | null;
  brand: string | null;
  model: string | null;
};

export type OrderAuditRecord = {
  id: number;
  actor_type: string;
  actor_id: string | null;
  action: string;
  metadata: unknown;
  created_at: string;
};

export type OrderDetailRecord = {
  id: number;
  order_number: string;
  customer_id: number | null;
  source: string;
  status: string;
  currency_code: string;
  subtotal_amount: number | null;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
};

export type OrderDetailResponse = {
  order: OrderDetailRecord;
  items: OrderItemRecord[];
  checkout_intents: OrderCheckoutIntentRecord[];
  audit: OrderAuditRecord[];
};

export type SettingRecord = {
  key: string;
  value: unknown;
  description?: string | null;
  updated_at: string;
};

export type AuditRecord = {
  id: number;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: unknown;
  created_at: string;
};

export type SchemaRelationshipRecord = {
  constraint_name: string;
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  update_rule: string;
  delete_rule: string;
};

export type SchemaColumnRecord = {
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
};

export type SchemaTableRecord = {
  name: string;
  row_estimate: number;
  relationship_count: number;
  columns: SchemaColumnRecord[];
};

export type SchemaResponse = {
  tables: SchemaTableRecord[];
  relationships: SchemaRelationshipRecord[];
};

export type StorefrontPaymentIntentCreateResponse = {
  order_id: number;
  token: string;
  redirect_url: string;
  whatsapp_message: string;
  product_title: string;
  price_amount: number;
  currency_code: string;
};

export async function getDashboard() {
  return apiFetch<DashboardResponse>("/v1/dashboard");
}

export async function getProducts(limit = 50, options?: { active?: boolean }) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (options?.active != null) {
    params.set("active", String(options.active));
  }

  return apiFetch<ListResponse<ProductRecord>>(`/v1/products?${params.toString()}`);
}

export async function getStock(limit = 50) {
  return apiFetch<ListResponse<StockRecord>>(`/v1/stock?limit=${limit}`);
}

export async function getOrders(limit = 50) {
  return apiFetch<ListResponse<OrderRecord>>(`/v1/orders?limit=${limit}`);
}

export async function getInventoryPurchases(limit = 50, options?: { q?: string; status?: string }) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (options?.q) {
    params.set("q", options.q);
  }
  if (options?.status) {
    params.set("status", options.status);
  }

  return apiFetch<ListResponse<InventoryPurchaseListRecord>>(`/v1/inventory-purchases?${params.toString()}`);
}

export async function getInventoryPurchaseDetail(purchaseId: number) {
  return apiFetch<InventoryPurchaseDetailRecord>(`/v1/inventory-purchases/${purchaseId}`);
}

export async function getOrderDetail(orderId: number) {
  return apiFetch<OrderDetailResponse>(`/v1/orders/${orderId}`);
}

export async function getCustomers(limit = 50) {
  return apiFetch<ListResponse<CustomerRecord>>(`/v1/customers?limit=${limit}`);
}

export async function getConversations(limit = 50) {
  return apiFetch<ListResponse<ConversationRecord>>(`/v1/conversations?limit=${limit}`);
}

export async function getConversationMessages(conversationId: number) {
  return apiFetch<ListResponse<ConversationMessageRecord>>(`/v1/conversations/${conversationId}/messages`);
}

export async function getSettings() {
  return apiFetch<ListResponse<SettingRecord>>("/v1/settings");
}

export async function getAudit(limit = 100) {
  return apiFetch<ListResponse<AuditRecord>>(`/v1/audit?limit=${limit}`);
}

export async function getSchema() {
  return apiFetch<SchemaResponse>("/v1/schema");
}

export async function createStorefrontPaymentIntent(payload: {
  product_id: number;
  source_host?: string | null;
  source_path?: string | null;
  channel?: "storefront" | "whatsapp" | "telegram" | "api";
}) {
  return apiRequest<StorefrontPaymentIntentCreateResponse>("/v1/storefront/payment-intents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
