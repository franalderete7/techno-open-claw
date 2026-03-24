const apiBaseUrl = process.env.INTERNAL_API_BASE_URL || "http://127.0.0.1:4000";
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

export async function getDashboard() {
  return apiFetch<DashboardResponse>("/v1/dashboard");
}

export async function getProducts() {
  return apiFetch<ListResponse<Record<string, unknown>>>("/v1/products?limit=50");
}

export async function getStock() {
  return apiFetch<ListResponse<Record<string, unknown>>>("/v1/stock?limit=50");
}

export async function getOrders() {
  return apiFetch<ListResponse<Record<string, unknown>>>("/v1/orders?limit=50");
}

export async function getCustomers() {
  return apiFetch<ListResponse<Record<string, unknown>>>("/v1/customers?limit=50");
}

export async function getConversations() {
  return apiFetch<ListResponse<Record<string, unknown>>>("/v1/conversations?limit=50");
}
