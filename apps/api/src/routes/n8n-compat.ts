import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import { pool, query } from "../db.js";
import {
  ensureStorefrontCheckoutHandoff,
  getDefaultCheckoutPaymentProvider,
  resolveStorefrontCheckoutHandoff,
} from "../storefront-checkouts.js";

type NotesState = {
  tags: string[];
  leadScore: number;
  lastIntent: string | null;
  funnelStage: string | null;
  interestedProduct: string | null;
  paymentMethodLast: string | null;
  brandsMentioned: string[];
  lastBotInteraction: string | null;
};

type ProductRow = {
  id: number;
  sku: string;
  slug: string;
  brand: string;
  category: string | null;
  model: string;
  title: string;
  description: string | null;
  condition: string;
  price_amount: string | number | null;
  price_usd: string | number | null;
  promo_price_ars: string | number | null;
  bancarizada_total: string | number | null;
  bancarizada_cuota: string | number | null;
  bancarizada_interest: string | number | null;
  macro_total: string | number | null;
  macro_cuota: string | number | null;
  macro_interest: string | number | null;
  cuotas_qty: number | null;
  usd_rate: string | number | null;
  currency_code: string;
  active: boolean;
  in_stock: boolean;
  delivery_type: string | null;
  delivery_days: number | null;
  image_url: string | null;
  color: string | null;
  ram_gb: number | null;
  storage_gb: number | null;
  network: string | null;
  battery_health: string | null;
  created_at: string;
  updated_at: string;
  in_stock_units: number;
  reserved_units: number;
  sold_units: number;
  total_units: number;
};

type CandidateProduct = {
  score: number;
  product_id: number;
  product_key: string;
  slug: string;
  model: string;
  product_name: string;
  description: string | null;
  product_url: string | null;
  brand_key: string;
  category: string | null;
  condition: string;
  storage_gb: number | null;
  ram_gb: number | null;
  color: string | null;
  in_stock: boolean;
  in_stock_units: number;
  delivery_type: string | null;
  delivery_days: number | null;
  network: string | null;
  battery_health: string | null;
  price_ars: number | null;
  promo_price_ars: number | null;
  price_usd: number | null;
  bancarizada_total: number | null;
  bancarizada_cuota: number | null;
  bancarizada_interest: number | null;
  macro_total: number | null;
  macro_cuota: number | null;
  macro_interest: number | null;
  cuotas_qty: number | null;
  usd_rate: number | null;
  currency_code: string | null;
  image_url: string | null;
};

type StaticUsedIphoneCatalogItem = {
  id: string;
  source_row: number;
  brand_key: string;
  model_name: string;
  family_number: number | null;
  tier_key: string | null;
  storage_gb: number | null;
  color: string | null;
  battery_health_pct: number | null;
  battery_note: string | null;
  condition: string;
  source_price_usd: number;
  sale_price_usd: number;
};

type StaticUsedIphoneCatalog = {
  catalog_type: string;
  currency: string;
  markup_pct: number;
  rounding: string;
  source: {
    kind: string;
    image_path?: string;
    captured_on?: string;
  };
  items: StaticUsedIphoneCatalogItem[];
};

type UsedIphoneCandidate = StaticUsedIphoneCatalogItem & {
  score: number;
};

