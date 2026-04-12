/**
 * Sales Agent - App-native replacement for TechnoStore v17 workflows
 * 
 * This module handles the complete conversation turn processing:
 * 1. Message ingestion (Telegram/WhatsApp)
 * 2. Audio transcription (Groq Whisper)
 * 3. Debounce + latest-message check
 * 4. Customer upsert
 * 5. Context building (messages, products, settings)
 * 6. Intent routing
 * 7. AI response generation (Ollama qwen3.5:cloud)
 * 8. Response validation
 * 9. State delta application
 * 10. Outbound response delivery
 */

import { config } from "./config.js";
import { pool } from "./db.js";

// ============ Types ============

export interface Customer {
  id: number;
  external_ref: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: number;
  customer_id: number | null;
  channel: string;
  channel_thread_key: string;
  status: "open" | "closed" | "archived";
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface Message {
  id: number;
  conversation_id: number;
  direction: "inbound" | "outbound" | "system";
  sender_kind: "customer" | "agent" | "admin" | "tool" | "system";
  message_type: "text" | "audio" | "image" | "video" | "file" | "event";
  text_body: string | null;
  media_url: string | null;
  transcript: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Product {
  id: number;
  sku: string;
  slug: string;
  brand: string;
  model: string;
  title: string;
  description: string | null;
  condition: "new" | "used" | "like_new" | "refurbished";
  price_amount: number | null;
  currency_code: string;
  active: boolean;
  in_stock: boolean;
  delivery_days: number | null;
  created_at: string;
  updated_at: string;
}

export interface StoreSettings {
  name: string;
  storefront_url: string;
  ops_host: string;
  address: string | null;
  hours: string | null;
}

export interface TurnContext {
  customer: Customer | null;
  conversation: Conversation | null;
  recent_messages: Message[];
  candidate_products: Product[];
  store: StoreSettings;
  user_message: string;
  channel: string;
  is_audio: boolean;
  raw_message: string;
}

export interface RouterOutput {
  route_key: "exact_product_quote" | "brand_catalog" | "generic_sales" | "store_info" | "storefront_order" | "unknown";
  confidence: number;
  matched_product_keys: string[];
  matched_brand: string | null;
  detected_city: string | null;
  detected_budget_range: string | null;
  detected_payment_method: string | null;
}

export interface ResponderOutput {
  selected_product_keys: string[];
  actions: string[];
  state_delta: {
    intent_key?: string;
    funnel_stage?: string;
    lead_score_delta?: number;
    selected_product_keys?: string[];
    share_store_location?: boolean;
  };
  raw_text: string;
}

export interface ValidatorOutput {
  approved: boolean;
  reply_messages: Array<{ type: "text"; text: string }>;
  selected_product_keys: string[];
  actions: string[];
  final_state_delta: {
    intent_key: string;
    funnel_stage: string;
    lead_score_delta: number;
    selected_product_keys: string[];
    share_store_location: boolean;
    tags_to_add: string[];
    tags_to_remove: string[];
  };
  validation_errors: Array<{ code: string; message: string }>;
  validation_warnings: Array<{ code: string; message: string }>;
  fallback_reason: string | null;
}

export interface TurnResult {
  should_reply: boolean;
  reply_text: string;
  reply_messages: Array<{ type: "text"; text: string }>;
  customer_id: number | null;
  conversation_id: number | null;
  message_id: number | null;
  state_applied: boolean;
  router_output: RouterOutput | null;
  validator_output: ValidatorOutput | null;
}

// ============ Constants ============

const ALLOWED_ACTIONS = new Set([
  "attach_store_url",
  "attach_product_images",
  "share_store_location",
  "no_reply",
]);

const DEFAULT_INTENT_BY_ROUTE: Record<string, string> = {
  storefront_order: "storefront_order",
  exact_product_quote: "price_inquiry",
  brand_catalog: "catalog_browse",
  generic_sales: "greeting",
  store_info: "store_info",
};

const DEFAULT_STAGE_BY_ROUTE: Record<string, string> = {
  storefront_order: "closing",
  exact_product_quote: "interested",
  brand_catalog: "browsing",
  generic_sales: "browsing",
  store_info: "browsing",
};

const BRAND_ALIASES: Record<string, string[]> = {
  apple: ["apple", "iphone", "ipad", "ios"],
  samsung: ["samsung", "samsumg", "samgung", "sansung", "galaxy"],
  motorola: ["motorola", "moto"],
  xiaomi_family: ["xiaomi", "xaomi", "xiami", "xioami", "mi", "redmi", "redmy", "rexmi", "redim", "remdi", "poco"],
  google: ["google", "pixel"],
  jbl: ["jbl", "parlante", "parlantes", "speaker", "speakers"],
};

const PRODUCT_MATCH_STOPWORDS = new Set([
  "apple",
  "ars",
  "blue",
  "buenas",
  "catalogo",
  "catalogos",
  "celular",
  "celulares",
  "color",
  "con",
  "cuanto",
  "de",
  "del",
  "disponible",
  "disponibles",
  "el",
  "en",
  "equipo",
  "equipos",
  "esta",
  "este",
  "hay",
  "hola",
  "iphone",
  "la",
  "las",
  "lista",
  "los",
  "mas",
  "me",
  "modelo",
  "modelos",
  "para",
  "precio",
  "precios",
  "pro",
  "que",
  "queria",
  "queria",
  "queres",
  "queria",
  "quiero",
  "samsung",
  "son",
  "stock",
  "tarde",
  "tenes",
  "tienen",
  "tienen",
  "ultra",
  "un",
  "una",
  "whatsapp",
  "y",
]);

const INTENT_KEYWORDS: Record<string, string[]> = {
  price_inquiry: ["precio", "cuanto", "valor", "costa", "cuanto sale", "precio tiene"],
  catalog_browse: ["catalogo", "modelos", "tenes", "disponibles", "que hay", "ver"],
  greeting: ["hola", "buenas", "que tal", "anda", "consultar", "info"],
  store_info: ["direccion", "ubicacion", "donde estan", "local", "tienda"],
  storefront_order: ["comprar", "ordenar", "pedir", "quiero", "llevar"],
};

const FUNNEL_STAGE_KEYWORDS: Record<string, string[]> = {
  greeting: ["hola", "buenas", "que tal"],
  browsing: ["ver", "catalogo", "modelos", "tenes", "disponibles"],
  interested: ["precio", "cuanto", "este", "ese", "me interesa"],
  closing: ["comprar", "llevar", "quiero", "ordenar", "pago"],
};

// ============ Core Functions ============

/**
 * Normalize incoming message text
 */
function normalizeMessageText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toTokens(value: string) {
  return normalizeMessageText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function isGreetingMessage(text: string) {
  const normalized = normalizeMessageText(text);
  return /^(hola|buenas|buen dia|buenas tardes|buenas noches|como va|como andan|estan atendiendo)\b/.test(normalized);
}

function isCatalogRequest(text: string) {
  const normalized = normalizeMessageText(text);
  return /(catalogo|catalogos|lista de precios|lista de precio|lista|modelos|disponibles|que tenes|que tienen|que hay|ver modelos|ver equipos|equipos disponibles|precios)/.test(
    normalized
  );
}

function isAppleBrand(value: string) {
  const normalized = normalizeMessageText(value);
  return normalized === "apple" || normalized === "iphone";
}

function normalizeCatalogBrand(value: string) {
  const normalized = normalizeMessageText(value);
  if (["xiaomi", "redmi", "poco"].includes(normalized)) {
    return "xiaomi_family";
  }
  return normalized;
}

function formatBrandLabel(brand: string) {
  if (normalizeCatalogBrand(brand) === "xiaomi_family") {
    return "Xiaomi / Redmi / Poco";
  }
  return isAppleBrand(brand) ? "iPhone" : brand.trim();
}

function buildStorefrontProductPath(sku: string) {
  const normalizedSku = sku.trim().toLowerCase();
  if (!normalizedSku) {
    return "/";
  }

  return normalizedSku.startsWith("iphone-")
    ? `/iphone/${encodeURIComponent(normalizedSku)}`
    : `/${encodeURIComponent(normalizedSku)}`;
}

function buildStorefrontProductUrl(storefrontUrl: string, sku: string) {
  return `${storefrontUrl.replace(/\/$/, "")}${buildStorefrontProductPath(sku)}`;
}

function buildBrandCatalogUrl(storefrontUrl: string, brand: string) {
  return isAppleBrand(brand) ? `${storefrontUrl.replace(/\/$/, "")}/iphone` : storefrontUrl.replace(/\/$/, "");
}

function formatMoney(amount: number | null, currencyCode: string) {
  if (amount == null) {
    return "Consultar precio";
  }

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: currencyCode || "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatAvailability(product: Product) {
  if (product.in_stock) {
    return "En stock";
  }

  if (product.delivery_days != null && product.delivery_days > 0) {
    return `Entrega en ${product.delivery_days} dias`;
  }

  return "Consultar disponibilidad";
}

function getDistinctBrands(products: Product[]) {
  const counters = new Map<string, { brand: string; count: number }>();

  for (const product of products) {
    const key = normalizeCatalogBrand(product.brand);
    const current = counters.get(key);
    if (current) {
      current.count += 1;
    } else {
      counters.set(key, { brand: product.brand, count: 1 });
    }
  }

  return [...counters.values()].sort((left, right) => right.count - left.count || left.brand.localeCompare(right.brand));
}

function detectBrandMention(text: string, products: Product[]) {
  const normalized = normalizeMessageText(text);
  const brands = getDistinctBrands(products);

  for (const entry of brands) {
    const brandKey = normalizeCatalogBrand(entry.brand);
    const aliases = BRAND_ALIASES[brandKey] ?? [brandKey];
    if (aliases.some((alias) => normalized.includes(alias))) {
      return entry.brand;
    }
  }

  return null;
}

function productSpecificityScore(text: string, product: Product) {
  const normalized = normalizeMessageText(text);
  const normalizedSku = normalizeMessageText(product.sku);
  const normalizedSlug = normalizeMessageText(product.slug);
  const normalizedTitle = normalizeMessageText(product.title);
  const normalizedModel = normalizeMessageText(product.model);

  if (normalized.includes(normalizedSku) || normalized.includes(normalizedSlug)) {
    return 100;
  }

  if (normalizedTitle && normalizedTitle.length >= 12 && normalized.includes(normalizedTitle)) {
    return 92;
  }

  if (normalizedModel && normalizedModel.length >= 10 && normalized.includes(normalizedModel)) {
    return 85;
  }

  const messageTokens = new Set(toTokens(text));
  const brandTokens = new Set(toTokens(product.brand));
  const productTokens = [...new Set(toTokens(`${product.model} ${product.title} ${product.sku} ${product.slug}`))]
    .filter((token) => token.length >= 2)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !PRODUCT_MATCH_STOPWORDS.has(token));

  const sharedTokens = productTokens.filter((token) => messageTokens.has(token));
  const hasNumericSignal = sharedTokens.some((token) => /\d/.test(token));

  if (sharedTokens.length >= 2 && hasNumericSignal) {
    return 70 + sharedTokens.length;
  }

  if (sharedTokens.length >= 3) {
    return 60 + sharedTokens.length;
  }

  return 0;
}

function findSpecificProductMatches(text: string, products: Product[]) {
  const scored = products
    .map((product) => ({ product, score: productSpecificityScore(text, product) }))
    .filter((entry) => entry.score >= 72)
    .sort((left, right) => right.score - left.score || left.product.title.localeCompare(right.product.title));

  if (scored.length === 0) {
    return [];
  }

  const bestScore = scored[0].score;
  return scored
    .filter((entry) => bestScore - entry.score <= 8)
    .slice(0, 4)
    .map((entry) => entry.product);
}

function filterProductsByBrand(products: Product[], brand: string) {
  const brandKey = normalizeCatalogBrand(brand);
  return products.filter((product) => normalizeCatalogBrand(product.brand) === brandKey);
}

function isDisallowedWorkflowProduct(product: Pick<Product, "brand" | "condition">) {
  return isAppleBrand(product.brand) && product.condition.trim().toLowerCase() !== "new";
}

function sortProductsForCatalog(products: Product[]) {
  return [...products].sort((left, right) => {
    if (left.in_stock !== right.in_stock) {
      return left.in_stock ? -1 : 1;
    }

    if (left.price_amount != null && right.price_amount != null && left.price_amount !== right.price_amount) {
      return left.price_amount - right.price_amount;
    }

    if (left.price_amount == null && right.price_amount != null) {
      return 1;
    }

    if (left.price_amount != null && right.price_amount == null) {
      return -1;
    }

    return right.updated_at.localeCompare(left.updated_at);
  });
}

function buildBrandChooserReply(products: Product[]) {
  const brands = getDistinctBrands(products).slice(0, 8);
  const lines = [
    "Si, te ayudo a elegir rapido.",
    "",
    "Decime la marca que mas te guste y te mando opciones con precio de contado y cuotas:",
    ...brands.map((entry) => `- ${formatBrandLabel(entry.brand)} (${entry.count})`),
    "",
    "Si queres, tambien te armo algo mas puntual por memoria o presupuesto.",
  ];

  return lines.join("\n");
}

function buildCatalogListReply(params: {
  intro: string;
  products: Product[];
  storefrontUrl: string;
  catalogUrl?: string;
}) {
  const lines = [params.intro];
  let message = lines.join("\n");

  for (const [index, product] of params.products.entries()) {
    const block = [
      "",
      `${index + 1}. ${product.title}`,
      `Precio: ${formatMoney(product.price_amount, product.currency_code)}`,
      `Estado: ${formatAvailability(product)}`,
      `Link: ${buildStorefrontProductUrl(params.storefrontUrl, product.sku)}`,
    ].join("\n");

    if (`${message}${block}`.length > 1050) {
      break;
    }

    message += block;
  }

  if (params.catalogUrl && `${message}\n\nCatalogo completo: ${params.catalogUrl}`.length <= 1080) {
    message += `\n\nCatalogo completo: ${params.catalogUrl}`;
  }

  return `${message}\n\nSi queres, te ayudo a elegir el que mas te conviene por memoria, precio o color.`;
}

function buildExactProductReply(products: Product[], storefrontUrl: string) {
  if (products.length === 0) {
    return "Decime el modelo exacto y te paso precio y link directo.";
  }

  if (products.length === 1) {
    const product = products[0];
    return [
      "Si, esta es una muy buena opcion:",
      "",
      product.title,
      `Precio: ${formatMoney(product.price_amount, product.currency_code)}`,
      `Estado: ${formatAvailability(product)}`,
      `Link: ${buildStorefrontProductUrl(storefrontUrl, product.sku)}`,
      "",
      "Si queres, tambien te paso otras variantes o te explico como avanzar con la compra.",
    ].join("\n");
  }

  return buildCatalogListReply({
    intro: "Encontre estas variantes publicadas:",
    products,
    storefrontUrl,
  });
}

function buildStoreInfoReply(store: StoreSettings) {
  const lines = [`Te paso los datos de ${store.name}:`];

  if (store.address) {
    lines.push("", `Direccion: ${store.address}`);
  }

  if (store.hours) {
    lines.push(`Horarios: ${store.hours}`);
  }

  lines.push(`Catalogo: ${store.storefront_url}`);
  lines.push("", "Si queres, tambien te paso modelos por marca directo por WhatsApp.");

  return lines.join("\n");
}

/**
 * Detect intent from message text
 */
function detectIntent(text: string): string {
  const normalized = normalizeMessageText(text);
  
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        return intent;
      }
    }
  }
  
  return "unknown";
}

