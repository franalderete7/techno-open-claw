import { existsSync } from "node:fs";

function normalizeApiBaseUrl(rawUrl: string) {
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

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiBearerToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export type DashboardResponse = {
  products: number;
  inStockUnits: number;
  customers: number;
  openConversations: number;
  orders: number;
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
  delivery_days?: number | null;
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
  color: string | null;
  battery_health: number | null;
  status: string;
  location_code: string | null;
  cost_amount: number | null;
  currency_code: string;
  acquired_at: string | null;
  sold_at: string | null;
  product_id: number;
  sku: string;
  brand: string;
  model: string;
  title: string;
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
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
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

export async function getDashboard() {
  return apiFetch<DashboardResponse>("/v1/dashboard");
}

export async function getProducts(limit = 50) {
  return apiFetch<ListResponse<ProductRecord>>(`/v1/products?limit=${limit}`);
}

export async function getStock(limit = 50) {
  return apiFetch<ListResponse<StockRecord>>(`/v1/stock?limit=${limit}`);
}

export async function getOrders(limit = 50) {
  return apiFetch<ListResponse<OrderRecord>>(`/v1/orders?limit=${limit}`);
}

export async function getCustomers(limit = 50) {
  return apiFetch<ListResponse<CustomerRecord>>(`/v1/customers?limit=${limit}`);
}

export async function getConversations(limit = 50) {
  return apiFetch<ListResponse<ConversationRecord>>(`/v1/conversations?limit=${limit}`);
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
