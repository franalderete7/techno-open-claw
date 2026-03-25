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
  patchInfoResponderWorkflow(transformed, outputFile);
  const outputPath = resolve(outputDir, outputFile);
  writeFileSync(outputPath, `${JSON.stringify(transformed, null, 2)}\n`);
  generated.push(outputPath);
}

console.log(JSON.stringify({ outputDir, generated }, null, 2));