/**
 * Detect funnel stage from message text
 */
function detectFunnelStage(text: string): string {
  const normalized = normalizeMessageText(text);
  
  for (const [stage, keywords] of Object.entries(FUNNEL_STAGE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        return stage;
      }
    }
  }
  
  return "browsing";
}

/**
 * Detect city from message text (simple heuristic)
 */
function detectCity(text: string): string | null {
  const normalized = normalizeMessageText(text);
  
  if (normalized.includes("salta")) return "salta";
  if (normalized.includes("bsas") || normalized.includes("buenos aires")) return "buenos_aires";
  if (normalized.includes("cordoba") || normalized.includes("córdoba")) return "cordoba";
  if (normalized.includes("rosario")) return "rosario";
  if (normalized.includes("mendoza")) return "mendoza";
  
  return null;
}

/**
 * Route the turn based on message content and context
 */
export async function routeTurn(context: TurnContext): Promise<RouterOutput> {
  const text = context.user_message;
  const products = context.candidate_products;
  const normalized = normalizeMessageText(text);
  const matchedBrand = detectBrandMention(text, products);

  if (isCatalogRequest(text)) {
    return {
      route_key: "brand_catalog",
      confidence: matchedBrand ? 0.88 : 0.8,
      matched_product_keys: [],
      matched_brand: matchedBrand,
      detected_city: detectCity(text),
      detected_budget_range: null,
      detected_payment_method: null,
    };
  }
  
  // Check for exact product quote
  const mentionedProducts = findSpecificProductMatches(text, products);
  if (mentionedProducts.length > 0) {
    return {
      route_key: "exact_product_quote",
      confidence: 0.9,
      matched_product_keys: mentionedProducts.map((product) => product.sku),
      matched_brand: matchedBrand,
      detected_city: detectCity(text),
      detected_budget_range: null,
      detected_payment_method: null,
    };
  }
  
  // Check for brand catalog
  if (matchedBrand) {
    return {
      route_key: "brand_catalog",
      confidence: 0.75,
      matched_product_keys: [],
      matched_brand: matchedBrand,
      detected_city: detectCity(text),
      detected_budget_range: null,
      detected_payment_method: null,
    };
  }
  
  // Check for storefront order intent
  if (normalized.includes("comprar") || normalized.includes("quiero") || normalized.includes("llevar")) {
    return {
      route_key: "storefront_order",
      confidence: 0.7,
      matched_product_keys: [],
      matched_brand: null,
      detected_city: detectCity(text),
      detected_budget_range: null,
      detected_payment_method: null,
    };
  }
  
  // Check for store info
  if (normalized.includes("direccion") || normalized.includes("ubicacion") || normalized.includes("donde")) {
    return {
      route_key: "store_info",
      confidence: 0.8,
      matched_product_keys: [],
      matched_brand: null,
      detected_city: detectCity(text),
      detected_budget_range: null,
      detected_payment_method: null,
    };
  }
  
  // Default to generic sales
  return {
    route_key: "generic_sales",
    confidence: 0.5,
    matched_product_keys: [],
    matched_brand: null,
    detected_city: detectCity(text),
    detected_budget_range: null,
    detected_payment_method: null,
  };
}

