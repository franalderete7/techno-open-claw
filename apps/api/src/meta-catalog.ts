import { config } from "./config.js";
import { query } from "./db.js";

type JsonRecord = Record<string, unknown>;

type StoreMeta = {
  storeName: string;
  storefrontUrl: string;
  usedFallbackUrl: boolean;
};

type CatalogProductRow = {
  id: number;
  sku: string;
  slug: string;
  brand: string;
  model: string;
  title: string;
  description: string | null;
  category: string | null;
  condition: string;
  price_amount: string | number | null;
  promo_price_ars: string | number | null;
  currency_code: string;
  image_url: string | null;
  color: string | null;
  active: boolean;
  updated_at: string;
  in_stock: boolean;
  stock_units_total: number;
  stock_units_available: number;
  margin_pct: string | number | null;
  cuotas_qty: number | null;
};

export type MetaCatalogIssue = {
  severity: "error" | "warning";
  code: string;
  sku: string | null;
  message: string;
};

export type MetaCatalogExcludedItem = {
  sku: string;
  reasons: string[];
};

export type MetaCatalogFeedItem = {
  id: string;
  title: string;
  description: string;
  availability: string;
  condition: string;
  price: string;
  sale_price: string | null;
  link: string;
  image_link: string;
  brand: string;
  product_type: string;
  color: string | null;
  custom_label_0: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  custom_label_4: string | null;
};

export type MetaCatalogSnapshot = {
  generated_at: string;
  configured: {
    catalog_id: boolean;
    pixel_id: boolean;
    access_token: boolean;
    feed_token: boolean;
    public_api_base_url: boolean;
    suggested_feed_url: string | null;
    missing_required: string[];
    missing_recommended: string[];
  };
  store: {
    name: string;
    storefront_url: string;
    used_fallback_url: boolean;
  };
  counts: {
    source_products: number;
    eligible_items: number;
    excluded_items: number;
    issues: number;
  };
  issues: MetaCatalogIssue[];
  excluded: MetaCatalogExcludedItem[];
  items: MetaCatalogFeedItem[];
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function toText(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    return url.toString();
  } catch {
    return null;
  }
}

function isPublicHttpsUrl(value: string | null | undefined) {
  const normalized = normalizeUrl(value);
  if (!normalized) return false;
  return normalized.startsWith("https://");
}

function slugifyLabel(value: string | null | undefined) {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/[_\s]+/g, "_")
      .replace(/-+/g, "_")
      .replace(/^_+|_+$/g, "") || null
  );
}

