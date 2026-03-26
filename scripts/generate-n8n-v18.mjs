#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(rootDir, "n8n");
const outputDir = resolve(sourceDir, "v18");

const workflowNameMap = new Map([
  ["TechnoStore - AI Sales Agent v17", "TechnoStore - AI Sales Agent v18"],
  ["TechnoStore - v17 Context Builder", "TechnoStore - v18 Context Builder"],
  ["TechnoStore - v17 Router", "TechnoStore - v18 Router"],
  ["TechnoStore - v17 Info Responder", "TechnoStore - v18 Info Responder"],
  ["TechnoStore - v17 Sales Responder", "TechnoStore - v18 Sales Responder"],
  ["TechnoStore - v17 Validator", "TechnoStore - v18 Validator"],
  ["TechnoStore - v17 State Update", "TechnoStore - v18 State Update"],
]);

const stringReplacements = [
  ["TechnoStore - AI Sales Agent v17", "TechnoStore - AI Sales Agent v18"],
  ["TechnoStore - v17 Context Builder", "TechnoStore - v18 Context Builder"],
  ["TechnoStore - v17 Router", "TechnoStore - v18 Router"],
  ["TechnoStore - v17 Info Responder", "TechnoStore - v18 Info Responder"],
  ["TechnoStore - v17 Sales Responder", "TechnoStore - v18 Sales Responder"],
  ["TechnoStore - v17 Validator", "TechnoStore - v18 Validator"],
  ["TechnoStore - v17 State Update", "TechnoStore - v18 State Update"],
  ["techno-sales-v17", "techno-sales-v18"],
  ["$env.SUPABASE_URL", "$env.OPENCLAW_API_BASE_URL"],
  ["$env.SUPABASE_KEY", "$env.OPENCLAW_API_TOKEN"],
  ["workflow_version: 'v17'", "workflow_version: 'v18'"],
  ["https://puntotechno.com", "https://technostoresalta.com"],
  ["puntotechno.com", "technostoresalta.com"],
  ["puntotechno\\\\.com", "technostoresalta\\\\.com"],
  ["puntotechno\\\\\\\\.com", "technostoresalta\\\\\\\\.com"],
  ["No inventes stock, precios, cuotas, links ni modelos.", "Tratá todos los productos publicados como disponibles. No inventes precios, cuotas, links ni modelos."],
  ["Si querés, te confirmo disponibilidad y vemos cuál te conviene más.", "Si querés, te paso el link de pago o vemos cuál te conviene más."],
  ["Si querés, te confirmo disponibilidad y te digo cuál te conviene más.", "Si querés, te paso el link de pago o te digo cuál te conviene más."],
  ["responder preguntas sobre precios y disponibilidad", "responder preguntas sobre precios"],
];

function replaceAll(value) {
  let next = value;

  for (const [from, to] of stringReplacements) {
    next = next.split(from).join(to);
  }

  return next;
}

function transform(value) {
  if (typeof value === "string") {
    return replaceAll(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => transform(entry));
  }

  if (value && typeof value === "object") {
    const output = {};

    for (const [key, entryValue] of Object.entries(value)) {
      output[key] = transform(entryValue);
    }

    return output;
  }

  return value;
}

function cleanHttpHeaders(workflow) {
  for (const node of workflow.nodes ?? []) {
    if (node?.type !== "n8n-nodes-base.httpRequest") {
      continue;
    }

    const parameters = node.parameters ?? {};
    const headerBlock = parameters.headerParameters;
    const headerParameters = headerBlock?.parameters;

    if (!Array.isArray(headerParameters)) {
      continue;
    }

    const nextHeaders = headerParameters
      .filter((header) => String(header?.name || "").toLowerCase() !== "apikey")
      .map((header) => {
        if (String(header?.name || "").toLowerCase() === "authorization") {
          return {
            ...header,
            value: "=Bearer {{ $env.OPENCLAW_API_TOKEN }}",
          };
        }

        return header;
      });

    node.parameters.headerParameters = {
      ...headerBlock,
      parameters: nextHeaders,
    };
  }
}

function updateNodeJsCode(workflow, nodeName, jsCode) {
  const node = (workflow.nodes ?? []).find((entry) => entry?.name === nodeName);
  if (!node || !node.parameters) {
    return;
  }

  node.parameters.jsCode = jsCode;
}

function updateNodeJsonBody(workflow, nodeName, jsonBody) {
  const node = (workflow.nodes ?? []).find((entry) => entry?.name === nodeName);
  if (!node || !node.parameters) {
    return;
  }

  node.parameters.jsonBody = jsonBody;
}

function updateNodeExecutionFlags(workflow, nodeName, flags) {
  const node = (workflow.nodes ?? []).find((entry) => entry?.name === nodeName);
  if (!node) {
    return;
  }

  Object.assign(node, flags);
}

function patchEntryWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_entry.json") {
    return;
  }

  updateNodeJsCode(
    workflow,
    "Attach Customer Id",
    `const base = $('Merge Input').first().json || {};
const raw = $input.first().json;

const pickId = (value) => {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const candidates = [];

if (Array.isArray(raw)) {
  candidates.push(...raw);
}

if (raw && typeof raw === 'object') {
  candidates.push(raw);

  for (const key of ['body', 'data', 'result']) {
    const nested = raw[key];
    if (Array.isArray(nested)) {
      candidates.push(...nested);
    } else if (nested && typeof nested === 'object') {
      candidates.push(nested);
    }
  }
}

let customerId = null;

for (const candidate of candidates) {
  if (!candidate || typeof candidate !== 'object') continue;
  customerId = pickId(candidate.upsert_customer ?? candidate.customer_id ?? candidate.id);
  if (customerId != null) break;
}

return [{
  json: {
    ...base,
    customer_id: customerId,
  }
}];`
  );

  updateNodeJsCode(
    workflow,
    "Attach Saved Message",
    `const base = $('Attach Customer Id').first().json || {};
const raw = $input.first().json;

const pickId = (value) => {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const candidates = [];

if (Array.isArray(raw)) {
  candidates.push(...raw);
}

if (raw && typeof raw === 'object') {
  candidates.push(raw);

  for (const key of ['body', 'data', 'result']) {
    const nested = raw[key];
    if (Array.isArray(nested)) {
      candidates.push(...nested);
    } else if (nested && typeof nested === 'object') {
      candidates.push(nested);
    }
  }
}

let savedMessageId = null;

for (const candidate of candidates) {
  if (!candidate || typeof candidate !== 'object') continue;
  savedMessageId = pickId(candidate.id ?? candidate.message_id ?? candidate.saved_message_id);
  if (savedMessageId != null) break;
}

return [{
  json: {
    ...base,
    saved_message_id: savedMessageId,
  }
}];`
  );

  updateNodeJsCode(
    workflow,
    "Debounce Check",
    `const base = $('Wait 8s Debounce').first().json || {};
const rpcResult = $input.first().json;

const pickBool = (value) => value === true || value === 'true';
const pickId = (value) => {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const candidates = [];
const visit = (value) => {
  if (value == null) return;

  if (typeof value === 'string') {
    try {
      visit(JSON.parse(value));
    } catch (error) {}
    return;
  }

  if (typeof value === 'boolean') {
    candidates.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item);
    }
    return;
  }

  if (typeof value === 'object') {
    candidates.push(value);
    for (const key of ['body', 'data', 'result']) {
      visit(value[key]);
    }
  }
};

visit(rpcResult);

let isLatest = null;
let latestMessageId = null;
let checkedMessageId = pickId(base.saved_message_id);

for (const candidate of candidates) {
  if (typeof candidate === 'boolean') {
    isLatest = candidate;
    break;
  }

  if (!candidate || typeof candidate !== 'object') continue;

  if (latestMessageId == null) {
    latestMessageId = pickId(candidate.latest_message_id ?? candidate.latestMessageId);
  }

  if (checkedMessageId == null) {
    checkedMessageId = pickId(candidate.checked_message_id ?? candidate.checkedMessageId ?? candidate.message_id);
  }

  if (candidate.check_is_latest_message !== undefined) {
    isLatest = pickBool(candidate.check_is_latest_message);
    break;
  }

  if (candidate.result !== undefined && typeof candidate.result !== 'object') {
    isLatest = pickBool(candidate.result);
    break;
  }
}

if (isLatest == null && latestMessageId != null && checkedMessageId != null) {
  isLatest = latestMessageId === checkedMessageId;
}

const debounceReason =
  base.saved_message_id == null
    ? 'missing_saved_message_id'
    : base.is_empty
      ? 'empty_message'
      : isLatest == null
        ? 'rpc_shape_unknown'
        : isLatest === true
        ? 'latest'
        : 'not_latest';

return [{
  json: {
    ...base,
    should_continue: base.saved_message_id != null && isLatest === true && !base.is_empty,
    debounce_reason: debounceReason,
    rpc_is_latest: isLatest,
    rpc_latest_message_id: latestMessageId,
    rpc_checked_message_id: checkedMessageId,
  }
}];`
  );

  updateNodeJsonBody(
    workflow,
    "Save Incoming Message",
    `={{ JSON.stringify({ manychat_id: String($json.subscriber_id), customer_id: Number($json.customer_id) > 0 ? Number($json.customer_id) : null, role: "user", message: $json.user_message || "(vacío)", message_type: $json.was_audio ? "audio" : "text", was_audio: $json.was_audio || false, audio_transcription: $json.was_audio ? $json.user_message : null, intent_detected: null, products_mentioned: [], triggered_human: false, channel: "manychat", external_message_id: null, whatsapp_phone_number_id: null }) }}`
  );

  for (const nodeName of ["Upsert Customer", "Save Incoming Message", "Check Is Latest (RPC)"]) {
    updateNodeExecutionFlags(workflow, nodeName, {
      continueOnFail: false,
      alwaysOutputData: false,
    });
  }
}

function patchStateUpdateWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_state_update.json") {
    return;
  }

  updateNodeJsCode(
    workflow,
    "Build Update Payload",
    `const data = $input.first().json || {};
const parseJsonish = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return value;
  }
};
const asRecord = (value) => {
  const parsed = parseJsonish(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const asArray = (value) => {
  const parsed = parseJsonish(value);
  return Array.isArray(parsed) ? parsed : [];
};
const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'si', 'sí', 'y'].includes(normalized);
};
const extractReplyText = (messages) =>
  asArray(messages)
    .map((message) => {
      if (!message || typeof message !== 'object') return '';
      return String(message.text ?? message.reply_text ?? '').trim();
    })
    .filter(Boolean)
    .join('\\n\\n')
    .trim();

const context = asRecord(data.context);
const router = asRecord(data.router_output);
const responder = asRecord(data.responder_output);
const validator = asRecord(data.validator_output);
const state = asRecord(validator.final_state_delta);

const now = new Date().toISOString();
const currentTags = Array.isArray(context.customer?.tags) ? context.customer.tags : [];
const unique = (values) => [...new Set(values.filter(Boolean))];
const mergedTags = unique([
  ...currentTags,
  ...(Array.isArray(state.tags_to_add) ? state.tags_to_add : []),
]).filter((tag) => !(Array.isArray(state.tags_to_remove) ? state.tags_to_remove : []).includes(tag));

const currentLeadScore = Number(context.customer?.lead_score || 0);
const nextLeadScore = Math.max(0, Math.min(100, currentLeadScore + Number(state.lead_score_delta || 0)));
const selectedProductKeys = Array.isArray(validator.selected_product_keys) ? validator.selected_product_keys : [];

const updates = {
  last_bot_interaction: now,
  updated_at: now,
  last_intent: state.intent_key || null,
  funnel_stage: state.funnel_stage || null,
  lead_score: nextLeadScore,
  tags: mergedTags,
};

if (selectedProductKeys[0]) {
  updates.interested_product = selectedProductKeys[0];
}

if (state.payment_method_key) {
  updates.payment_method_last = state.payment_method_key;
}

const brandList = unique(selectedProductKeys
  .map((key) => {
    const product = (Array.isArray(context.candidate_products) ? context.candidate_products : []).find((item) => item.product_key === key);
    return product?.brand_key || null;
  })
  .filter(Boolean));

if (brandList.length > 0) {
  const currentBrands = Array.isArray(context.customer?.brands_mentioned) ? context.customer.brands_mentioned : [];
  updates.brands_mentioned = unique([...brandList, ...currentBrands]).slice(0, 10);
}

const conversationSummary = String(state.summary || router.rationale || 'Turno procesado').slice(0, 220);
const conversationInsights = unique([
  'Ruta ' + String(router.route_key || 'unknown'),
  ...selectedProductKeys.slice(0, 3).map((key) => 'Producto ' + key),
]).slice(0, 8);

const shouldPersistBotMessage = toBool(data.should_send);
const sendResult = asRecord(data.send_result);
const botMessageText = String(
  data.bot_message_text ||
    extractReplyText(data.wa_messages) ||
    extractReplyText(validator.reply_messages) ||
    responder.reply_text ||
    ''
).trim();

const botMessageRow = shouldPersistBotMessage
  ? {
      manychat_id: data.subscriber_id,
      customer_id: context.customer?.customer_id || null,
      role: 'bot',
      message: botMessageText,
      message_type: 'text',
      intent_detected: state.intent_key || null,
      products_mentioned: selectedProductKeys,
      triggered_human: false,
      was_audio: false,
      channel: 'manychat',
      external_message_id: null,
      whatsapp_phone_number_id: null,
      applied_tags: Array.isArray(state.tags_to_add) ? state.tags_to_add : [],
      payment_methods_detected: state.payment_method_key ? [state.payment_method_key] : [],
      brands_detected: brandList,
      topics_detected: [String(router.route_key || 'generic_sales')],
      funnel_stage_after: state.funnel_stage || null,
      conversation_summary: conversationSummary,
      conversation_insights: conversationInsights,
      lead_score_after: nextLeadScore,
      workflow_version: 'v18',
      route_key: router.route_key || 'generic_sales',
      send_result: sendResult,
    }
  : {
      skip_save: true,
      reason: 'reply_not_sent',
      manychat_id: data.subscriber_id,
      workflow_version: 'v18',
    };

const turnRow = {
  workflow_version: 'v18',
  provider_name: data.responder_provider_name || 'deterministic',
  model_name: data.responder_model_name || 'deterministic',
  manychat_id: data.subscriber_id,
  customer_id: context.customer?.customer_id || null,
  route_key: router.route_key || 'generic_sales',
  user_message: data.user_message || '',
  context_payload: context,
  router_payload: router,
  responder_payload: data.responder_output || {},
  validator_payload: validator,
  state_delta: state,
  selected_product_keys: selectedProductKeys,
  validation_errors: Array.isArray(validator.validation_errors) ? validator.validation_errors.map((item) => item.code || item.message).filter(Boolean) : [],
  success: toBool(data.should_send) !== false,
  failure_reason: null,
  send_result: sendResult,
};

return [{
  json: {
    ...data,
    customer_updates: updates,
    bot_message_row: botMessageRow,
    ai_turn_row: turnRow,
  }
}];`
  );

  updateNodeExecutionFlags(workflow, "Save Bot Message", {
    continueOnFail: false,
    alwaysOutputData: false,
  });
}

function patchContextBuilderWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_context_builder.json") {
    return;
  }

  updateNodeJsonBody(
    workflow,
    "Fetch Turn Context",
    `={{ JSON.stringify({ p_manychat_id: $json.subscriber_id, p_user_message: $json.user_message, p_recent_limit: 10, p_candidate_limit: 8, p_storefront_order_id: $json.storefront_order_id || null, p_storefront_order_token: $json.storefront_order_token || null }) }}`
  );

  updateNodeJsCode(
    workflow,
    "Normalize Context",
    `const base = $('Normalize Input').first().json || {};
const raw = $input.first().json || {};
const context = raw.v17_build_turn_context || raw || {};

if (!context.store || typeof context.store !== 'object') {
  context.store = {};
}

context.store.store_website_url = context.store.store_website_url || 'https://technostoresalta.com';

return [{
  json: {
    ...base,
    context,
  }
}];`
  );
}

function patchRouterWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_router.json") {
    return;
  }

  updateNodeJsCode(
    workflow,
    "Route Turn",
    `const data = $input.first().json || {};
const context = data.context || {};
const customer = context.customer || {};
const message = String(data.user_message || '').trim();
const normalized = message
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\\u0300-\\u036f]/g, '')
  .replace(/[^a-z0-9\\s]/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim();

const recentMessages = Array.isArray(context.recent_messages) ? context.recent_messages : [];
const candidateProducts = Array.isArray(context.candidate_products) ? context.candidate_products : [];
const storefrontHandoff = context.storefront_handoff;
const interestedProductKey = String(customer.interested_product || '').trim();

const unique = (values) => [...new Set(values.filter(Boolean))];
const extractBrands = (text) => {
  const brands = [];
  if (/(^| )(iphone|apple|ipad|macbook)( |$)/.test(text)) brands.push('apple');
  if (/(^| )(samsung|galaxy)( |$)/.test(text)) brands.push('samsung');
  if (/(^| )(motorola|moto)( |$)/.test(text)) brands.push('motorola');
  if (/(^| )(xiaomi)( |$)/.test(text)) brands.push('xiaomi');
  if (/(^| )(redmi)( |$)/.test(text)) brands.push('redmi');
  if (/(^| )(poco)( |$)/.test(text)) brands.push('redmi');
  if (/(^| )(google|pixel)( |$)/.test(text)) brands.push('google');
  return unique(brands);
};

const extractTier = (text) => {
  if (/(^| )(pro max|promax)( |$)/.test(text)) return 'pro_max';
  if (/(^| )(ultra)( |$)/.test(text)) return 'ultra';
  if (/(^| )(pro)( |$)/.test(text)) return 'pro';
  if (/(^| )(plus)( |$)/.test(text)) return 'plus';
  return null;
};

const brandKeys = extractBrands(normalized);
const tierKey = extractTier(normalized);
const familyMatch = normalized.match(/(?:iphone|galaxy|redmi|note|poco|moto|motorola|pixel|xiaomi)\\s+([0-9]{1,3})/i);
const familyNumber = familyMatch ? Number(familyMatch[1]) : null;
const storageMatch = normalized.match(/\\b(64|128|256|512|1024)\\b(?:\\s*gb)?\\b/);
const storageValue = storageMatch ? Number(storageMatch[1]) : null;
const modelVariantMatch = normalized.match(/\\b(?:a\\d{1,3}|s\\d{1,3}|g\\d{1,3}|x\\d{1,3}|z\\s?flip\\s?\\d|z\\s?fold\\s?\\d|edge\\s?\\d{1,3}|note\\s?\\d{1,3}|reno\\s?\\d{1,3}|find\\s?x\\d{1,2})\\b/i);
const hasModelVariantToken = Boolean(modelVariantMatch);
const asksPriceDirectly = /(precio|cuanto sale|cu[aá]nto sale|valor|costo|cotizacion|cotizaci[oó]n)/.test(normalized);
const wantsStoreInfo = /(ubicacion|direccion|sucursal|horario|abren|cierran|medios de pago|medio de pago|envio|envios|warranty|garantia|como llego|donde estan|donde quedan|retiro|mapa)/.test(normalized);
const hasConversationProductContext = Boolean(interestedProductKey || candidateProducts[0]?.product_key);
const asksProductFollowUp = /(cuotas|cuota|tarjeta|transferencia|efectivo|link de pago|pagar|pagarlo|entrega|envio|retiro|garantia|stock|disponible|color|colores|memoria|almacenamiento|ram|usd|dolar|promo|precio)/.test(normalized);
const usesRelativeReference = /(\\b(ese|esa|este|esta|mismo|misma|anterior|quiero ese|quiero esa|dame ese|dame esa)\\b|^y\\b)/.test(normalized);

const isFirstContact = recentMessages.length <= 1;
const topCandidateKeys = candidateProducts.slice(0, 3).map((product) => product.product_key).filter(Boolean);

let route_key = 'generic_sales';
let retrieval_scope = 'catalog_broad';
let search_mode = 'brand_browse';
let should_offer_store_url = isFirstContact;
let confidence = 0.72;
let rationale = 'Consulta amplia de ventas.';
let use_info_responder = false;

if (storefrontHandoff && storefrontHandoff.ok === true) {
  route_key = 'storefront_order';
  retrieval_scope = 'storefront_handoff';
  search_mode = 'storefront_handoff';
  confidence = 0.99;
  rationale = 'Se detectó un handoff de pedido web válido.';
  use_info_responder = true;
  should_offer_store_url = false;
} else if (
  hasConversationProductContext &&
  (usesRelativeReference || asksProductFollowUp) &&
  brandKeys.length === 0 &&
  familyNumber === null &&
  storageValue === null &&
  tierKey === null &&
  !hasModelVariantToken
) {
  route_key = 'exact_product_quote';
  retrieval_scope = 'catalog_narrow';
  search_mode = interestedProductKey ? 'thread_context' : 'candidate_context';
  confidence = interestedProductKey ? 0.93 : 0.86;
  rationale = 'Seguimiento sobre el producto ya conversado en el hilo.';
  should_offer_store_url = false;
} else if (brandKeys.length > 0 && (familyNumber !== null || storageValue !== null || tierKey !== null || hasModelVariantToken || asksPriceDirectly && candidateProducts.length > 0)) {
  route_key = 'exact_product_quote';
  retrieval_scope = 'catalog_narrow';
  search_mode = 'exact';
  confidence = candidateProducts.length > 0 ? 0.9 : 0.78;
  rationale = 'Consulta con marca y detalles de modelo suficientes para cotización puntual.';
  should_offer_store_url = false;
} else if (wantsStoreInfo) {
  route_key = 'store_info';
  retrieval_scope = 'store_info';
  search_mode = 'info';
  confidence = 0.9;
  rationale = 'La consulta es sobre ubicación, horarios, pagos, envíos o garantía.';
  use_info_responder = true;
  should_offer_store_url = isFirstContact;
} else if (brandKeys.length > 0 || tierKey !== null) {
  route_key = 'brand_catalog';
  retrieval_scope = 'catalog_broad';
  search_mode = tierKey ? 'tier_browse' : 'brand_browse';
  confidence = 0.82;
  rationale = 'Consulta de catálogo por marca o línea premium.';
  should_offer_store_url = true;
} else {
  route_key = 'generic_sales';
  retrieval_scope = 'catalog_broad';
  search_mode = 'brand_browse';
  confidence = 0.7;
  rationale = 'Consulta comercial amplia sin producto exacto.';
  should_offer_store_url = isFirstContact;
}

return [{
  json: {
    ...data,
    use_info_responder,
    router_output: {
      route_key,
      confidence,
      retrieval_scope,
      search_mode,
      should_offer_store_url,
      selected_candidate_product_keys: topCandidateKeys,
      rationale,
    },
  }
}];`
  );
}

function patchSalesResponderWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_sales_responder.json") {
    return;
  }

  updateNodeJsCode(
    workflow,
    "Build Sales Prompt",
    `const data = $input.first().json || {};
const context = data.context || {};
const router = data.router_output || {};
const store = context.store || {};
const website = String(store.store_website_url || 'https://technostoresalta.com').trim();
const recentMessages = Array.isArray(context.recent_messages) ? context.recent_messages : [];
const candidateProducts = Array.isArray(context.candidate_products) ? context.candidate_products : [];
const interestedProductKey = String(context.customer?.interested_product || '').trim();

const recentThread = recentMessages
  .slice(-10)
  .map((message) => ({
    role: message.role === 'bot' ? 'assistant' : 'user',
    message: String(message.message || '').trim(),
  }))
  .filter((message) => message.message);

const prioritizedCandidates = [];
if (interestedProductKey) {
  const focusedProduct = candidateProducts.find((product) => product.product_key === interestedProductKey);
  if (focusedProduct) {
    prioritizedCandidates.push(focusedProduct);
  }
}

for (const product of candidateProducts) {
  if (!prioritizedCandidates.some((entry) => entry.product_key === product.product_key)) {
    prioritizedCandidates.push(product);
  }
}

const curatedCandidates = prioritizedCandidates.slice(0, router.route_key === 'exact_product_quote' ? 4 : 5).map((product) => ({
  product_key: product.product_key,
  product_name: product.product_name,
  condition: product.condition,
  storage_gb: product.storage_gb,
  color: product.color,
  in_stock: product.in_stock,
  delivery_days: product.delivery_days,
  price_ars: product.price_ars,
  promo_price_ars: product.promo_price_ars,
  price_usd: product.price_usd,
  image_url: product.image_url,
}));

const promptPayload = {
  route_key: router.route_key,
  search_mode: router.search_mode,
  should_offer_store_url: router.should_offer_store_url === true,
  first_interaction: recentThread.length <= 1,
  focused_product_key: interestedProductKey || null,
  user_message: String(data.user_message || ''),
  recent_thread: recentThread,
  customer: context.customer || {},
  store: {
    store_location_name: store.store_location_name || 'TechnoStore Salta',
    store_address: store.store_address || '',
    store_payment_methods: store.store_payment_methods || '',
    store_shipping_policy: store.store_shipping_policy || '',
    store_warranty_new: store.store_warranty_new || '',
    store_warranty_used: store.store_warranty_used || '',
    store_website_url: website,
  },
  candidate_products: curatedCandidates,
};

const prompt = [
  'Respondé al siguiente turno comercial usando SOLO los datos provistos.',
  'Usá recent_thread y focused_product_key para sostener el contexto del hilo.',
  'Si el usuario hace referencia a "ese", "el anterior", "y en cuotas?", "y la entrega?" o similares, continuá sobre el último producto relevante del hilo.',
  'Devolvé SOLO JSON válido.',
  'Esquema esperado:',
  JSON.stringify({
    reply_text: 'string',
    selected_product_keys: ['string'],
    actions: ['attach_store_url'],
    state_delta: {
      intent_key: 'price_inquiry',
      funnel_stage: 'interested',
      lead_score_delta: 8,
      share_store_location: false,
      selected_product_keys: ['string'],
      tags_to_add: ['catalog_interest'],
      tags_to_remove: [],
      payment_method_key: null,
      summary: 'string',
    },
  }),
  'Datos del turno:',
  JSON.stringify(promptPayload, null, 2),
].join('\\n\\n');

return [{
  json: {
    ...data,
    responder_model_name: String($env.GEMINI_MODEL_SALES || 'models/gemini-2.5-flash'),
    chatInput: prompt,
  }
}];`
  );
}

function patchInfoResponderWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_info_responder.json") {
    return;
  }

  updateNodeJsCode(
    workflow,
    "Build Info Response",
    `const data = $input.first().json || {};
const context = data.context || {};
const router = data.router_output || {};
const store = context.store || {};
const website = String(store.store_website_url || 'https://technostoresalta.com').trim();
const storefrontHandoff = context.storefront_handoff || {};
const message = String(data.user_message || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\\u0300-\\u036f]/g, '')
  .replace(/[^a-z0-9\\s]/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim();

const wantsLocation = /(ubicacion|direccion|sucursal|como llego|donde estan|donde quedan|mapa)/.test(message);
const wantsHours = /(horario|abren|cierran|hora)/.test(message);
const wantsPayments = /(pago|pagos|cuotas|tarjeta|transferencia|efectivo|crypto|mercado pago|link de pago)/.test(message);
const wantsShipping = /(envio|envios|despacho|retiro)/.test(message);
const wantsWarranty = /(garantia|warranty)/.test(message);

const formatArs = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount);
};

let replyText = '';
let actions = [];
let stateDelta = {
  intent_key: 'store_info',
  funnel_stage: 'browsing',
  lead_score_delta: 2,
  share_store_location: false,
  selected_product_keys: [],
  tags_to_add: [],
  tags_to_remove: [],
  payment_method_key: null,
  summary: 'Respuesta de información general.',
};

switch (router.route_key) {
  case 'storefront_order': {
    const order = storefrontHandoff.order;
    const payment = storefrontHandoff.payment;
    const totalText = formatArs(order?.total || order?.subtotal);
    if (payment?.status === 'paid') {
      replyText = 'Tu pago ya figura aprobado para ' + (order?.title || 'tu pedido') + '. Si querés, seguimos por este chat con la coordinación de entrega o retiro.';
    } else if (payment?.url) {
      replyText = 'Perfecto, ya te preparé el link de pago para ' + (order?.title || 'tu pedido') + (totalText ? ' por ARS ' + totalText : '') + '. Pagalo acá: ' + payment.url + ' Cuando lo completes, seguí por este mismo chat.';
    } else if (payment?.message) {
      replyText = 'Tomé tu pedido web #' + (order?.id || '') + '. ' + payment.message + ' Si querés, también puedo seguir la coordinación por acá.';
    } else {
      replyText = 'Perfecto, ya tomé tu pedido web #' + (order?.id || '') + '. Seguimos por acá con la compra y la coordinación.';
    }
    stateDelta.intent_key = 'storefront_order';
    stateDelta.funnel_stage = 'closing';
    stateDelta.lead_score_delta = 10;
    stateDelta.summary = 'Seguimiento de pedido web por WhatsApp.';
    break;
  }
  case 'store_info':
  default: {
    const parts = [];
    if (wantsLocation || (!wantsHours && !wantsPayments && !wantsShipping && !wantsWarranty)) {
      if (store.store_address) parts.push('Estamos en ' + store.store_address + '.');
      stateDelta.share_store_location = wantsLocation;
    }
    if (wantsHours && store.store_hours) parts.push('Horario: ' + store.store_hours);
    if (wantsPayments && store.store_payment_methods) parts.push('Medios de pago: ' + store.store_payment_methods);
    if (wantsShipping && store.store_shipping_policy) parts.push('Envíos: ' + store.store_shipping_policy);
    if (wantsWarranty) {
      if (store.store_warranty_new) parts.push('Nuevos: ' + store.store_warranty_new);
      if (store.store_warranty_used) parts.push('Usados: ' + store.store_warranty_used);
    }
    if (router.should_offer_store_url) {
      parts.push('Si querés ver los modelos, también los tenés en ' + website + '.');
      actions = ['attach_store_url'];
    }
    parts.push('Si querés, decime qué modelo buscás y te ayudo por acá.');
    replyText = parts.join(' ');
    stateDelta.intent_key = 'store_info';
    stateDelta.funnel_stage = 'browsing';
    stateDelta.lead_score_delta = 2;
    stateDelta.summary = 'Respuesta de información general de la tienda.';
    break;
  }
}

return [{
  json: {
    ...data,
    responder_output: {
      route_key: router.route_key || 'store_info',
      reply_text: replyText,
      selected_product_keys: [],
      actions,
      state_delta: stateDelta,
    },
    responder_provider_name: 'deterministic',
    responder_model_name: 'deterministic-info',
  }
}];`
  );
}

function patchValidatorWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_validator.json") {
    return;
  }

  updateNodeJsCode(
    workflow,
    "Validate Response",
    `const data = $input.first().json || {};
const context = data.context || {};
const router = data.router_output || {};
const responder = data.responder_output || {};

const candidateProducts = Array.isArray(context.candidate_products) ? context.candidate_products : [];
const candidateMap = new Map(candidateProducts.map((product) => [product.product_key, product]));
const website = String(context.store?.store_website_url || 'https://technostoresalta.com').trim();
const storefrontPaymentUrl = String(context.storefront_handoff?.payment?.url || '').trim();

const unique = (values) => [...new Set(values.filter(Boolean))];
const allowedActions = new Set([
  'attach_store_url',
  'attach_product_images',
  'share_store_location',
  'no_reply',
]);

const stripUnexpectedUrls = (text, allowedUrls = []) =>
  String(text || '')
    .replace(/https?:\\/\\/\\S+/gi, (url) => {
      if (!allowedUrls.length) return '';
      return allowedUrls.some((allowedUrl) => url.includes(String(allowedUrl).replace(/^https?:\\/\\//, ''))) ? url : '';
    })
    .replace(/\\s+/g, ' ')
    .trim();

let selectedProductKeys = unique(Array.isArray(responder.selected_product_keys) ? responder.selected_product_keys : []).filter((key) => candidateMap.has(key));
if (router.route_key === 'exact_product_quote' && selectedProductKeys.length === 0 && candidateProducts[0]?.product_key) {
  selectedProductKeys = [candidateProducts[0].product_key];
}

const actionList = unique(Array.isArray(responder.actions) ? responder.actions : []).filter((action) => allowedActions.has(action));
const defaultIntentByRoute = {
  storefront_order: 'storefront_order',
  exact_product_quote: 'price_inquiry',
  brand_catalog: 'catalog_browse',
  generic_sales: 'greeting',
  store_info: 'store_info',
};

const defaultStageByRoute = {
  storefront_order: 'closing',
  exact_product_quote: 'interested',
  brand_catalog: 'browsing',
  generic_sales: 'browsing',
  store_info: 'browsing',
};

const stateDelta = responder.state_delta && typeof responder.state_delta === 'object' ? responder.state_delta : {};
const finalStateDelta = {
  intent_key: String(stateDelta.intent_key || defaultIntentByRoute[router.route_key] || 'unknown'),
  funnel_stage: String(stateDelta.funnel_stage || defaultStageByRoute[router.route_key] || 'browsing'),
  lead_score_delta: Number.isFinite(Number(stateDelta.lead_score_delta)) ? Number(stateDelta.lead_score_delta) : 0,
  share_store_location: stateDelta.share_store_location === true,
  selected_product_keys: unique(Array.isArray(stateDelta.selected_product_keys) ? stateDelta.selected_product_keys : []).filter((key) => candidateMap.has(key)),
  tags_to_add: unique(Array.isArray(stateDelta.tags_to_add) ? stateDelta.tags_to_add : []),
  tags_to_remove: unique(Array.isArray(stateDelta.tags_to_remove) ? stateDelta.tags_to_remove : []),
  payment_method_key: stateDelta.payment_method_key ?? null,
  summary: String(stateDelta.summary || router.rationale || 'Turno procesado').slice(0, 240),
};

if (selectedProductKeys.length > 0 && finalStateDelta.selected_product_keys.length === 0) {
  finalStateDelta.selected_product_keys = [...selectedProductKeys];
}

const allowedUrls = [];
if (['brand_catalog', 'generic_sales', 'store_info'].includes(router.route_key)) {
  allowedUrls.push(website);
}
if (router.route_key === 'storefront_order' && storefrontPaymentUrl) {
  allowedUrls.push(storefrontPaymentUrl);
}

let replyText = stripUnexpectedUrls(responder.reply_text || '', allowedUrls);
const validationErrors = [];
const validationWarnings = [];

if (!replyText) {
  validationWarnings.push({
    code: 'empty_reply_text',
    message: 'La respuesta del responder llegó vacía y se aplicó un fallback.',
    field: 'reply_text',
  });

  if (router.route_key === 'exact_product_quote' && candidateProducts[0]) {
    const product = candidateProducts[0];
    const priceArs = product.promo_price_ars || product.price_ars;
    replyText = 'Sí, tengo ' + product.product_name + '. Queda en ARS ' + priceArs + '. Si querés, te paso el link de pago o vemos cuál te conviene más.';
  } else if (router.route_key === 'storefront_order' && storefrontPaymentUrl) {
    const order = context.storefront_handoff?.order || {};
    const totalText = Number(order.total || order.subtotal);
    const formattedTotal = Number.isFinite(totalText) ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(totalText) : null;
    replyText = 'Perfecto, ya te preparé el link de pago para ' + (order.title || 'tu pedido') + (formattedTotal ? ' por ARS ' + formattedTotal : '') + '. Pagalo acá: ' + storefrontPaymentUrl + ' Cuando lo completes, seguí por este mismo chat.';
  } else if (router.route_key === 'store_info') {
    replyText = 'Sí, te ayudo por acá. Si querés mirar todo el catálogo, lo tenés en ' + website + '. ¿Qué modelo buscás?';
  } else {
    replyText = 'Sí, te ayudo por acá. Contame qué modelo o presupuesto tenés en mente y lo vemos juntos.';
  }
}

const shouldOfferStoreUrl = router.should_offer_store_url === true && ['brand_catalog', 'generic_sales', 'store_info'].includes(router.route_key);
if (shouldOfferStoreUrl && !/technostoresalta\\.com/i.test(replyText)) {
  const appendText = router.route_key === 'generic_sales'
    ? ' Si querés mirar todo el catálogo, también lo tenés en ' + website + '.'
    : ' También podés ver todo el catálogo en ' + website + '.';
  replyText = (replyText + appendText).replace(/\\s+/g, ' ').trim();
}

if (router.route_key === 'exact_product_quote') {
  replyText = replyText
    .replace(/(?:si queres|si querés)?\\s*tambien pod[eé]s ver todo el cat[aá]logo en\\s*https?:\\/\\/[^\\s]+\\.?/gi, '')
    .replace(/(?:si queres|si querés)?\\s*pod[eé]s mirar todo el cat[aá]logo en\\s*https?:\\/\\/[^\\s]+\\.?/gi, '')
    .replace(/https?:\\/\\/[^\\s]+/gi, '')
    .replace(/\\s+/g, ' ')
    .trim();
}

replyText = replyText.slice(0, 1100).trim();

const replyMessages = [{ type: 'text', text: replyText }];
const shouldSend = !actionList.includes('no_reply');

return [{
  json: {
    ...data,
    bot_message_text: replyText,
    should_send: shouldSend,
    wa_messages: replyMessages,
    validator_output: {
      approved: validationErrors.length === 0,
      reply_messages: replyMessages,
      selected_product_keys: selectedProductKeys,
      actions: actionList,
      final_state_delta: finalStateDelta,
      validation_errors: validationErrors,
      validation_warnings: validationWarnings,
      fallback_reason: validationWarnings.length > 0 ? validationWarnings[0].code : null,
    },
  }
}];`
  );
}