/**
 * Generate deterministic sales response for WhatsApp/ManyChat
 */
export async function generateResponse(context: TurnContext, router: RouterOutput): Promise<ResponderOutput> {
  const actions: string[] = [];
  const storefrontUrl = context.store.storefront_url || "https://technostoresalta.com";
  const intentKey =
    router.route_key !== "unknown" ? DEFAULT_INTENT_BY_ROUTE[router.route_key] || detectIntent(context.user_message) : detectIntent(context.user_message);
  const funnelStage = DEFAULT_STAGE_BY_ROUTE[router.route_key] || detectFunnelStage(context.user_message);
  const leadScoreDelta = funnelStage === "closing" ? 15 : funnelStage === "interested" ? 10 : 5;

  let rawText = "";
  let selectedProductKeys = router.matched_product_keys;

  switch (router.route_key) {
    case "brand_catalog": {
      if (!router.matched_brand) {
        rawText = buildBrandChooserReply(context.candidate_products);
        break;
      }

      const brandProducts = sortProductsForCatalog(filterProductsByBrand(context.candidate_products, router.matched_brand)).slice(0, 10);
      if (brandProducts.length === 0) {
        rawText = `No veo productos activos de ${formatBrandLabel(
          router.matched_brand
        )} en este momento. Si queres, te muestro otra marca y te paso opciones con contado y cuotas.`;
        break;
      }

      rawText = buildCatalogListReply({
        intro: `Te paso algunos ${formatBrandLabel(router.matched_brand)} que hoy salen muy bien:`,
        products: brandProducts,
        storefrontUrl,
        catalogUrl: buildBrandCatalogUrl(storefrontUrl, router.matched_brand),
      });
      actions.push("attach_store_url");
      break;
    }
    case "exact_product_quote": {
      const matchedProducts = sortProductsForCatalog(
        context.candidate_products.filter((product) => router.matched_product_keys.includes(product.sku))
      );
      selectedProductKeys = matchedProducts.map((product) => product.sku);
      rawText = buildExactProductReply(matchedProducts, storefrontUrl);
      actions.push("attach_store_url");
      break;
    }
    case "generic_sales": {
      const brands = getDistinctBrands(context.candidate_products)
        .slice(0, 5)
        .map((entry) => formatBrandLabel(entry.brand))
        .join(", ");
      rawText = isGreetingMessage(context.user_message)
        ? `Si, estamos atendiendo.\n\nContame que marca o modelo te interesa y te paso opciones lindas con precio de contado y cuotas.\n\nHoy estamos trabajando mucho ${brands}.`
        : `Contame que marca, categoria o modelo buscas y te paso opciones publicadas con precio de contado y cuotas.\n\nSi queres, te ayudo a encontrar algo bueno por marca, memoria o presupuesto.`;
      break;
    }
    case "store_info": {
      rawText = buildStoreInfoReply(context.store);
      actions.push("attach_store_url");
      if (context.store.address) {
        actions.push("share_store_location");
      }
      break;
    }
    case "storefront_order": {
      rawText =
        "Decime que modelo queres comprar y te paso el link correcto.\n\nSi preferis, tambien te muestro opciones por marca con contado y cuotas para elegir mas rapido.";
      actions.push("attach_store_url");
      break;
    }
    default: {
      rawText = "Contame que modelo o marca buscas y te paso precio, cuotas y opciones publicadas.";
      break;
    }
  }

  return {
    selected_product_keys: selectedProductKeys,
    actions,
    state_delta: {
      intent_key: intentKey,
      funnel_stage: funnelStage,
      lead_score_delta: leadScoreDelta,
      selected_product_keys: selectedProductKeys.length > 0 ? selectedProductKeys : undefined,
      share_store_location: actions.includes("share_store_location"),
    },
    raw_text: rawText.trim(),
  };
}