function sanitizeFeedField(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\t/g, " ")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function formatMetaPrice(amount: number, currencyCode: string) {
  const compact = amount.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${compact} ${currencyCode.trim().toUpperCase()}`;
}

function buildStorefrontProductPath(sku: string) {
  const normalizedSku = sku.trim().toLowerCase();
  return normalizedSku.startsWith("iphone-")
    ? `/iphone/${encodeURIComponent(normalizedSku)}`
    : `/${encodeURIComponent(normalizedSku)}`;
}

function buildStorefrontProductUrl(storefrontUrl: string, sku: string) {
  return `${storefrontUrl.replace(/\/$/, "")}${buildStorefrontProductPath(sku)}`;
}

function normalizeCondition(value: string) {
  const normalized = value.trim().toLowerCase();

  switch (normalized) {
    case "new":
      return "new";
    case "refurbished":
      return "refurbished";
    case "like_new":
      return "used_like_new";
    case "used":
      return "used";
    default:
      return "new";
  }
}

function deriveAvailability(row: Pick<CatalogProductRow, "in_stock" | "stock_units_available">) {
  return row.in_stock || row.stock_units_available > 0 ? "in stock" : "out of stock";
}

function deriveProductType(row: Pick<CatalogProductRow, "brand" | "category">) {
  const brand = row.brand.trim();
  const category = row.category?.trim();

  if (category) {
    return category;
  }

  return `Electronics > Smartphones > ${brand}`;
}

function derivePriceFields(row: Pick<CatalogProductRow, "price_amount" | "promo_price_ars" | "currency_code">) {
  const basePrice = toNumber(row.price_amount);
  const promoPrice = toNumber(row.promo_price_ars);
  const currencyCode = row.currency_code.trim().toUpperCase() || "ARS";

  if (basePrice != null && promoPrice != null && promoPrice > 0 && promoPrice < basePrice) {
    return {
      price: formatMetaPrice(basePrice, currencyCode),
      salePrice: formatMetaPrice(promoPrice, currencyCode),
      effectiveAmount: promoPrice,
    };
  }

  const finalAmount = promoPrice != null && promoPrice > 0 ? promoPrice : basePrice;

  return {
    price: finalAmount != null ? formatMetaPrice(finalAmount, currencyCode) : null,
    salePrice: null,
    effectiveAmount: finalAmount,
  };
}

function deriveMarginBand(marginPct: string | number | null) {
  const margin = toNumber(marginPct);
  if (margin == null) return "margin_unknown";
  if (margin >= 25) return "margin_high";
  if (margin >= 12) return "margin_mid";
  return "margin_low";
}

function deriveStockBand(stockUnitsAvailable: number) {
  if (stockUnitsAvailable <= 0) return "stock_out";
  if (stockUnitsAvailable <= 2) return "stock_low";
  return "stock_healthy";
}

function deriveFinancingBand(cuotasQty: number | null) {
  return (cuotasQty ?? 0) > 0 ? "financing_yes" : "financing_no";
}

async function getStoreMeta(): Promise<StoreMeta> {
  const result = await query<{ value: unknown }>(
    "select value from public.settings where key = 'store' limit 1"
  );
  const value = result[0]?.value;
  const storeRoot = asRecord(value) ?? {};
  const storefrontUrl =
    toText(storeRoot.storefront_url) ||
    toText(storeRoot.store_website_url) ||
    "https://technostoresalta.com";
  const storeName = toText(storeRoot.name) || "TechnoStore Salta";

  return {
    storeName,
    storefrontUrl,
    usedFallbackUrl: !toText(storeRoot.storefront_url) && !toText(storeRoot.store_website_url),
  };
}

async function listCatalogProducts() {
  return query<CatalogProductRow>(
    `
      select
        p.id,
        p.sku,
        p.slug,
        p.brand,
        p.model,
        p.title,
        p.description,
        p.category,
        p.condition,
        p.price_amount,
        p.promo_price_ars,
        p.currency_code,
        p.image_url,
        p.color,
        p.active,
        p.updated_at,
        p.margin_pct,
        p.cuotas_qty,
        coalesce(bool_or(su.status = 'in_stock'), coalesce(p.in_stock, false)) as in_stock,
        coalesce(count(su.id), 0)::int as stock_units_total,
        coalesce(count(su.id) filter (where su.status = 'in_stock'), 0)::int as stock_units_available
      from public.products p
      left join public.stock_units su on su.product_id = p.id
      where p.active = true
      group by p.id
      order by p.updated_at desc, p.id desc
    `
  );
}

export function getMetaCatalogConfiguration() {
  const publicApiBaseUrl = config.PUBLIC_API_BASE_URL.trim().replace(/\/$/, "");
  const feedToken = config.META_CATALOG_FEED_TOKEN.trim();
  const suggestedFeedUrl =
    publicApiBaseUrl && feedToken ? `${publicApiBaseUrl}/v1/meta/catalog/feed.tsv?token=${encodeURIComponent(feedToken)}` : null;

  return {
    catalog_id: Boolean(config.META_CATALOG_ID.trim()),
    pixel_id: Boolean(config.META_PIXEL_ID.trim()),
    access_token: Boolean(config.META_ACCESS_TOKEN.trim()),
    feed_token: Boolean(feedToken),
    public_api_base_url: Boolean(publicApiBaseUrl),
    suggested_feed_url: suggestedFeedUrl,
    missing_required: [
      !config.META_CATALOG_ID.trim() ? "META_CATALOG_ID" : null,
      !config.META_PIXEL_ID.trim() ? "META_PIXEL_ID" : null,
      !feedToken ? "META_CATALOG_FEED_TOKEN" : null,
    ].filter((value): value is string => Boolean(value)),
    missing_recommended: [
      !publicApiBaseUrl ? "PUBLIC_API_BASE_URL" : null,
      !config.META_ACCESS_TOKEN.trim() ? "META_ACCESS_TOKEN" : null,
    ].filter((value): value is string => Boolean(value)),
  };
}

export function isValidMetaCatalogFeedToken(token: string | undefined) {
  const expected = config.META_CATALOG_FEED_TOKEN.trim();
  return Boolean(expected) && token?.trim() === expected;
}

export async function buildMetaCatalogSnapshot(): Promise<MetaCatalogSnapshot> {
  const [store, rows] = await Promise.all([getStoreMeta(), listCatalogProducts()]);
  const issues: MetaCatalogIssue[] = [];
  const excluded: MetaCatalogExcludedItem[] = [];
  const items: MetaCatalogFeedItem[] = [];

  if (store.usedFallbackUrl) {
    issues.push({
      severity: "warning",
      code: "storefront_url_fallback",
      sku: null,
      message: "Storefront URL is using the fallback value. Update the store setting if your public storefront domain changed.",
    });
  }

  if (!isPublicHttpsUrl(store.storefrontUrl)) {
    issues.push({
      severity: "error",
      code: "storefront_url_invalid",
      sku: null,
      message: "Storefront URL is missing or not a public HTTPS URL.",
    });
  }

  for (const row of rows) {
    const reasons: string[] = [];
    const imageUrl = normalizeUrl(row.image_url);
    const productUrl = isPublicHttpsUrl(store.storefrontUrl) ? buildStorefrontProductUrl(store.storefrontUrl, row.sku) : null;
    const priceFields = derivePriceFields(row);

    if (!row.sku.trim()) {
      reasons.push("missing_sku");
    }

    if (!row.title.trim()) {
      reasons.push("missing_title");
    }

    if (!priceFields.price) {
      reasons.push("missing_price");
    }

    if (!imageUrl) {
      reasons.push("missing_image");
    } else if (!isPublicHttpsUrl(imageUrl)) {
      reasons.push("invalid_image_url");
    }

    if (!productUrl) {
      reasons.push("missing_product_url");
    }

    if (reasons.length > 0) {
      excluded.push({
        sku: row.sku,
        reasons,
      });

      for (const reason of reasons) {
        issues.push({
          severity: "error",
          code: reason,
          sku: row.sku,
          message: `Product ${row.sku} cannot be exported because of ${reason}.`,
        });
      }

      continue;
    }

    items.push({
      id: row.sku.trim(),
      title: sanitizeFeedField(row.title),
      description: sanitizeFeedField(row.description || `${row.brand} ${row.model}`),
      availability: deriveAvailability(row),
      condition: normalizeCondition(row.condition),
      price: priceFields.price!,
      sale_price: priceFields.salePrice,
      link: productUrl!,
      image_link: imageUrl!,
      brand: sanitizeFeedField(row.brand),
      product_type: sanitizeFeedField(deriveProductType(row)),
      color: sanitizeFeedField(row.color),
      custom_label_0: slugifyLabel(row.brand),
      custom_label_1: deriveMarginBand(row.margin_pct),
      custom_label_2: deriveStockBand(row.stock_units_available),
      custom_label_3: normalizeCondition(row.condition),
      custom_label_4: deriveFinancingBand(row.cuotas_qty),
    });
  }

  return {
    generated_at: new Date().toISOString(),
    configured: getMetaCatalogConfiguration(),
    store: {
      name: store.storeName,
      storefront_url: store.storefrontUrl,
      used_fallback_url: store.usedFallbackUrl,
    },
    counts: {
      source_products: rows.length,
      eligible_items: items.length,
      excluded_items: excluded.length,
      issues: issues.length,
    },
    issues,
    excluded,
    items,
  };
}

export async function buildMetaCatalogFeedTsv() {
  const snapshot = await buildMetaCatalogSnapshot();
  const headers = [
    "id",
    "title",
    "description",
    "availability",
    "condition",
    "price",
    "sale price",
    "link",
    "image link",
    "brand",
    "product type",
    "color",
    "custom_label_0",
    "custom_label_1",
    "custom_label_2",
    "custom_label_3",
    "custom_label_4",
  ];

  const lines = [headers.join("\t")];

  for (const item of snapshot.items) {
    lines.push(
      [
        item.id,
        item.title,
        item.description,
        item.availability,
        item.condition,
        item.price,
        item.sale_price,
        item.link,
        item.image_link,
        item.brand,
        item.product_type,
        item.color,
        item.custom_label_0,
        item.custom_label_1,
        item.custom_label_2,
        item.custom_label_3,
        item.custom_label_4,
      ]
        .map((value) => sanitizeFeedField(value))
        .join("\t")
    );
  }

  return {
    snapshot,
    tsv: `${lines.join("\n")}\n`,
  };
}