mkdirSync(outputDir, { recursive: true });

const files = readdirSync(sourceDir)
  .filter((file) => /^TechnoStore_v17_.*\.json$/.test(file))
  .sort();

const generated = [];

for (const file of files) {
  const inputPath = resolve(sourceDir, file);
  const raw = JSON.parse(readFileSync(inputPath, "utf8"));
  const transformed = transform(raw);

  if (workflowNameMap.has(transformed.name)) {
    transformed.name = workflowNameMap.get(transformed.name);
  }

  cleanHttpHeaders(transformed);
  const outputFile = basename(file).replace("_v17_", "_v18_");
  patchEntryWorkflow(transformed, outputFile);
  patchStateUpdateWorkflow(transformed, outputFile);
  patchContextBuilderWorkflow(transformed, outputFile);
  patchRouterWorkflow(transformed, outputFile);
  patchSalesResponderWorkflow(transformed, outputFile);
  patchInfoResponderWorkflow(transformed, outputFile);
  patchValidatorWorkflow(transformed, outputFile);
  const outputPath = resolve(outputDir, outputFile);
  writeFileSync(outputPath, `${JSON.stringify(transformed, null, 2)}\n`);
  generated.push(outputPath);
}

console.log(JSON.stringify({ outputDir, generated }, null, 2));