/**
 * Validate response (strip URLs, enforce limits, check actions)
 */
export function validateResponse(data: {
  responder_output: ResponderOutput;
  context: TurnContext;
}): ValidatorOutput {
  const responder = data.responder_output;
  const context = data.context;
  
  let replyText = responder.raw_text;
  const validationErrors: Array<{ code: string; message: string }> = [];
  const validationWarnings: Array<{ code: string; message: string }> = [];
  
  // Enforce character limit
  if (replyText.length > 1100) {
    validationWarnings.push({
      code: "response_too_long",
      message: `Response is ${replyText.length} chars, limit is 1100`,
    });
    replyText = replyText.slice(0, 1100).trim();
  }
  
  // Strip unexpected URLs (only allow store URL)
  const allowedHost = (() => {
    try {
      return new URL(context.store.storefront_url).host;
    } catch {
      return "";
    }
  })();
  replyText = replyText
    .replace(/logo en\s*https?:\/\/[^\s]+\.?/gi, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/[^\s]+/gi, (url) => {
      if (!allowedHost) {
        return url;
      }

      try {
        const parsed = new URL(url);
        if (parsed.host === allowedHost) {
          return url;
        }
      } catch {
        // Ignore parse failure and strip the URL below.
      }

      validationWarnings.push({
        code: "unexpected_url",
        message: `Stripped unexpected URL: ${url}`,
      });
      return "";
    })
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  
  // Filter actions
  const actionList = responder.actions.filter((a) => ALLOWED_ACTIONS.has(a));
  
  // Build final state delta
  const finalStateDelta = {
    intent_key: responder.state_delta.intent_key || "unknown",
    funnel_stage: responder.state_delta.funnel_stage || "browsing",
    lead_score_delta: responder.state_delta.lead_score_delta || 0,
    selected_product_keys: responder.selected_product_keys || [],
    share_store_location: responder.state_delta.share_store_location === true,
    tags_to_add: [],
    tags_to_remove: [],
  };
  
  // Add tags based on intent
  if (finalStateDelta.intent_key === "price_inquiry") {
    (finalStateDelta.tags_to_add as string[]).push("tag:price_inquiry");
  }
  if (finalStateDelta.funnel_stage === "closing") {
    (finalStateDelta.tags_to_add as string[]).push("tag:hot_lead");
  }
  
  const approved = validationErrors.length === 0;
  const replyMessages = [{ type: "text" as const, text: replyText }];
  const shouldSend = !actionList.includes("no_reply");
  
  return {
    approved,
    reply_messages: shouldSend ? replyMessages : [],
    selected_product_keys: responder.selected_product_keys || [],
    actions: actionList,
    final_state_delta: finalStateDelta,
    validation_errors: validationErrors,
    validation_warnings: validationWarnings,
    fallback_reason: validationWarnings.length > 0 ? validationWarnings[0].code : null,
  };
}