type MessageProductSignals = {
  normalizedMessage: string;
  brandKeys: string[];
  tierKey: string | null;
  familyNumber: number | null;
  storageValue: number | null;
  modelVariantToken: string | null;
  hasSpecificIntent: boolean;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const usedIphoneCatalogPaths = [
  resolve(moduleDir, "../../data/used-iphone-catalog.json"),
  resolve(process.cwd(), "data/used-iphone-catalog.json"),
  resolve(process.cwd(), "../../data/used-iphone-catalog.json"),
];

function asNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadStaticUsedIphoneCatalog(): StaticUsedIphoneCatalog {
  try {
    const catalogPath = usedIphoneCatalogPaths.find((path) => existsSync(path));
    if (!catalogPath) {
      throw new Error("used iphone catalog not found");
    }

    const raw = JSON.parse(readFileSync(catalogPath, "utf8")) as Partial<StaticUsedIphoneCatalog>;
    const items = Array.isArray(raw.items)
      ? raw.items
          .map((entry) => {
            const item = entry as Partial<StaticUsedIphoneCatalogItem>;
            const id = String(item.id ?? "").trim();
            const modelName = String(item.model_name ?? "").trim();
            if (!id || !modelName) {
              return null;
            }

            return {
              id,
              source_row: Number(item.source_row ?? 0) || 0,
              brand_key: String(item.brand_key ?? "apple").trim() || "apple",
              model_name: modelName,
              family_number: asNullableNumber(item.family_number),
              tier_key: item.tier_key == null ? null : String(item.tier_key).trim() || null,
              storage_gb: asNullableNumber(item.storage_gb),
              color: item.color == null ? null : String(item.color).trim() || null,
              battery_health_pct: asNullableNumber(item.battery_health_pct),
              battery_note: item.battery_note == null ? null : String(item.battery_note).trim() || null,
              condition: String(item.condition ?? "used").trim() || "used",
              source_price_usd: Number(item.source_price_usd ?? 0) || 0,
              sale_price_usd: Number(item.sale_price_usd ?? 0) || 0,
            } satisfies StaticUsedIphoneCatalogItem;
          })
          .filter((item): item is StaticUsedIphoneCatalogItem => item !== null)
      : [];

    return {
      catalog_type: String(raw.catalog_type ?? "static_used_iphone_list"),
      currency: String(raw.currency ?? "USD"),
      markup_pct: Number(raw.markup_pct ?? 0) || 0,
      rounding: String(raw.rounding ?? "ceil_to_whole_usd"),
      source:
        raw.source && typeof raw.source === "object"
          ? {
              kind: String((raw.source as Record<string, unknown>).kind ?? "unknown"),
              image_path:
                (raw.source as Record<string, unknown>).image_path == null
                  ? undefined
                  : String((raw.source as Record<string, unknown>).image_path),
              captured_on:
                (raw.source as Record<string, unknown>).captured_on == null
                  ? undefined
                  : String((raw.source as Record<string, unknown>).captured_on),
            }
          : { kind: "unknown" },
      items,
    };
  } catch {
    return {
      catalog_type: "static_used_iphone_list",
      currency: "USD",
      markup_pct: 0,
      rounding: "ceil_to_whole_usd",
      source: { kind: "unavailable" },
      items: [],
    };
  }
}

const staticUsedIphoneCatalog = loadStaticUsedIphoneCatalog();

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBrandKey(value: string) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function normalizeCatalogBrandKey(value: string) {
  const normalized = normalizeBrandKey(value);
  if (["xiaomi", "redmi", "poco"].includes(normalized)) {
    return "xiaomi_family";
  }
  return normalized;
}

const BRAND_SIGNAL_RULES: Array<{ key: string; pattern: RegExp }> = [
  { key: "apple", pattern: /(?:^|\s)(?:iphone|apple|ipad|macbook)(?=\s|\d|$)/i },
  { key: "samsung", pattern: /(?:^|\s)(?:samsung|samsumg|samgung|sansung|galaxy)(?=\s|\d|$)/i },
  { key: "motorola", pattern: /(?:^|\s)(?:motorola|moto)(?=\s|\d|$)/i },
  { key: "xiaomi_family", pattern: /(?:^|\s)(?:xiaomi|xaomi|xiami|xioami|redmi|redmy|rexmi|redim|remdi|poco)(?=\s|\d|$)/i },
  { key: "google", pattern: /(?:^|\s)(?:google|pixel)(?=\s|\d|$)/i },
  { key: "jbl", pattern: /(?:^|\s)(?:jbl)(?=\s|\d|$)/i },
];

function hostFromUrl(value: string | null | undefined) {
  try {
    return value ? new URL(value).host || null : null;
  } catch {
    return null;
  }
}

function buildProductUrl(storeWebsiteUrl: string | null | undefined, productKey: string) {
  const sku = productKey.trim().toLowerCase();
  if (!sku) {
    return null;
  }

  const path = sku.startsWith("iphone-") ? `/iphone/${encodeURIComponent(sku)}` : `/${encodeURIComponent(sku)}`;

  if (!storeWebsiteUrl) {
    return path;
  }

  return `${storeWebsiteUrl.replace(/\/$/, "")}${path}`;
}

function extractCatalogFamilyNumberFromText(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const familyMatch = normalized.match(
    /(?:iphone|galaxy|redmi|note|poco|moto|motorola|pixel|xiaomi)\s*([0-9]{1,3})/i
  );
  if (familyMatch) {
    return Number(familyMatch[1]);
  }

  const standaloneAppleMatch = normalized.match(/\b(13|15|16|17)\b/);
  return standaloneAppleMatch ? Number(standaloneAppleMatch[1]) : null;
}

function inferCandidateFamilyNumber(candidate: {
  brand_key: string;
  product_name: string;
  product_key: string;
  category: string | null;
}) {
  const composite = [candidate.brand_key, candidate.category ?? "", candidate.product_name, candidate.product_key].join(" ");
  const familyNumber = extractCatalogFamilyNumberFromText(composite);
  return Number.isFinite(familyNumber) ? familyNumber : null;
}

function candidatePublicPrice(candidate: { promo_price_ars: number | null; price_ars: number | null }) {
  const promoPrice = Number(candidate.promo_price_ars);
  if (Number.isFinite(promoPrice) && promoPrice > 0) {
    return promoPrice;
  }

  const price = Number(candidate.price_ars);
  if (Number.isFinite(price) && price > 0) {
    return price;
  }

  return Number.POSITIVE_INFINITY;
}

function compareCatalogBrowseCandidates<
  T extends {
    in_stock: boolean;
    promo_price_ars: number | null;
    price_ars: number | null;
    score: number;
    product_name: string;
  },
>(left: T, right: T) {
  if (Number(right.in_stock) !== Number(left.in_stock)) {
    return Number(right.in_stock) - Number(left.in_stock);
  }

  const leftPrice = candidatePublicPrice(left);
  const rightPrice = candidatePublicPrice(right);
  if (leftPrice !== rightPrice) {
    return leftPrice - rightPrice;
  }

  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return left.product_name.localeCompare(right.product_name, "es");
}

function prioritizeBrandBrowseCandidates<
  T extends {
    brand_key: string;
    product_name: string;
    product_key: string;
    category: string | null;
    in_stock: boolean;
    promo_price_ars: number | null;
    price_ars: number | null;
    score: number;
  },
>(products: T[], brandKey: string, limit: number) {
  const matchingProducts = products.filter((product) => normalizeCatalogBrandKey(product.brand_key) === brandKey);
  if (matchingProducts.length === 0) {
    return products.slice(0, limit);
  }

  const sortedMatchingProducts = [...matchingProducts].sort(compareCatalogBrowseCandidates);
  if (brandKey !== "apple") {
    return sortedMatchingProducts.slice(0, limit);
  }

  const preferredFamilies = [13, 15, 16, 17];
  const prioritizedProducts: T[] = [];
  const selectedKeys = new Set<string>();

  for (const family of preferredFamilies) {
    const familyCandidate = sortedMatchingProducts.find(
      (product) => !selectedKeys.has(product.product_key) && inferCandidateFamilyNumber(product) === family
    );
    if (!familyCandidate) {
      continue;
    }

    prioritizedProducts.push(familyCandidate);
    selectedKeys.add(familyCandidate.product_key);
  }

  const remainder = sortedMatchingProducts.filter((product) => !selectedKeys.has(product.product_key));
  return [...prioritizedProducts, ...remainder].slice(0, limit);
}

function messageRequestsPaymentLink(userMessage: string) {
  const normalized = normalizeText(userMessage);

  if (!normalized) {
    return false;
  }

  return /(link de pago|pasame el link|pasame link|mandame el link|manda el link|quiero pagar|quiero pagarlo|lo quiero pagar|pagarlo ahora|avanzar con el pago|quiero el link)/.test(
    normalized
  );
}

function pickDirectPaymentProduct(params: {
  userMessage: string;
  interestedProductKey: string | null;
  candidateProducts: CandidateProduct[];
}) {
  if (!messageRequestsPaymentLink(params.userMessage)) {
    return null;
  }

  const [topCandidate, secondCandidate] = params.candidateProducts;
  if (!topCandidate) {
    return null;
  }

  const interestedProductKey = params.interestedProductKey?.trim().toLowerCase() || null;
  if (interestedProductKey && topCandidate.product_key.trim().toLowerCase() === interestedProductKey) {
    return topCandidate;
  }

  const secondScore = secondCandidate?.score ?? 0;
  const hasStrongScore = topCandidate.score >= 14;
  const hasClearMargin = !secondCandidate || topCandidate.score - secondScore >= 8 || secondScore < 8;

  return hasStrongScore && hasClearMargin ? topCandidate : null;
}

function parseNotesState(notes: string | null): NotesState {
  const state: NotesState = {
    tags: [],
    leadScore: 0,
    lastIntent: null,
    funnelStage: null,
    interestedProduct: null,
    paymentMethodLast: null,
    brandsMentioned: [],
    lastBotInteraction: null,
  };

  if (!notes) {
    return state;
  }

  const lines = notes
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("tag:")) {
      state.tags.push(line.slice("tag:".length).trim());
      continue;
    }

    if (line.startsWith("lead_score:")) {
      const value = Number.parseInt(line.slice("lead_score:".length).trim(), 10);
      if (Number.isFinite(value)) {
        state.leadScore = value;
      }
      continue;
    }

    if (line.startsWith("last_intent:")) {
      state.lastIntent = line.slice("last_intent:".length).trim() || null;
      continue;
    }

    if (line.startsWith("funnel_stage:")) {
      state.funnelStage = line.slice("funnel_stage:".length).trim() || null;
      continue;
    }

    if (line.startsWith("interested_product:")) {
      state.interestedProduct = line.slice("interested_product:".length).trim() || null;
      continue;
    }

    if (line.startsWith("payment_method_last:")) {
      state.paymentMethodLast = line.slice("payment_method_last:".length).trim() || null;
      continue;
    }

    if (line.startsWith("brands_mentioned:")) {
      state.brandsMentioned = line
        .slice("brands_mentioned:".length)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      continue;
    }

    if (line.startsWith("last_bot_interaction:")) {
      state.lastBotInteraction = line.slice("last_bot_interaction:".length).trim() || null;
    }
  }

  state.tags = [...new Set(state.tags)];
  state.brandsMentioned = [...new Set(state.brandsMentioned)];

  return state;
}

