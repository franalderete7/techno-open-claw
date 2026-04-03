import type { ProductRecord, SettingRecord } from "./api";

export type StorefrontProduct = {
  id: number;
  sku: string;
  slug: string;
  brand: string;
  model: string;
  title: string;
  description: string | null;
  condition: string;
  public_price_ars: number | null;
  image_url: string | null;
  delivery_days: number | null | undefined;
  ram_gb: number | null;
  storage_gb: number | null;
  network: string | null;
  color: string | null;
  battery_health: number | null;
  in_stock: boolean;
};

export type StorefrontProfile = {
  name: string;
  tagline: string;
  whatsapp_number: string | null;
  whatsapp_url: string | null;
  storefront_url: string | null;
  address: string | null;
  hours: string | null;
  map_embed_url: string | null;
};

const DEFAULT_STORE_WHATSAPP = "543875319940";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toText(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function normalizePhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D+/g, "");
  return digits.length >= 8 ? digits : null;
}

function buildWhatsAppUrl(baseUrl: string | null, message: string) {
  if (!baseUrl) return null;
  return `${baseUrl}?text=${encodeURIComponent(message)}`;
}

function pickText(settingsMap: Map<string, unknown>, storeRoot: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const fromSetting = toText(settingsMap.get(key));
    if (fromSetting) return fromSetting;
    const fromStore = toText(storeRoot[key]);
    if (fromStore) return fromStore;
  }

  return null;
}

export function buildStorefrontProfile(settings: SettingRecord[]): StorefrontProfile {
  const settingsMap = new Map(settings.map((setting) => [setting.key, setting.value]));
  const storeRoot = asRecord(settings.find((setting) => setting.key === "store")?.value) ?? {};

  const name =
    pickText(settingsMap, storeRoot, "store_location_name", "name") ||
    pickText(settingsMap, storeRoot, "store_name") ||
    "TechnoStore Salta";
  const address = pickText(settingsMap, storeRoot, "store_address", "address");
  const hours = pickText(settingsMap, storeRoot, "store_hours", "hours");
  const storefrontUrl = pickText(settingsMap, storeRoot, "storefront_url", "store_website_url");
  const whatsappNumber =
    normalizePhone(
      pickText(
        settingsMap,
        storeRoot,
        "store_whatsapp",
        "store_whatsapp_phone",
        "store_whatsapp_number",
        "whatsapp",
        "whatsapp_phone",
        "whatsapp_number",
        "contact_whatsapp",
        "contact_phone",
        "store_contact_whatsapp",
        "store_contact_phone",
        "store_phone",
        "store_phone_number",
        "phone",
        "telefono",
        "telefono_whatsapp",
        "celular"
      )
    ) || DEFAULT_STORE_WHATSAPP;
  const mapEmbedUrl = address
    ? `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`
    : null;

  return {
    name,
    tagline: "Samsung, Xiaomi, Motorola y mas con precio final y atencion directa.",
    whatsapp_number: whatsappNumber,
    whatsapp_url: whatsappNumber ? `https://wa.me/${whatsappNumber}` : null,
    storefront_url: storefrontUrl || "https://technostoresalta.com",
    address,
    hours,
    map_embed_url: mapEmbedUrl,
  };
}

export function buildStorefrontProductPath(sku: string) {
  const normalizedSku = sku.trim().toLowerCase();
  return normalizedSku.startsWith("iphone-")
    ? `/iphone/${encodeURIComponent(normalizedSku)}`
    : `/${encodeURIComponent(normalizedSku)}`;
}

export function buildStorefrontProductUrl(storefrontUrl: string | null, sku: string) {
  const path = buildStorefrontProductPath(sku);
  if (!storefrontUrl) {
    return path;
  }

  return `${storefrontUrl.replace(/\/$/, "")}${path}`;
}

export function buildStorefrontConsultUrl(whatsappUrl: string | null, product: Pick<StorefrontProduct, "title">) {
  return buildWhatsAppUrl(whatsappUrl, `Hola! Quiero consultar por ${product.title}.`);
}

export function buildStorefrontPaymentFallbackUrl(whatsappUrl: string | null, product: Pick<StorefrontProduct, "title">) {
  return buildWhatsAppUrl(whatsappUrl, `Hola! Quiero pagarlo ahora por ${product.title}.`);
}

export function buildStorefrontProducts(items: ProductRecord[]): StorefrontProduct[] {
  return items
    .filter((item) => item.active)
    .map((item) => ({
      id: item.id,
      sku: item.sku,
      slug: item.slug,
      brand: item.brand,
      model: item.model,
      title: item.title,
      description: item.description,
      condition: item.condition,
      public_price_ars: item.promo_price_ars ?? item.price_amount,
      image_url: item.image_url,
      delivery_days: item.delivery_days,
      ram_gb: item.ram_gb,
      storage_gb: item.storage_gb,
      network: item.network,
      color: item.color,
      battery_health: item.battery_health,
      in_stock: item.in_stock,
    }));
}

/** Apple / iPhone lives on `/iphone` only; keep the main storefront grid to other brands. */
export function excludeAppleStorefrontProducts(products: StorefrontProduct[]): StorefrontProduct[] {
  return products.filter((product) => product.brand.trim().toLowerCase() !== "apple");
}