/**
 * Fetch turn context from database
 */
export async function fetchTurnContext(params: {
  channel: string;
  channel_thread_key: string;
  user_message: string;
  raw_message: string;
  is_audio: boolean;
  subscriber_id?: string;
  phone?: string;
}): Promise<TurnContext> {
  const { channel, channel_thread_key, user_message, raw_message, is_audio } = params;
  
  // Fetch or create customer
  let customer: Customer | null = null;
  if (params.subscriber_id) {
    const externalRef = `${channel}-user:${params.subscriber_id}`;
    const customerResult = await pool.query(
      `
      INSERT INTO public.customers (external_ref, first_name, last_name, phone, notes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (external_ref) DO UPDATE
        SET updated_at = now()
      RETURNING id, external_ref, first_name, last_name, phone, email, notes, created_at, updated_at
      `,
      [externalRef, null, null, params.phone || null, `Linked from ${channel} subscriber ${params.subscriber_id}`]
    );
    customer = customerResult.rows[0] || null;
  }
  
  // Fetch or create conversation
  let conversation: Conversation | null = null;
  if (customer) {
    const convResult = await pool.query(
      `
      INSERT INTO public.conversations (customer_id, channel, channel_thread_key, status, title)
      VALUES ($1, $2, $3, 'open', $4)
      ON CONFLICT (channel_thread_key) DO UPDATE
        SET customer_id = COALESCE($1, public.conversations.customer_id),
            updated_at = now(),
            last_message_at = now()
      RETURNING id, customer_id, channel, channel_thread_key, status, title, created_at, updated_at, last_message_at
      `,
      [customer.id, channel, channel_thread_key, `${channel} ${channel_thread_key}`]
    );
    conversation = convResult.rows[0] || null;
  }
  
  // Fetch recent messages
  let recentMessages: Message[] = [];
  if (conversation) {
    const msgResult = await pool.query(
      `
      SELECT id, conversation_id, direction, sender_kind, message_type, text_body, media_url, transcript, payload, created_at
      FROM public.messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT 6
      `,
      [conversation.id]
    );
    recentMessages = msgResult.rows.reverse();
  }
  
  // Fetch candidate products (all active published products)
  const productResult = await pool.query(
    `
    SELECT id, sku, slug, brand, model, title, description, condition, price_amount, currency_code, active, in_stock, delivery_days, created_at, updated_at
    FROM public.products
    WHERE active = true
    ORDER BY in_stock DESC, price_amount ASC NULLS LAST, updated_at DESC, id DESC
    LIMIT 40
    `
  );
  const candidateProducts = productResult.rows.filter((product) => !isDisallowedWorkflowProduct(product));
  
  // Fetch store settings
  const settingsResult = await pool.query(
    `SELECT value FROM public.settings WHERE key = 'store'`
  );
  const storeRoot = (settingsResult.rows[0]?.value as Record<string, unknown> | undefined) || {};
  const store: StoreSettings = {
    name: typeof storeRoot.name === "string" && storeRoot.name.trim() ? storeRoot.name.trim() : "TechnoStore Salta",
    storefront_url:
      typeof storeRoot.storefront_url === "string" && storeRoot.storefront_url.trim()
        ? storeRoot.storefront_url.trim()
        : typeof storeRoot.store_website_url === "string" && storeRoot.store_website_url.trim()
          ? storeRoot.store_website_url.trim()
          : "https://technostoresalta.com",
    ops_host:
      typeof storeRoot.ops_host === "string" && storeRoot.ops_host.trim() ? storeRoot.ops_host.trim() : "https://aldegol.com",
    address: typeof storeRoot.address === "string" && storeRoot.address.trim() ? storeRoot.address.trim() : null,
    hours: typeof storeRoot.hours === "string" && storeRoot.hours.trim() ? storeRoot.hours.trim() : null,
  };
  if (!settingsResult.rows[0]) {
    Object.assign(store, {
    name: "TechnoStore",
    storefront_url: "https://technostoresalta.com",
    ops_host: "https://aldegol.com",
      address: null,
      hours: null,
    });
  }
  
  return {
    customer,
    conversation,
    recent_messages: recentMessages,
    candidate_products: candidateProducts,
    store,
    user_message,
    channel,
    is_audio,
    raw_message,
  };
}