function buildNotesState(params: {
  currentNotes: string | null;
  updates: Record<string, unknown>;
}) {
  const current = parseNotesState(params.currentNotes);

  if (Array.isArray(params.updates.tags)) {
    current.tags = params.updates.tags.map(String).filter(Boolean);
  }

  if (Number.isFinite(Number(params.updates.lead_score))) {
    current.leadScore = Math.max(0, Math.min(100, Number(params.updates.lead_score)));
  }

  if (params.updates.last_intent !== undefined) {
    current.lastIntent = params.updates.last_intent ? String(params.updates.last_intent) : null;
  }

  if (params.updates.funnel_stage !== undefined) {
    current.funnelStage = params.updates.funnel_stage ? String(params.updates.funnel_stage) : null;
  }

  if (params.updates.interested_product !== undefined) {
    current.interestedProduct = params.updates.interested_product ? String(params.updates.interested_product) : null;
  }

  if (params.updates.payment_method_last !== undefined) {
    current.paymentMethodLast = params.updates.payment_method_last ? String(params.updates.payment_method_last) : null;
  }

  if (Array.isArray(params.updates.brands_mentioned)) {
    current.brandsMentioned = params.updates.brands_mentioned.map(String).filter(Boolean);
  }

  if (params.updates.last_bot_interaction !== undefined) {
    current.lastBotInteraction = params.updates.last_bot_interaction ? String(params.updates.last_bot_interaction) : null;
  }

  const lines = [
    ...[...new Set(current.tags)].map((tag) => `tag:${tag}`),
    `lead_score:${current.leadScore}`,
  ];

  if (current.lastIntent) {
    lines.push(`last_intent:${current.lastIntent}`);
  }

  if (current.funnelStage) {
    lines.push(`funnel_stage:${current.funnelStage}`);
  }

  if (current.interestedProduct) {
    lines.push(`interested_product:${current.interestedProduct}`);
  }

  if (current.paymentMethodLast) {
    lines.push(`payment_method_last:${current.paymentMethodLast}`);
  }

  if (current.brandsMentioned.length > 0) {
    lines.push(`brands_mentioned:${[...new Set(current.brandsMentioned)].join(",")}`);
  }

  if (current.lastBotInteraction) {
    lines.push(`last_bot_interaction:${current.lastBotInteraction}`);
  }

  lines.push(`updated_at:${new Date().toISOString()}`);

  return lines.join("\n");
}

