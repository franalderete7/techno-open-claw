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
  bancarizada_total: number | null;
  bancarizada_cuota: number | null;
  bancarizada_interest: number | null;
  macro_total: number | null;
  macro_cuota: number | null;
  macro_interest: number | null;
  cuotas_qty: number | null;
};

export type StorefrontInstallmentOffer = {
  provider: "bancarizada" | "macro";
  installments: number;
  installmentAmount: number;
  totalAmount: number | null;
};

export type StorefrontBuyerIntent = {
  delivery_mode?: "shipping_national" | "pickup_salta" | null;
  availability_preference?: "stock_now" | "can_wait" | null;
  payment_preference?: "contado" | "bancarizada" | "macro" | null;
  customer_city?: string | null;
  customer_province?: string | null;
  contact_goal?: "buy_now" | "confirm_stock" | "advice" | null;
  source_placement?: string | null;
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

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asPositiveNumber(value: unknown) {
  const normalized = toFiniteNumber(value);
  if (normalized == null || normalized <= 0) {
    return null;
  }

  return normalized;
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

function buildBuyerIntentLines(intent?: StorefrontBuyerIntent | null) {
  if (!intent) return [] as string[];

  const lines: string[] = [];
  if (intent.delivery_mode === "shipping_national") {
    lines.push("Lo quiero con envío a todo el país.");
  } else if (intent.delivery_mode === "pickup_salta") {
    lines.push("Prefiero retiro en Salta.");
  }

  if (intent.availability_preference === "stock_now") {
    lines.push("Si lo tenés en stock para entrega rápida, mejor.");
  } else if (intent.availability_preference === "can_wait") {
    lines.push("Si hay que esperarlo unos días, puedo esperar.");
  }

  if (intent.payment_preference === "contado") {
    lines.push("Mi idea es cerrarlo de contado.");
  } else if (intent.payment_preference === "bancarizada") {
    lines.push("Quiero verlo con bancarizada.");
  } else if (intent.payment_preference === "macro") {
    lines.push("Quiero verlo con Macro.");
  }

  const location = [intent.customer_city, intent.customer_province].filter(Boolean).join(", ");
  if (location) {
    lines.push(`Estoy en ${location}.`);
  }

  if (intent.contact_goal === "confirm_stock") {
    lines.push("Quiero confirmar stock hoy.");
  } else if (intent.contact_goal === "buy_now") {
    lines.push("Estoy listo para avanzar hoy.");
  } else if (intent.contact_goal === "advice") {
    lines.push("Quiero que me recomienden la mejor opción.");
  }

  return lines;
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

export function buildStorefrontConsultUrl(
  whatsappUrl: string | null,
  product: Pick<StorefrontProduct, "title">,
  intent?: StorefrontBuyerIntent | null
) {
  const lines = [`Hola! Quiero consultar por ${product.title}.`, ...buildBuyerIntentLines(intent)];
  return buildWhatsAppUrl(whatsappUrl, lines.join(" "));
}

export function buildStorefrontPaymentFallbackUrl(
  whatsappUrl: string | null,
  product: Pick<StorefrontProduct, "title">,
  intent?: StorefrontBuyerIntent | null
) {
  const lines = [`Hola! Quiero pagarlo ahora por ${product.title}.`, ...buildBuyerIntentLines(intent)];
  return buildWhatsAppUrl(whatsappUrl, lines.join(" "));
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
      public_price_ars: toFiniteNumber(item.promo_price_ars) ?? toFiniteNumber(item.price_amount),
      image_url: item.image_url,
      delivery_days: toFiniteNumber(item.delivery_days),
      ram_gb: toFiniteNumber(item.ram_gb),
      storage_gb: toFiniteNumber(item.storage_gb),
      network: item.network,
      color: item.color,
      battery_health: toFiniteNumber(item.battery_health),
      in_stock: item.in_stock,
      bancarizada_total: toFiniteNumber(item.bancarizada_total),
      bancarizada_cuota: toFiniteNumber(item.bancarizada_cuota),
      bancarizada_interest: toFiniteNumber(item.bancarizada_interest),
      macro_total: toFiniteNumber(item.macro_total),
      macro_cuota: toFiniteNumber(item.macro_cuota),
      macro_interest: toFiniteNumber(item.macro_interest),
      cuotas_qty: toFiniteNumber(item.cuotas_qty),
    }));
}

export function buildStorefrontInstallmentOffer(
  product: Pick<
    StorefrontProduct,
    "cuotas_qty" | "bancarizada_cuota" | "bancarizada_total" | "macro_cuota" | "macro_total"
  >
): StorefrontInstallmentOffer | null {
  const installments = Math.round(asPositiveNumber(product.cuotas_qty) ?? 0);
  if (!Number.isFinite(installments) || installments < 2) {
    return null;
  }

  const offers: StorefrontInstallmentOffer[] = [];
  const bancarizadaCuota = asPositiveNumber(product.bancarizada_cuota);
  if (bancarizadaCuota != null) {
    offers.push({
      provider: "bancarizada",
      installments,
      installmentAmount: bancarizadaCuota,
      totalAmount: asPositiveNumber(product.bancarizada_total),
    });
  }

  const macroCuota = asPositiveNumber(product.macro_cuota);
  if (macroCuota != null) {
    offers.push({
      provider: "macro",
      installments,
      installmentAmount: macroCuota,
      totalAmount: asPositiveNumber(product.macro_total),
    });
  }

  if (offers.length === 0) {
    return null;
  }

  offers.sort((left, right) => left.installmentAmount - right.installmentAmount);
  return offers[0];
}

/** Apple / iPhone lives on `/iphone` only; keep the main storefront grid to other brands. */
export function excludeAppleStorefrontProducts(products: StorefrontProduct[]): StorefrontProduct[] {
  return products.filter((product) => product.brand.trim().toLowerCase() !== "apple");
}