/**
 * Save inbound message to database
 */
export async function saveInboundMessage(params: {
  conversation_id: number;
  direction: "inbound";
  sender_kind: "customer";
  message_type: "text" | "audio" | "image" | "video" | "file" | "event";
  text_body: string | null;
  media_url: string | null;
  transcript: string | null;
  payload: Record<string, unknown>;
}): Promise<number> {
  const result = await pool.query(
    `
    INSERT INTO public.messages (
      conversation_id, direction, sender_kind, message_type, text_body, media_url, transcript, payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [
      params.conversation_id,
      params.direction,
      params.sender_kind,
      params.message_type,
      params.text_body,
      params.media_url,
      params.transcript,
      params.payload,
    ]
  );
  
  return result.rows[0]?.id;
}

/**
 * Apply state delta to customer
 */
export async function applyStateDelta(params: {
  customer_id: number;
  conversation_id: number;
  state: ValidatorOutput["final_state_delta"];
}): Promise<void> {
  const { customer_id, state } = params;
  
  // Build tags array
  const currentTagsResult = await pool.query(
    `SELECT notes FROM public.customers WHERE id = $1`,
    [customer_id]
  );
  const currentNotes = currentTagsResult.rows[0]?.notes || "";
  
  // Extract existing tags from notes (simple heuristic: lines starting with "tag:")
  const existingTags = currentNotes
    .split("\n")
    .filter((line: string) => line.startsWith("tag:"))
    .map((line: string) => line.replace("tag:", "").trim());
  
  const mergedTags = [...new Set([...existingTags, ...state.tags_to_add])]
    .filter((tag) => !state.tags_to_remove.includes(tag))
    .map((tag) => `tag:${tag}`)
    .join("\n");
  
  const leadScoreMatch = currentNotes.match(/lead_score:(\d+)/);
  const currentLeadScore = leadScoreMatch ? parseInt(leadScoreMatch[1], 10) : 0;
  const newLeadScore = Math.max(0, Math.min(100, currentLeadScore + state.lead_score_delta));
  
  const updatedNotes = [
    mergedTags,
    `lead_score:${newLeadScore}`,
    `last_intent:${state.intent_key}`,
    `funnel_stage:${state.funnel_stage}`,
    `updated_at:${new Date().toISOString()}`,
  ].join("\n");
  
  await pool.query(
    `
    UPDATE public.customers
    SET notes = $1, updated_at = now()
    WHERE id = $2
    `,
    [updatedNotes, customer_id]
  );
  
  // Log audit
  await pool.query(
    `
    INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
    VALUES ($1, $2, $3, $4, $5)
    `,
    ["tool", "state_delta_applied", "customer", String(customer_id), { state }]
  );
}

/**
 * Save bot response message
 */
export async function saveBotMessage(params: {
  conversation_id: number;
  text_body: string;
  sender_kind: "agent" | "admin" | "tool";
}): Promise<number> {
  const result = await pool.query(
    `
    INSERT INTO public.messages (
      conversation_id, direction, sender_kind, message_type, text_body, payload
    ) VALUES ($1, 'outbound', $2, 'text', $3, '{}')
    RETURNING id
    `,
    [params.conversation_id, params.sender_kind, params.text_body]
  );
  
  return result.rows[0]?.id;
}

/**
 * Check if message is the latest (debounce check)
 */
export async function checkIsLatestMessage(params: {
  channel: string;
  channel_thread_key: string;
  message_date: string;
}): Promise<boolean> {
  const result = await pool.query(
    `
    SELECT m.id, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON m.conversation_id = c.id
    WHERE c.channel = $1 AND c.channel_thread_key = $2
    ORDER BY m.created_at DESC
    LIMIT 1
    `,
    [params.channel, params.channel_thread_key]
  );
  
  if (!result.rows[0]) return true;
  
  const latestDate = new Date(result.rows[0].created_at).getTime();
  const currentDate = new Date(params.message_date).getTime();
  
  return currentDate >= latestDate;
}

/**
 * Transcribe audio using Groq Whisper
 */
export async function transcribeAudio(fileId: string, fileUrl: string): Promise<string> {
  const groqApiKey = config.GROQ_API_KEY;
  
  if (!groqApiKey) {
    throw new Error("Groq API key not configured");
  }
  
  // Download file from Telegram
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download audio file: ${fileResponse.status}`);
  }
  
  const arrayBuffer = await fileResponse.arrayBuffer();
  const blob = new Blob([arrayBuffer]);
  
  // Upload to Groq
  const formData = new FormData();
  formData.append("file", blob, "audio.ogg");
  formData.append("model", "whisper-large-v3");
  
  const groqResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
    },
    body: formData,
  });
  
  if (!groqResponse.ok) {
    const errorText = await groqResponse.text();
    throw new Error(`Groq transcription failed: ${groqResponse.status} - ${errorText}`);
  }
  
  const data = await groqResponse.json();
  return data.text || "";
}

