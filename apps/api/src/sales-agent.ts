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

import { pool, query } from "./db.js";
import { config } from "./config.js";

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
  created_at: string;
  updated_at: string;
}

export interface StoreSettings {
  name: string;
  storefront_url: string;
  ops_host: string;
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
 * Detect product mentions from message text
 */
function detectProductMentions(text: string, products: Product[]): string[] {
  const normalized = normalizeMessageText(text);
  const mentioned: string[] = [];
  
  for (const product of products) {
    const brandNorm = normalizeMessageText(product.brand);
    const modelNorm = normalizeMessageText(product.model);
    const titleNorm = normalizeMessageText(product.title);
    
    if (normalized.includes(brandNorm) || normalized.includes(modelNorm) || normalized.includes(titleNorm)) {
      mentioned.push(`${product.brand}-${product.model}`.toLowerCase().replace(/\s+/g, "-"));
    }
  }
  
  return mentioned;
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
  const normalized = normalizeMessageText(text);
  const products = context.candidate_products;
  
  // Check for exact product quote
  const mentionedProducts = detectProductMentions(text, products);
  if (mentionedProducts.length > 0) {
    return {
      route_key: "exact_product_quote",
      confidence: 0.8,
      matched_product_keys: mentionedProducts,
      matched_brand: null,
      detected_city: detectCity(text),
      detected_budget_range: null,
      detected_payment_method: null,
    };
  }
  
  // Check for brand catalog
  for (const product of products) {
    if (normalized.includes(normalizeMessageText(product.brand))) {
      return {
        route_key: "brand_catalog",
        confidence: 0.7,
        matched_product_keys: [],
        matched_brand: product.brand,
        detected_city: detectCity(text),
        detected_budget_range: null,
        detected_payment_method: null,
      };
    }
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
 * Generate AI response using Ollama
 */
export async function generateResponse(context: TurnContext, router: RouterOutput): Promise<ResponderOutput> {
  const model = config.OLLAMA_MODEL || "qwen3.5:cloud";
  const baseUrl = config.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  
  const systemPrompt = `Eres un asistente de ventas de TechnoStore, una tienda de teléfonos móviles en Argentina.
Tu rol es ayudar a los clientes a encontrar el equipo que buscan, responder preguntas sobre precios y disponibilidad, y guiarlos hacia la compra.

Reglas:
- Sé conciso y amable
- No inventes precios o datos que no tienes
- Si no sabes algo, di que vas a consultar
- Mantén el tono profesional pero cercano
- Responde en español argentino
- Máximo 1100 caracteres por respuesta`;

  const userContext = buildPromptContext(context, router);
  
  const prompt = `${systemPrompt}

Contexto de la conversación:
${userContext}

Mensaje del cliente: "${context.user_message}"

Genera una respuesta natural y útil.`;

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
        },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }
    
    const data = await response.json();
    const rawText = (data.response as string) || "";
    
    // Extract actions from response
    const actions: string[] = [];
    if (rawText.toLowerCase().includes("https://")) {
      actions.push("attach_store_url");
    }
    if (router.route_key === "store_info") {
      actions.push("share_store_location");
    }
    
    // Determine state delta
    const intentKey = router.route_key !== "unknown" 
      ? DEFAULT_INTENT_BY_ROUTE[router.route_key] || detectIntent(context.user_message)
      : detectIntent(context.user_message);
    
    const funnelStage = DEFAULT_STAGE_BY_ROUTE[router.route_key] || detectFunnelStage(context.user_message);
    
    const leadScoreDelta = funnelStage === "closing" ? 15 : funnelStage === "interested" ? 10 : 5;
    
    return {
      selected_product_keys: router.matched_product_keys,
      actions: actions.length > 0 ? actions : [],
      state_delta: {
        intent_key: intentKey,
        funnel_stage: funnelStage,
        lead_score_delta: leadScoreDelta,
        selected_product_keys: router.matched_product_keys.length > 0 ? router.matched_product_keys : undefined,
        share_store_location: actions.includes("share_store_location"),
      },
      raw_text: rawText.trim(),
    };
  } catch (error) {
    console.error("AI response generation failed:", error);
    
    // Fallback response
    return {
      selected_product_keys: [],
      actions: [],
      state_delta: {
        intent_key: "unknown",
        funnel_stage: "browsing",
        lead_score_delta: 0,
      },
      raw_text: "Gracias por tu mensaje. Te respondo en breve con la información que necesitas.",
    };
  }
}

/**
 * Build prompt context for AI
 */
function buildPromptContext(context: TurnContext, router: RouterOutput): string {
  const lines: string[] = [];
  
  // Customer info
  if (context.customer) {
    const name = [context.customer.first_name, context.customer.last_name].filter(Boolean).join(" ") || "Cliente";
    lines.push(`Cliente: ${name}`);
  }
  
  // Recent messages
  if (context.recent_messages.length > 0) {
    lines.push("\nÚltimos mensajes:");
    for (const msg of context.recent_messages.slice(-3)) {
      const text = msg.text_body || msg.transcript || "(media)";
      lines.push(`  - ${msg.sender_kind}: ${text}`);
    }
  }
  
  // Products
  if (context.candidate_products.length > 0) {
    lines.push("\nProductos disponibles:");
    for (const p of context.candidate_products.slice(0, 5)) {
      lines.push(`  - ${p.title} ($${p.price_amount || "?"} ${p.currency_code})`);
    }
  }
  
  // Store info
  lines.push(`\nTienda: ${context.store.name}`);
  lines.push(`Web: ${context.store.storefront_url}`);
  
  // Router context
  if (router.route_key !== "unknown") {
    lines.push(`\nIntento detectado: ${router.route_key}`);
  }
  
  return lines.join("\n");
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
  const allowedUrl = context.store.storefront_url.replace(/^https?:\/\//, "");
  replyText = replyText
    .replace(/logo en\s*https?:\/\/[^\s]+\.?/gi, "")
    .replace(/https?:\/\/[^\s]+/gi, (url) => {
      if (!allowedUrl || !url.includes(allowedUrl)) {
        validationWarnings.push({
          code: "unexpected_url",
          message: `Stripped unexpected URL: ${url}`,
        });
        return "";
      }
      return url;
    })
    .replace(/\s+/g, " ")
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
  
  // Fetch candidate products (active, in stock)
  const productResult = await pool.query(
    `
    SELECT id, sku, slug, brand, model, title, description, condition, price_amount, currency_code, active, created_at, updated_at
    FROM public.products
    WHERE active = true
    ORDER BY created_at DESC
    LIMIT 8
    `
  );
  const candidateProducts = productResult.rows;
  
  // Fetch store settings
  const settingsResult = await pool.query(
    `SELECT value FROM public.settings WHERE key = 'store'`
  );
  const store: StoreSettings = settingsResult.rows[0]?.value || {
    name: "TechnoStore",
    storefront_url: "https://puntotechno.com",
    ops_host: "https://aldegol.com",
  };
  
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