function inferStorageGb(product: Pick<ProductRow, "model" | "title" | "description">) {
  const source = `${product.model} ${product.title} ${product.description ?? ""}`;
  const match = source.match(/\b(64|128|256|512|1024)\s*gb\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function inferColor(product: Pick<ProductRow, "title" | "description">) {
  const source = `${product.title} ${product.description ?? ""}`;
  const match = source.match(
    /\b(black|white|blue|red|green|pink|purple|gold|silver|gray|grey|naranja|negro|blanco|azul|rojo|verde|rosa|violeta|dorado|gris)\b/i
  );

  return match ? match[1] : null;
}

function normalizeStorageValue(rawValue: number | null) {
  if (!Number.isFinite(rawValue)) {
    return null;
  }

  const value = Number(rawValue);
  if (value >= 60 && value <= 70) return 64;
  if (value >= 118 && value <= 138) return 128;
  if (value >= 240 && value <= 270) return 256;
  if (value >= 480 && value <= 540) return 512;
  if (value >= 950 && value <= 1100) return 1024;
  return null;
}

function extractStorageValueFromMessage(normalizedMessage: string) {
  const exactMatch = normalizedMessage.match(/\b(64|128|256|512|1024)\b(?:\s*gb)?\b/);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  const approximateMatch =
    normalizedMessage.match(/\b(\d{2,4})\b(?=(?:\s*gb)?\s*(?:de\s+)?(?:memo\w*|almacen\w*|giga\w*|gb)\b)/i) ||
    normalizedMessage.match(/(?:memo\w*|almacen\w*|giga\w*|gb)\s*(?:de\s*)?\b(\d{2,4})\b/i);

  if (!approximateMatch) {
    return null;
  }

  return normalizeStorageValue(Number(approximateMatch[1]));
}

function extractMessageBrandKeys(message: string) {
  const normalizedMessage = normalizeText(message);
  const brandKeys = new Set<string>();

  for (const rule of BRAND_SIGNAL_RULES) {
    if (rule.pattern.test(normalizedMessage)) {
      brandKeys.add(rule.key);
    }
  }

  return [...brandKeys];
}

function extractMessageTierKey(message: string) {
  if (/(^| )(pro max|promax)( |$)/.test(message)) return "pro_max";
  if (/(^| )(ultra)( |$)/.test(message)) return "ultra";
  if (/(^| )(pro)( |$)/.test(message)) return "pro";
  if (/(^| )(plus)( |$)/.test(message)) return "plus";
  return null;
}

function extractSamsungSNumberFromMessage(normalizedMessage: string): number | null {
  if (!/(samsung|galaxy)/.test(normalizedMessage)) {
    return null;
  }

  const direct = normalizedMessage.match(/\bsamsung(?:\s+galaxy)?\s+s\s*(\d{1,2})\b/i);
  if (direct) {
    const n = Number(direct[1]);
    return Number.isFinite(n) ? n : null;
  }

  const galaxyS = normalizedMessage.match(/\bgalaxy\s+s\s*(\d{1,2})\b/i);
  if (galaxyS) {
    const n = Number(galaxyS[1]);
    return Number.isFinite(n) ? n : null;
  }

  const sLine = normalizedMessage.match(/\bs\s*(\d{1,2})\s*(?:ultra|plus|fe|edge|pro(?:\s+max)?)\b/i);
  if (sLine) {
    const n = Number(sLine[1]);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function extractSamsungSNumberFromHaystack(haystack: string): number | null {
  const m = haystack.match(/\bs\s*(\d{1,2})\b/);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function getMessageProductSignals(userMessage: string): MessageProductSignals {
  const normalizedMessage = normalizeText(userMessage);
  const brandKeys = extractMessageBrandKeys(normalizedMessage);
  const tierKey = extractMessageTierKey(normalizedMessage);
  const familyMatch = normalizedMessage.match(
    /(?:iphone|galaxy|redmi|rexmi|redmy|redim|remdi|note|poco|moto|motorola|pixel|xiaomi|xaomi|xiami|xioami)\s*([0-9]{1,3})/i
  );
  const samsungSNumber = extractSamsungSNumberFromMessage(normalizedMessage);
  const storageValue = extractStorageValueFromMessage(normalizedMessage);
  const modelVariantMatch = normalizedMessage.match(
    /\b(?:a\d{1,3}|s\d{1,3}|g\d{1,3}|x\d{1,3}|z\s?flip\s?\d|z\s?fold\s?\d|edge\s?\d{1,3}|note\s?\d{1,3}|reno\s?\d{1,3}|find\s?x\d{1,2})\b/i
  );

  const familyNumber =
    familyMatch != null
      ? Number(familyMatch[1])
      : brandKeys.includes("samsung") && samsungSNumber != null
        ? samsungSNumber
        : null;

  return {
    normalizedMessage,
    brandKeys,
    tierKey,
    familyNumber: Number.isFinite(familyNumber) ? familyNumber : null,
    storageValue,
    modelVariantToken: modelVariantMatch ? normalizeText(modelVariantMatch[0]) : null,
    hasSpecificIntent:
      brandKeys.length > 0 &&
      (familyMatch != null ||
        samsungSNumber != null ||
        storageValue != null ||
        tierKey != null ||
        modelVariantMatch != null),
  };
}

function brandKeyMatchesText(brandKey: string, text: string) {
  const tokensByBrand: Record<string, string[]> = {
    apple: ["apple", "iphone", "ipad", "macbook"],
    samsung: ["samsung", "samsumg", "samgung", "sansung", "galaxy"],
    motorola: ["motorola", "moto"],
    xiaomi_family: ["xiaomi", "xaomi", "xiami", "xioami", "redmi", "redmy", "rexmi", "redim", "remdi", "poco"],
    google: ["google", "pixel"],
    jbl: ["jbl", "parlante", "parlantes", "speaker", "speakers"],
  };

  return (tokensByBrand[brandKey] ?? [brandKey]).some((token) => text.includes(token));
}

function productMatchesRequestedBrands(
  product: Pick<ProductRow, "brand" | "category" | "model" | "title" | "description">,
  brandKeys: string[]
) {
  if (brandKeys.length === 0) {
    return true;
  }

  const haystack = normalizeText(
    `${product.brand} ${product.category ?? ""} ${product.model} ${product.title} ${product.description ?? ""}`
  );
  return brandKeys.some((brandKey) => brandKeyMatchesText(brandKey, haystack));
}

function computeCurrentIntentAdjustment(product: ProductRow, signals: MessageProductSignals) {
  if (!signals.hasSpecificIntent) {
    return 0;
  }

  const haystack = normalizeText(
    `${product.brand} ${product.category ?? ""} ${product.model} ${product.title} ${product.description ?? ""}`
  );
  let adjustment = 0;

  if (signals.brandKeys.length > 0) {
    const brandMatches = signals.brandKeys.some((brandKey) => brandKeyMatchesText(brandKey, haystack));
    adjustment += brandMatches ? 14 : -30;
  }

  if (signals.familyNumber != null) {
    const productSamsungS = extractSamsungSNumberFromHaystack(haystack);
    if (signals.brandKeys.includes("samsung") && productSamsungS != null) {
      const tierPatterns: Record<string, RegExp> = {
        pro_max: /\bpro max\b|\bpromax\b/,
        ultra: /\bultra\b/,
        pro: /\bpro\b/,
        plus: /\bplus\b/,
      };
      const tierMatches =
        signals.tierKey == null ? true : (tierPatterns[signals.tierKey]?.test(haystack) ?? false);
      if (productSamsungS === signals.familyNumber && tierMatches) {
        adjustment += 10;
      } else if (
        Math.abs(productSamsungS - signals.familyNumber) === 1 &&
        signals.tierKey != null &&
        tierMatches &&
        (tierPatterns[signals.tierKey]?.test(signals.normalizedMessage) ?? false)
      ) {
        adjustment += 8;
      } else {
        adjustment += -12;
      }
    } else {
      adjustment += new RegExp(`(?:^|\\s)${signals.familyNumber}(?:\\s|$)`).test(haystack) ? 10 : -12;
    }
  }

  if (signals.modelVariantToken) {
    if (haystack.includes(signals.modelVariantToken)) {
      adjustment += 12;
    } else {
      const m = signals.modelVariantToken.match(/^s(\d{1,2})$/i);
      const productS = extractSamsungSNumberFromHaystack(haystack);
      const tierPatterns: Record<string, RegExp> = {
        pro_max: /\bpro max\b|\bpromax\b/,
        ultra: /\bultra\b/,
        pro: /\bpro\b/,
        plus: /\bplus\b/,
      };
      const samsungGenerationalSubstitute =
        signals.brandKeys.includes("samsung") &&
        m &&
        productS != null &&
        Math.abs(Number(m[1]) - productS) === 1 &&
        signals.tierKey != null &&
        (tierPatterns[signals.tierKey]?.test(haystack) ?? false) &&
        (tierPatterns[signals.tierKey]?.test(signals.normalizedMessage) ?? false);

      adjustment += samsungGenerationalSubstitute ? 0 : -14;
    }
  }

  if (signals.tierKey) {
    const tierPatterns: Record<string, RegExp> = {
      pro_max: /\bpro max\b|\bpromax\b/,
      ultra: /\bultra\b/,
      pro: /\bpro\b/,
      plus: /\bplus\b/,
    };

    adjustment += (tierPatterns[signals.tierKey]?.test(haystack) ?? false) ? 7 : -8;
  }

  if (signals.storageValue != null) {
    adjustment += new RegExp(`\\b${signals.storageValue}\\s*gb\\b`, "i").test(
      `${product.category ?? ""} ${product.model} ${product.title} ${product.description ?? ""}`
    )
      ? 5
      : -6;
  }

  return adjustment;
}

function buildRetrievalScoringText(
  userMessage: string,
  recentMessages: Array<{ direction: string; text_body: string | null; transcript: string | null }>
) {
  const chronological = [...recentMessages].reverse();
  const inboundTexts = chronological
    .filter((m) => m.direction === "inbound")
    .map((m) => String(m.text_body ?? m.transcript ?? "").trim())
    .filter(Boolean);

  const um = userMessage.trim();
  if (um && inboundTexts[inboundTexts.length - 1] !== um) {
    inboundTexts.push(um);
  }

  let combined = inboundTexts.join(" ");
  if (!combined) {
    combined = um;
  }

  const MAX = 6000;
  return combined.length > MAX ? combined.slice(0, MAX) : combined;
}

function candidateMatchesRetrievalBrandKeys(
  candidate: { brand_key: string; category: string | null; product_name: string; product_key: string },
  brandKeys: string[]
) {
  if (brandKeys.length === 0) {
    return true;
  }

  const haystack = normalizeText(`${candidate.brand_key} ${candidate.category ?? ""} ${candidate.product_name} ${candidate.product_key}`);
  return brandKeys.some((brandKey) => brandKeyMatchesText(brandKey, haystack));
}

/** Postgres ~* patterns: match brand/category/model/title haystack for catalog filtering */
const BRAND_ROW_REGEX: Record<string, string> = {
  apple: "apple|iphone|ipad|macbook",
  samsung: "samsung|galaxy",
  motorola: "motorola|\\bmoto\\b",
  xiaomi_family: "xiaomi|redmi|poco",
  google: "google|pixel",
  jbl: "jbl",
};

function buildBrandFilterSql(brandKeys: string[]): { fragment: string; params: string[] } | null {
  const uniq = [...new Set(brandKeys.map((k) => String(k).trim().toLowerCase()).filter(Boolean))];
  if (uniq.length === 0) {
    return null;
  }

  const parts: string[] = [];
  const params: string[] = [];

  for (const bk of uniq) {
    const pattern = BRAND_ROW_REGEX[bk];
    const hay =
      "(coalesce(p.brand,'') || ' ' || coalesce(p.category,'') || ' ' || coalesce(p.model,'') || ' ' || coalesce(p.title,''))";
    if (pattern) {
      params.push(pattern);
      parts.push(`${hay} ~* $${params.length}`);
    } else {
      params.push(`%${bk}%`);
      parts.push(`${hay} ilike $${params.length}`);
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return { fragment: ` AND (${parts.join(" OR ")})`, params };
}

function scoreCandidate(product: ProductRow, userMessage: string) {
  const message = normalizeText(userMessage);
  if (!message) {
    return product.in_stock_units > 0 ? 5 : 0;
  }

  const haystack = normalizeText(
    `${product.brand} ${product.category ?? ""} ${product.model} ${product.title} ${product.description ?? ""}`
  );
  const messageTokens = message.split(" ").filter((token) => token.length > 1);
  let score = 0;

  for (const token of messageTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 4 ? 6 : 2;
    }
  }

  if (message.includes(normalizeText(product.brand))) {
    score += 10;
  }

  if (message.includes(normalizeText(product.model))) {
    score += 12;
  }

  if (product.in_stock_units > 0) {
    score += 4;
  }

  return score;
}

function messageAsksForBudgetOrUsed(normalizedMessage: string) {
  if (!normalizedMessage) {
    return false;
  }

  return /(barato|barata|economico|economica|presupuesto|hasta|accesible|mas barato|algo mas barato|usado|usados|segunda mano|seminuevo|semi nuevo)/.test(
    normalizedMessage
  );
}

function looksLikeAppleReference(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "");
  return /(iphone|apple|ipad|macbook)/.test(normalized);
}

function scoreUsedIphoneCandidate(item: StaticUsedIphoneCatalogItem, signals: MessageProductSignals) {
  const haystack = normalizeText(
    [
      item.model_name,
      item.family_number != null ? String(item.family_number) : "",
      item.storage_gb != null ? `${item.storage_gb} gb` : "",
      item.color ?? "",
      item.battery_note ?? "",
      item.condition,
    ].join(" ")
  );

  let score = 0;
  const messageTokens = signals.normalizedMessage.split(" ").filter((token) => token.length > 1);

  for (const token of messageTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 4 ? 6 : 2;
    }
  }

  if (signals.brandKeys.includes("apple")) {
    score += 10;
  }

  if (signals.familyNumber != null) {
    score += item.family_number === signals.familyNumber ? 18 : -10;
  }

  if (signals.tierKey) {
    score += item.tier_key === signals.tierKey ? 8 : -6;
  }

  if (signals.storageValue != null) {
    score += item.storage_gb === signals.storageValue ? 6 : -4;
  }

  if (signals.modelVariantToken) {
    score += haystack.includes(signals.modelVariantToken) ? 8 : -4;
  }

  if (item.condition === "sealed") {
    score += /\bsellado\b|\bsealed\b/.test(signals.normalizedMessage) ? 8 : 2;
  }

  if (messageAsksForBudgetOrUsed(signals.normalizedMessage)) {
    score += 6;
  }

  return score;
}

function selectUsedIphoneCandidates(params: {
  userMessage: string;
  customerState: NotesState;
  limit: number;
}) {
  return [];
}

function isDisallowedWorkflowProduct(
  product: Pick<ProductRow, "brand" | "condition" | "sku" | "slug" | "model" | "title" | "description">
) {
  const searchableText = normalizeText(
    [
      product.brand,
      product.condition,
      product.sku,
      product.slug,
      product.model,
      product.title,
      product.description ?? "",
    ].join(" ")
  );

  if (normalizeText(product.brand) === "apple" && normalizeText(product.condition) !== "new") {
    return true;
  }

  return /\b(test|random|placeholder|dummy|demo|sample)\b/.test(searchableText);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function settingValueToText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  const record = asRecord(value);
  if (record) {
    if (typeof record.value === "string") return record.value.trim();
    if (typeof record.text === "string") return record.text.trim();
    if (typeof record.content === "string") return record.content.trim();
  }

  return "";
}

function parsePositiveId(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const n8nCompatRoutes: FastifyPluginAsync = async (app) => {
  app.post("/rpc/upsert_customer", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? body.subscriber_id ?? body.id ?? "").trim();

    if (!manychatId) {
      return reply.code(400).send({ error: "Missing p_manychat_id" });
    }

    const externalRef = `manychat:${manychatId}`;
    const phone = String(body.p_whatsapp_phone ?? body.p_phone ?? body.phone ?? "").trim() || null;
    const firstName = String(body.p_first_name ?? body.first_name ?? "").trim() || null;
    const lastName = String(body.p_last_name ?? body.last_name ?? "").trim() || null;
    const timezone = String(body.p_timezone ?? body.timezone ?? "").trim();

    const existingRows = await query<{ id: number; notes: string | null }>(
      `
        select id, notes
        from public.customers
        where external_ref = $1
           or ($2::text is not null and phone = $2)
        order by case when external_ref = $1 then 0 else 1 end
        limit 1
      `,
      [externalRef, phone]
    );

    const notesUpdate = timezone ? { timezone } : {};
    let customerId: number;

    if (existingRows[0]) {
      customerId = existingRows[0].id;
      const nextNotes = timezone
        ? `${existingRows[0].notes ? `${existingRows[0].notes}\n` : ""}timezone:${timezone}`.trim()
        : existingRows[0].notes;

      await query(
        `
          update public.customers
          set
            external_ref = coalesce(external_ref, $1),
            phone = coalesce($2, phone),
            first_name = coalesce($3, first_name),
            last_name = coalesce($4, last_name),
            notes = $5,
            updated_at = now()
          where id = $6
        `,
        [externalRef, phone, firstName, lastName, nextNotes, customerId]
      );
    } else {
      const rows = await query<{ id: number }>(
        `
          insert into public.customers (
            external_ref,
            phone,
            first_name,
            last_name,
            notes
          ) values ($1, $2, $3, $4, $5)
          returning id
        `,
        [externalRef, phone, firstName, lastName, Object.keys(notesUpdate).length > 0 ? `timezone:${timezone}` : null]
      );

      customerId = rows[0].id;
    }

    return reply.send({
      upsert_customer: customerId,
      customer_id: customerId,
      id: customerId,
    });
  });

  app.post("/conversations", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (body.skip_save === true) {
      return reply.send({
        skipped: true,
        reason: String(body.reason ?? "skip_save"),
      });
    }

    const manychatId = String(body.manychat_id ?? body.subscriber_id ?? "").trim();

    if (!manychatId) {
      return reply.code(400).send({ error: "Missing manychat_id" });
    }

    const customerId = parsePositiveId(body.customer_id);
    const conversationKey = `manychat:${manychatId}`;
    const channel = String(body.channel ?? "manychat").trim() || "manychat";
    const title = String(body.phone ?? body.whatsapp_phone_number_id ?? `ManyChat ${manychatId}`).trim();

    const conversationRows = await query<{ id: number }>(
      `
        insert into public.conversations (
          customer_id,
          channel,
          channel_thread_key,
          status,
          title,
          last_message_at
        ) values ($1, $2, $3, 'open', $4, now())
        on conflict (channel_thread_key)
        do update set
          customer_id = coalesce(excluded.customer_id, public.conversations.customer_id),
          status = 'open',
          title = coalesce(nullif(excluded.title, ''), public.conversations.title),
          last_message_at = now(),
          updated_at = now()
        returning id
      `,
      [customerId, channel, conversationKey, title || null]
    );

    const conversationId = conversationRows[0].id;
    const role = String(body.role ?? "user").trim().toLowerCase();
    const direction = role === "bot" ? "outbound" : "inbound";
    const senderKind = role === "bot" ? "tool" : "customer";
    const rawType = String(body.message_type ?? "text").trim().toLowerCase();
    const messageType =
      rawType === "audio" || rawType === "image" || rawType === "video" || rawType === "file" || rawType === "event"
        ? rawType
        : "text";
    const textBody = String(body.message ?? body.text ?? "").trim() || null;
    const transcript = String(body.audio_transcription ?? "").trim() || null;

    if (role === "bot" && !textBody) {
      return reply.code(400).send({ error: "Missing bot message text" });
    }

    // ManyChat can occasionally deliver the same inbound event more than once
    // within a very short window. Reuse the recent identical inbound row so the
    // debounce RPC doesn't see the duplicate as a newer customer message.
    if (direction === "inbound" && senderKind === "customer") {
      const duplicateRows = await query<{ id: number; created_at: string }>(
        `
          select id, created_at
          from public.messages
          where conversation_id = $1
            and direction = 'inbound'
            and sender_kind = 'customer'
            and message_type = $2
            and text_body is not distinct from $3
            and transcript is not distinct from $4
            and created_at >= now() - interval '5 seconds'
          order by created_at desc, id desc
          limit 1
        `,
        [conversationId, messageType, textBody, transcript]
      );

      if (duplicateRows[0]) {
        return reply.send({
          id: duplicateRows[0].id,
          conversation_id: conversationId,
          duplicate: true,
        });
      }
    }

    const rows = await query<{ id: number; created_at: string }>(
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
        returning id, created_at
      `,
      [
        conversationId,
        direction,
        senderKind,
        messageType,
        textBody,
        null,
        transcript,
        body,
      ]
    );

    await query(
      `
        update public.conversations
        set last_message_at = $1, updated_at = now()
        where id = $2
      `,
      [rows[0].created_at, conversationId]
    );

    return reply.send({
      id: rows[0].id,
      conversation_id: conversationId,
      duplicate: false,
    });
  });

  app.post("/rpc/check_is_latest_message", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? "").trim();
    const messageId = Number(body.p_message_id ?? body.message_id);

    if (!manychatId || !Number.isFinite(messageId)) {
      return reply.code(400).send({ error: "Missing p_manychat_id or p_message_id" });
    }

    const rows = await query<{ id: number | string }>(
      `
        select m.id
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
        where c.channel_thread_key = $1
          and m.direction = 'inbound'
          and m.sender_kind = 'customer'
        order by m.created_at desc, m.id desc
        limit 1
      `,
      [`manychat:${manychatId}`]
    );

    // bigserial / int8 columns come back from node-pg as strings; JSON p_message_id is a number.
    // Strict === would always fail (e.g. "42" === 42), so debounce always looked "not latest".
    const latestRaw = rows[0]?.id;
    const latestMessageId =
      latestRaw == null || latestRaw === "" ? null : Number(latestRaw);

    const isLatest =
      latestMessageId == null || !Number.isFinite(latestMessageId)
        ? true
        : latestMessageId === messageId;

    return reply.send({
      check_is_latest_message: isLatest,
      latest_message_id: latestMessageId,
      checked_message_id: messageId,
    });
  });

  app.post("/rpc/claim_reply_send", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? "").trim();
    const messageId = Number(body.p_message_id ?? body.message_id);

    if (!manychatId || !Number.isFinite(messageId)) {
      return reply.code(400).send({ error: "Missing p_manychat_id or p_message_id" });
    }

    const rows = await query<{ id: number | string }>(
      `
        update public.messages m
        set payload = jsonb_set(
          coalesce(m.payload, '{}'::jsonb),
          '{reply_send_claimed_at}',
          to_jsonb(now()),
          true
        )
        from public.conversations c
        where m.id = $2
          and m.conversation_id = c.id
          and c.channel_thread_key = $1
          and m.direction = 'inbound'
          and m.sender_kind = 'customer'
          and coalesce(m.payload->>'reply_send_claimed_at', '') = ''
        returning m.id
      `,
      [`manychat:${manychatId}`, messageId]
    );

    return reply.send({
      claim_reply_send: rows.length > 0,
      claimed_message_id: rows[0]?.id == null ? null : Number(rows[0].id),
      checked_message_id: messageId,
    });
  });

  app.post("/rpc/v17_build_turn_context", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? "").trim();
    const userMessage = String(body.p_user_message ?? body.user_message ?? "").trim();
    const recentLimit = Math.max(1, Math.min(20, Number(body.p_recent_limit ?? 10) || 10));
    const storefrontOrderId = Number(body.p_storefront_order_id ?? body.storefront_order_id ?? 0) || null;
    const storefrontOrderToken = String(body.p_storefront_order_token ?? body.storefront_order_token ?? "")
      .trim()
      .toLowerCase();

    if (!manychatId) {
      return reply.code(400).send({ error: "Missing p_manychat_id" });
    }

    const customerRows = await query<{
      id: number;
      external_ref: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      email: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        select id, external_ref, first_name, last_name, phone, email, notes, created_at, updated_at
        from public.customers
        where external_ref = $1
        limit 1
      `,
      [`manychat:${manychatId}`]
    );

    const customer = customerRows[0] ?? null;
    const customerState = parseNotesState(customer?.notes ?? null);

    const conversationRows = await query<{ id: number }>(
      `
        select id
        from public.conversations
        where channel_thread_key = $1
        limit 1
      `,
      [`manychat:${manychatId}`]
    );

    const conversationId = conversationRows[0]?.id ?? null;

    const recentMessages = conversationId
      ? await query<{
          id: number;
          direction: string;
          message_type: string;
          text_body: string | null;
          transcript: string | null;
          created_at: string;
        }>(
          `
            select id, direction, message_type, text_body, transcript, created_at
            from public.messages
            where conversation_id = $1
            order by created_at desc, id desc
            limit $2
          `,
          [conversationId, recentLimit]
        )
      : [];

    const interestedProductKey = customerState.interestedProduct?.trim().toLowerCase() || null;

    const fullCatalogRaw =
      body.p_full_catalog ?? body.p_v19_catalog_all ?? body.p_catalog_broadcast ?? body.p_catalog_all;
    const fullCatalog =
      fullCatalogRaw === true ||
      fullCatalogRaw === 1 ||
      String(fullCatalogRaw ?? "")
        .trim()
        .toLowerCase() === "true" ||
      String(fullCatalogRaw ?? "").trim() === "1";

    const retrievalScoringText = fullCatalog ? "" : buildRetrievalScoringText(userMessage, recentMessages);
    const currentProductSignals = getMessageProductSignals(retrievalScoringText);

    const requestedCap = Number(body.p_candidate_limit);
    const rawFullCatalogMax = Number(body.p_full_catalog_max ?? body.p_catalog_max);
    const fullCatalogMax = Math.max(
      50,
      Math.min(
        5000,
        Number.isFinite(rawFullCatalogMax) && rawFullCatalogMax > 0
          ? rawFullCatalogMax
          : Number.isFinite(requestedCap) && requestedCap > 0
            ? requestedCap
            : 3500,
      ),
    );

    const effectiveBrandKeys = fullCatalog ? [] : currentProductSignals.brandKeys;
    const hasBrandIntent = effectiveBrandKeys.length > 0;
    const candidateLimit = fullCatalog
      ? fullCatalogMax
      : hasBrandIntent
        ? Math.max(1, Math.min(400, Number.isFinite(requestedCap) && requestedCap > 0 ? requestedCap : 300))
        : Math.max(1, Math.min(20, Number.isFinite(requestedCap) && requestedCap > 0 ? requestedCap : 8));

    const brandSql = buildBrandFilterSql(effectiveBrandKeys);
    const rawBrandFetch = Number(body.p_brand_fetch_limit ?? body.p_brand_catalog_max);
    const sqlFetchLimit = fullCatalog
      ? fullCatalogMax
      : hasBrandIntent
        ? Math.min(800, Math.max(1, Number.isFinite(rawBrandFetch) && rawBrandFetch > 0 ? rawBrandFetch : 400))
        : 120;
    const orderClause = fullCatalog
      ? "order by p.in_stock desc, p.title asc nulls last, p.id asc"
      : hasBrandIntent
        ? "order by p.in_stock desc, p.price_amount asc nulls last, p.updated_at desc, p.id desc"
        : "order by p.updated_at desc, p.id desc";

    const brandParams = brandSql?.params ?? [];
    const limitParamIndex = brandParams.length + 1;

    const productRows = await query<ProductRow>(
      `
        select
          p.id,
          p.sku,
          p.slug,
          p.brand,
          p.category,
          p.model,
          p.title,
          p.description,
          p.condition,
          p.price_amount,
          p.price_usd,
          p.promo_price_ars,
          p.bancarizada_total,
          p.bancarizada_cuota,
          p.bancarizada_interest,
          p.macro_total,
          p.macro_cuota,
          p.macro_interest,
          p.cuotas_qty,
          p.usd_rate,
          p.currency_code,
          p.active,
          p.in_stock,
          p.delivery_type,
          p.delivery_days,
          p.image_url,
          p.color,
          p.ram_gb,
          p.storage_gb,
          p.network,
          p.battery_health,
          p.created_at,
          p.updated_at,
          coalesce(inv.in_stock_units, 0) as in_stock_units,
          coalesce(inv.reserved_units, 0) as reserved_units,
          coalesce(inv.sold_units, 0) as sold_units,
          coalesce(inv.total_units, 0) as total_units
        from public.products p
        left join lateral (
          select
            count(*) filter (where status = 'in_stock')::int as in_stock_units,
            count(*) filter (where status = 'reserved')::int as reserved_units,
            count(*) filter (where status = 'sold')::int as sold_units,
            count(*)::int as total_units
          from public.stock_units su
          where su.product_id = p.id
        ) inv on true
        where p.active = true
        ${brandSql?.fragment ?? ""}
        ${orderClause}
        limit $${limitParamIndex}
      `,
      [...brandParams, sqlFetchLimit]
    );
    const usedIphoneCandidates: UsedIphoneCandidate[] = selectUsedIphoneCandidates({
      userMessage: retrievalScoringText,
      customerState,
      limit: fullCatalog ? 0 : Math.min(6, candidateLimit),
    });

    let rankedCandidateProducts = productRows
      .filter((product) => !isDisallowedWorkflowProduct(product))
      .map((product) => {
        const productKey = product.sku.trim().toLowerCase();
        const currentIntentAdjustment = fullCatalog ? 0 : computeCurrentIntentAdjustment(product, currentProductSignals);
        const isBrandCompatible = fullCatalog
          ? true
          : productMatchesRequestedBrands(product, currentProductSignals.brandKeys);
        const interestedProductBoost = fullCatalog
          ? 0
          : interestedProductKey && productKey === interestedProductKey && isBrandCompatible
            ? currentProductSignals.hasSpecificIntent
              ? Math.max(0, 12 + currentIntentAdjustment)
              : 14
            : 0;

        return {
          score: scoreCandidate(product, retrievalScoringText) + currentIntentAdjustment + interestedProductBoost,
          product_id: product.id,
          product_key: product.sku,
          slug: product.slug,
          model: product.model,
          product_name: product.title,
          description: product.description,
          product_url: null,
          brand_key: normalizeCatalogBrandKey(product.brand),
          category: product.category,
          condition: product.condition,
          storage_gb: product.storage_gb ?? inferStorageGb(product),
          ram_gb: product.ram_gb,
          color: product.color ?? inferColor(product),
          in_stock: product.in_stock,
          in_stock_units: product.in_stock_units,
          delivery_type: product.delivery_type,
          delivery_days: product.delivery_days,
          network: product.network,
          battery_health: product.battery_health,
          price_ars: product.price_amount == null ? null : Number(product.price_amount),
          promo_price_ars: product.promo_price_ars == null ? null : Number(product.promo_price_ars),
          price_usd: product.price_usd == null ? null : Number(product.price_usd),
          bancarizada_total: product.bancarizada_total == null ? null : Number(product.bancarizada_total),
          bancarizada_cuota: product.bancarizada_cuota == null ? null : Number(product.bancarizada_cuota),
          bancarizada_interest: product.bancarizada_interest == null ? null : Number(product.bancarizada_interest),
          macro_total: product.macro_total == null ? null : Number(product.macro_total),
          macro_cuota: product.macro_cuota == null ? null : Number(product.macro_cuota),
          macro_interest: product.macro_interest == null ? null : Number(product.macro_interest),
          cuotas_qty: product.cuotas_qty == null ? null : Number(product.cuotas_qty),
          usd_rate: product.usd_rate == null ? null : Number(product.usd_rate),
          currency_code: product.currency_code == null ? null : String(product.currency_code),
          image_url: product.image_url,
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (Number(right.in_stock) !== Number(left.in_stock)) return Number(right.in_stock) - Number(left.in_stock);
        return 0;
      });

    if (fullCatalog) {
      rankedCandidateProducts.sort((left, right) =>
        String(left.product_name || "").localeCompare(String(right.product_name || ""), "es", {
          sensitivity: "base",
        }),
      );
    }

    if (!fullCatalog && currentProductSignals.brandKeys.length > 0) {
      const brandFiltered = rankedCandidateProducts.filter((candidate) =>
        candidateMatchesRetrievalBrandKeys(candidate, currentProductSignals.brandKeys)
      );
      if (brandFiltered.length > 0) {
        rankedCandidateProducts = brandFiltered;
      }
    }

    const shouldPrioritizeBroadBrandCatalog =
      !fullCatalog &&
      currentProductSignals.brandKeys.length === 1 &&
      !currentProductSignals.hasSpecificIntent;
    const shortlistedCandidateProducts = shouldPrioritizeBroadBrandCatalog
      ? prioritizeBrandBrowseCandidates(
          rankedCandidateProducts,
          currentProductSignals.brandKeys[0],
          rankedCandidateProducts.length
        )
      : rankedCandidateProducts.slice(0, candidateLimit);

    const settingsRows = await query<{ key: string; value: unknown }>(
      `
        select key, value
        from public.settings
      `
    );

    const settingsMap = new Map(settingsRows.map((row) => [row.key, row.value]));
    const storeRoot = asRecord(settingsMap.get("store")) ?? {};

    const store = {
      store_location_name:
        settingValueToText(settingsMap.get("store_location_name")) ||
        settingValueToText(storeRoot.store_location_name) ||
        settingValueToText(storeRoot.name) ||
        "TechnoStore",
      store_address:
        settingValueToText(settingsMap.get("store_address")) ||
        settingValueToText(storeRoot.store_address),
      store_hours:
        settingValueToText(settingsMap.get("store_hours")) ||
        settingValueToText(storeRoot.store_hours),
      store_payment_methods:
        settingValueToText(settingsMap.get("store_payment_methods")) ||
        settingValueToText(storeRoot.store_payment_methods),
      store_shipping_policy:
        settingValueToText(settingsMap.get("store_shipping_policy")) ||
        settingValueToText(storeRoot.store_shipping_policy),
      store_warranty_new:
        settingValueToText(settingsMap.get("store_warranty_new")) ||
        settingValueToText(storeRoot.store_warranty_new),
      store_warranty_used:
        settingValueToText(settingsMap.get("store_warranty_used")) ||
        settingValueToText(storeRoot.store_warranty_used),
      store_website_url:
        settingValueToText(settingsMap.get("store_website_url")) ||
        settingValueToText(storeRoot.store_website_url) ||
        settingValueToText(storeRoot.storefront_url) ||
        "https://technostoresalta.com",
      store_usd_rate:
        asNullableNumber(settingsMap.get("pricing_default_usd_rate")) ??
        asNullableNumber(settingsMap.get("usd_to_ars")) ??
        asNullableNumber(storeRoot.pricing_default_usd_rate) ??
        asNullableNumber(storeRoot.usd_to_ars),
    };

    const candidateProducts: CandidateProduct[] = shortlistedCandidateProducts.map((product) => ({
      ...product,
      product_url: buildProductUrl(store.store_website_url, product.product_key),
    }));

    const customerName = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || null : null;
    const customerPhone = customer?.phone?.trim() || null;
    const directPaymentProduct = pickDirectPaymentProduct({
      userMessage,
      interestedProductKey,
      candidateProducts,
    });

    let storefrontHandoff: Awaited<ReturnType<typeof resolveStorefrontCheckoutHandoff>> | {
      ok: false;
      order: null;
      payment: null;
    } = {
      ok: false,
      order: null,
      payment: null,
    };

    if (storefrontOrderId && storefrontOrderToken) {
      try {
        storefrontHandoff = await resolveStorefrontCheckoutHandoff(storefrontOrderId, storefrontOrderToken);

        if (storefrontHandoff.ok && customer) {
          await query(
            `
              update public.orders
              set
                customer_id = coalesce(customer_id, $2),
                updated_at = now()
              where id = $1
            `,
            [storefrontOrderId, customer.id]
          );

          await query(
            `
              update public.storefront_checkout_intents
              set
                customer_phone = coalesce(nullif(customer_phone, ''), $3),
                customer_name = coalesce(nullif(customer_name, ''), $4),
                updated_at = now()
              where order_id = $1
                and token = $2
            `,
            [storefrontOrderId, storefrontOrderToken, customerPhone, customerName]
          );
        }
      } catch (error) {
        storefrontHandoff = {
          ok: true,
          order: {
            id: storefrontOrderId,
            order_number: `TOC-${storefrontOrderId}`,
            item_count: 1,
            product_id: 0,
            product_key: null,
            subtotal: 0,
            total: 0,
            currency_code: "ARS",
            status: "pending",
            title: "pedido web",
            image_url: null,
            delivery_days: null,
            checkout_channel: "storefront",
          },
          payment: {
            ready: false,
            status: "failed",
            url: null,
            provider: getDefaultCheckoutPaymentProvider(),
            message: error instanceof Error ? error.message : "No se pudo preparar el link de pago.",
          },
        };
      }
    } else if (directPaymentProduct) {
      try {
        storefrontHandoff = await ensureStorefrontCheckoutHandoff({
          productId: directPaymentProduct.product_id,
          sourceHost: hostFromUrl(store.store_website_url),
          sourcePath: "/whatsapp/payment-request",
          channel: "whatsapp",
          customerId: customer?.id ?? null,
          customerPhone,
          customerName,
        });
      } catch (error) {
        const subtotal = directPaymentProduct.promo_price_ars ?? directPaymentProduct.price_ars ?? 0;

        storefrontHandoff = {
          ok: true,
          order: {
            id: 0,
            order_number: "",
            item_count: 1,
            product_id: directPaymentProduct.product_id,
            product_key: directPaymentProduct.product_key,
            subtotal,
            total: subtotal,
            currency_code: "ARS",
            status: "pending",
            title: directPaymentProduct.product_name,
            image_url: directPaymentProduct.image_url,
            delivery_days: directPaymentProduct.delivery_days,
            checkout_channel: "whatsapp",
          },
          payment: {
            ready: false,
            status: "failed",
            url: null,
            provider: getDefaultCheckoutPaymentProvider(),
            message: error instanceof Error ? error.message : "No se pudo preparar el link de pago.",
          },
        };
      }
    }

    return reply.send({
      v17_build_turn_context: {
        customer: customer
          ? {
              customer_id: customer.id,
              manychat_id: manychatId,
              first_name: customer.first_name,
              last_name: customer.last_name,
              phone: customer.phone,
              email: customer.email,
              lead_score: customerState.leadScore,
              funnel_stage: customerState.funnelStage,
              last_intent: customerState.lastIntent,
              tags: customerState.tags,
              interested_product: customerState.interestedProduct,
              brands_mentioned: customerState.brandsMentioned,
              payment_method_last: customerState.paymentMethodLast,
              last_bot_interaction: customerState.lastBotInteraction,
            }
          : null,
        recent_messages: recentMessages
          .slice()
          .reverse()
          .map((message) => ({
            id: message.id,
            role: message.direction === "inbound" ? "user" : "bot",
            message: message.text_body ?? message.transcript ?? "",
            message_type: message.message_type,
            created_at: message.created_at,
          })),
        candidate_products: candidateProducts,
        used_iphone_catalog: {
          enabled: false,
          currency: staticUsedIphoneCatalog.currency,
          markup_pct: 0,
          total_items: 0,
          captured_on: null,
        },
        used_iphone_candidates: usedIphoneCandidates.map((item) => ({
          id: item.id,
          model_name: item.model_name,
          family_number: item.family_number,
          tier_key: item.tier_key,
          storage_gb: item.storage_gb,
          color: item.color,
          battery_health_pct: item.battery_health_pct,
          battery_note: item.battery_note,
          condition: item.condition,
          sale_price_usd: item.sale_price_usd,
        })),
        store,
        storefront_handoff: storefrontHandoff,
      },
    });
  });

  app.patch("/customers", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const url = new URL(request.url, "http://localhost");
    const rawManychatQuery = url.searchParams.get("manychat_id") ?? "";
    const manychatId = rawManychatQuery.startsWith("eq.")
      ? rawManychatQuery.slice(3)
      : rawManychatQuery;

    if (!manychatId) {
      return reply.code(400).send({ error: "Missing manychat_id query filter" });
    }

    const externalRef = `manychat:${manychatId}`;
    const rows = await query<{ id: number; notes: string | null }>(
      `
        select id, notes
        from public.customers
        where external_ref = $1
        limit 1
      `,
      [externalRef]
    );

    let customerId = rows[0]?.id ?? null;
    let currentNotes = rows[0]?.notes ?? null;

    if (!customerId) {
      const created = await query<{ id: number }>(
        `
          insert into public.customers (external_ref)
          values ($1)
          returning id
        `,
        [externalRef]
      );

      customerId = created[0].id;
      currentNotes = null;
    }

    const nextNotes = buildNotesState({
      currentNotes,
      updates: body,
    });

    const updatedRows = await query(
      `
        update public.customers
        set notes = $1, updated_at = now()
        where id = $2
        returning id, external_ref, phone, first_name, last_name, notes, updated_at
      `,
      [nextNotes, customerId]
    );

    return reply.send(updatedRows[0]);
  });

  app.post("/ai_workflow_turns", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const entityId = String(body.manychat_id ?? body.customer_id ?? Date.now());

    const rows = await query(
      `
        insert into public.audit_logs (
          actor_type,
          actor_id,
          action,
          entity_type,
          entity_id,
          metadata
        ) values ('tool', 'n8n', 'n8n.ai_turn.logged', 'workflow_turn', $1, $2)
        returning id, created_at
      `,
      [entityId, body]
    );

    return reply.code(201).send(rows[0]);
  });
};