/**
 * Process a complete conversation turn
 */
export async function processTurn(params: {
  channel: string;
  channel_thread_key: string;
  user_message: string;
  raw_message: string;
  is_audio: boolean;
  subscriber_id?: string;
  phone?: string;
  message_date: string;
}): Promise<TurnResult> {
  const { channel, channel_thread_key, user_message, raw_message, is_audio, message_date } = params;
  
  // Check if this is the latest message (debounce)
  const isLatest = await checkIsLatestMessage({
    channel,
    channel_thread_key,
    message_date,
  });
  
  if (!isLatest) {
    console.log("Skipping turn: not the latest message (debounce)");
    return {
      should_reply: false,
      reply_text: "",
      reply_messages: [],
      customer_id: null,
      conversation_id: null,
      message_id: null,
      state_applied: false,
      router_output: null,
      validator_output: null,
    };
  }
  
  // Fetch context
  const context = await fetchTurnContext({
    channel,
    channel_thread_key,
    user_message,
    raw_message,
    is_audio,
    subscriber_id: params.subscriber_id,
    phone: params.phone,
  });
  
  // Route the turn
  const routerOutput = await routeTurn(context);
  
  // Generate AI response
  const responderOutput = await generateResponse(context, routerOutput);
  
  // Validate response
  const validatorOutput = validateResponse({
    responder_output: responderOutput,
    context,
  });
  
  // Apply state delta if customer exists
  let stateApplied = false;
  if (context.customer) {
    await applyStateDelta({
      customer_id: context.customer.id,
      conversation_id: context.conversation?.id || 0,
      state: validatorOutput.final_state_delta,
    });
    stateApplied = true;
  }
  
  // Save bot message if replying
  let messageId: number | null = null;
  let shouldReply = false;
  let replyText = "";
  
  if (validatorOutput.reply_messages.length > 0) {
    replyText = validatorOutput.reply_messages[0].text;
    if (context.conversation) {
      messageId = await saveBotMessage({
        conversation_id: context.conversation.id,
        text_body: replyText,
        sender_kind: "tool",
      });
    }
    shouldReply = true;
  }
  
  return {
    should_reply: shouldReply,
    reply_text: replyText,
    reply_messages: validatorOutput.reply_messages,
    customer_id: context.customer?.id || null,
    conversation_id: context.conversation?.id || null,
    message_id: messageId,
    state_applied: stateApplied,
    router_output: routerOutput,
    validator_output: validatorOutput,
  };
}
