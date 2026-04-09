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
  ["Tratá todos los productos publicados como disponibles. No inventes precios, cuotas, links ni modelos.", "No inventes stock, precios, cuotas, links ni modelos."],
  ["Si querés, te confirmo disponibilidad y vemos cuál te conviene más.", "Si querés, te cuento cómo avanzar con la compra o vemos cuál te conviene más."],
  ["Si querés, te confirmo disponibilidad y te digo cuál te conviene más.", "Si querés, te cuento cómo avanzar con la compra o te digo cuál te conviene más."],
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

function updateNodeOptions(workflow, nodeName, optionChanges) {
  const node = (workflow.nodes ?? []).find((entry) => entry?.name === nodeName);
  if (!node || !node.parameters) {
    return;
  }

  node.parameters.options = {
    ...(node.parameters.options || {}),
    ...optionChanges,
  };
}

function upsertNode(workflow, nodeName, factory) {
  if (!Array.isArray(workflow.nodes)) {
    workflow.nodes = [];
  }

  const existing = workflow.nodes.find((entry) => entry?.name === nodeName);
  const nextNode = factory(existing);

  if (!existing) {
    workflow.nodes.push(nextNode);
  }
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
const pickBool = (value) => value === true || value === 'true';

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
let savedMessageDuplicate = false;

for (const candidate of candidates) {
  if (!candidate || typeof candidate !== 'object') continue;
  savedMessageId = pickId(candidate.id ?? candidate.message_id ?? candidate.saved_message_id);
  savedMessageDuplicate = pickBool(candidate.duplicate);
  if (savedMessageId != null) break;
}

return [{
  json: {
    ...base,
    saved_message_id: savedMessageId,
    saved_message_duplicate: savedMessageDuplicate,
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

const isDuplicateSavedMessage = base.saved_message_duplicate === true;
const debounceReason =
  base.saved_message_id == null
    ? 'missing_saved_message_id'
    : isDuplicateSavedMessage
      ? 'duplicate_saved_message'
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
    should_continue: base.saved_message_id != null && isLatest === true && !base.is_empty && !isDuplicateSavedMessage,
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

  upsertNode(workflow, "Claim Reply Send (RPC)", (existing) => ({
    ...(existing || {}),
    parameters: {
      method: "POST",
      url: "={{ $env.OPENCLAW_API_BASE_URL }}/rest/v1/rpc/claim_reply_send",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: "Authorization",
            value: "=Bearer {{ $env.OPENCLAW_API_TOKEN }}",
          },
          {
            name: "Content-Type",
            value: "application/json",
          },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ p_manychat_id: $json.subscriber_id, p_message_id: $json.saved_message_id || 0 }) }}",
      options: {
        timeout: 5000,
      },
    },
    id: existing?.id || "9ea6a658-d2a2-41da-a62f-claimreply0001",
    name: "Claim Reply Send (RPC)",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [4640, 120],
    continueOnFail: false,
    alwaysOutputData: false,
  }));

  upsertNode(workflow, "Reply Claimed?", (existing) => ({
    ...(existing || {}),
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: "3e14f4f0-909f-4c8c-90d2-claimreply0002",
            leftValue: "={{ $json.claim_reply_send }}",
            rightValue: true,
            operator: {
              type: "boolean",
              operation: "equals",
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    id: existing?.id || "5ad16f47-3e98-4578-b1a0-claimreply0003",
    name: "Reply Claimed?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [4920, 120],
  }));

  const prepareNode = (workflow.nodes ?? []).find((node) => node?.name === "Prepare WhatsApp Payload");
  if (prepareNode) {
    prepareNode.position = [5200, 120];
  }

  const sendNode = (workflow.nodes ?? []).find((node) => node?.name === "Send to WhatsApp");
  if (sendNode) {
    sendNode.position = [5480, 120];
  }

  const sentStateNode = (workflow.nodes ?? []).find((node) => node?.name === "Build Sent State Input");
  if (sentStateNode) {
    sentStateNode.position = [5760, 120];
  }

  workflow.connections = workflow.connections || {};
  workflow.connections["Should Send?"] = {
    main: [
      [
        {
          node: "Claim Reply Send (RPC)",
          type: "main",
          index: 0,
        },
      ],
      [
        {
          node: "Build Skipped State Input",
          type: "main",
          index: 0,
        },
      ],
    ],
  };
  workflow.connections["Claim Reply Send (RPC)"] = {
    main: [
      [
        {
          node: "Reply Claimed?",
          type: "main",
          index: 0,
        },
      ],
    ],
  };
  workflow.connections["Reply Claimed?"] = {
    main: [
      [
        {
          node: "Prepare WhatsApp Payload",
          type: "main",
          index: 0,
        },
      ],
      [
        {
          node: "Build Skipped State Input",
          type: "main",
          index: 0,
        },
      ],
    ],
  };
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

  updateNodeExecutionFlags(workflow, "Log AI Turn", {
    continueOnFail: true,
    alwaysOutputData: true,
  });

  upsertNode(workflow, "Should Save Bot Message?", (existing) => ({
    id: existing?.id ?? "92de5e1b-64fc-4dc1-a2da-1f8dfd90fa11",
    name: "Should Save Bot Message?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1060, 320],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: "f3d7fe56-c89e-4d5b-a069-efbe1f5bc3e8",
            leftValue:
              '={{ $("Build Update Payload").first().json.bot_message_row && $("Build Update Payload").first().json.bot_message_row.skip_save !== true }}',
            rightValue: true,
            operator: {
              type: "boolean",
              operation: "equals",
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
  }));

  workflow.connections = {
    "When Executed by Another Workflow": {
      main: [
        [
          {
            node: "Build Update Payload",
            type: "main",
            index: 0,
          },
        ],
      ],
    },
    "Build Update Payload": {
      main: [
        [
          {
            node: "Update Customer",
            type: "main",
            index: 0,
          },
        ],
      ],
    },
    "Update Customer": {
      main: [
        [
          {
            node: "Should Save Bot Message?",
            type: "main",
            index: 0,
          },
        ],
      ],
    },
    "Should Save Bot Message?": {
      main: [
        [
          {
            node: "Save Bot Message",
            type: "main",
            index: 0,
          },
        ],
        [
          {
            node: "Log AI Turn",
            type: "main",
            index: 0,
          },
        ],
      ],
    },
    "Save Bot Message": {
      main: [
        [
          {
            node: "Log AI Turn",
            type: "main",
            index: 0,
          },
        ],
      ],
    },
    "Log AI Turn": {
      main: [
        [
          {
            node: "Return Result",
            type: "main",
            index: 0,
          },
        ],
      ],
    },
  };
}

function patchContextBuilderWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_context_builder.json") {
    return;
  }

  updateNodeJsonBody(
    workflow,
    "Fetch Turn Context",
    `={{ JSON.stringify({ p_manychat_id: $json.subscriber_id, p_user_message: $json.user_message, p_recent_limit: 10, p_candidate_limit: 100, p_storefront_order_id: $json.storefront_order_id || null, p_storefront_order_token: $json.storefront_order_token || null }) }}`
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
  if (/(^| )(xiaomi|xaomi|xiami)( |$)/.test(text)) brands.push('xiaomi');
  if (/(^| )(redmi|rexmi|redmy)( |$)/.test(text)) brands.push('redmi');
  if (/(^| )(poco)( |$)/.test(text)) brands.push('redmi');
  if (/(^| )(google|pixel)( |$)/.test(text)) brands.push('google');
  if (/(^| )(jbl)( |$)/.test(text)) brands.push('jbl');
  return unique(brands);
};

const extractProductTypes = (text) => {
  const productTypes = [];
  if (/(^| )(tablet|tablets|tab)( |$)/.test(text)) productTypes.push('tablet');
  if (/(^| )(ipad)( |$)/.test(text)) productTypes.push('tablet');
  if (/(^| )(parlante|parlantes|speaker|speakers|bluetooth speaker)( |$)/.test(text)) productTypes.push('speaker');
  return unique(productTypes);
};

const extractTier = (text) => {
  if (/(^| )(pro max|promax)( |$)/.test(text)) return 'pro_max';
  if (/(^| )(ultra)( |$)/.test(text)) return 'ultra';
  if (/(^| )(pro)( |$)/.test(text)) return 'pro';
  if (/(^| )(plus)( |$)/.test(text)) return 'plus';
  return null;
};

const normalizeStorageValue = (rawValue) => {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  if (value >= 60 && value <= 70) return 64;
  if (value >= 118 && value <= 138) return 128;
  if (value >= 240 && value <= 270) return 256;
  if (value >= 480 && value <= 540) return 512;
  if (value >= 950 && value <= 1100) return 1024;
  return null;
};

const extractStorageValue = (text) => {
  const exactMatch = text.match(/\\b(64|128|256|512|1024)\\b(?:\\s*gb)?\\b/);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  const approximateMatch =
    text.match(/\\b(\\d{2,4})\\b(?=(?:\\s*gb)?\\s*(?:de\\s+)?(?:memo\\w*|almacen\\w*|giga\\w*|gb)\\b)/i) ||
    text.match(/(?:memo\\w*|almacen\\w*|giga\\w*|gb)\\s*(?:de\\s*)?\\b(\\d{2,4})\\b/i);

  if (!approximateMatch) {
    return null;
  }

  return normalizeStorageValue(Number(approximateMatch[1]));
};

const looksLikeAppleKey = (value) => /(iphone|apple|ipad|macbook)/.test(String(value || '').toLowerCase());

const brandKeys = extractBrands(normalized);
const productTypeKeys = extractProductTypes(normalized);
const tierKey = extractTier(normalized);
const explicitFamilyMatch = normalized.match(/(?:iphone|galaxy|redmi|rexmi|redmy|note|poco|moto|motorola|pixel|xiaomi|xaomi|xiami)\\s+([0-9]{1,3})/i);
const storageValue = extractStorageValue(normalized);
const modelVariantMatch = normalized.match(/\\b(?:a\\d{1,3}|s\\d{1,3}|g\\d{1,3}|x\\d{1,3}|z\\s?flip\\s?\\d|z\\s?fold\\s?\\d|edge\\s?\\d{1,3}|note\\s?\\d{1,3}|reno\\s?\\d{1,3}|find\\s?x\\d{1,2})\\b/i);
const hasModelVariantToken = Boolean(modelVariantMatch);
const asksPriceDirectly = /(precio|cuanto sale|cu[aá]nto sale|valor|costo|cotizacion|cotizaci[oó]n)/.test(normalized);
const asksCatalogLink = /(catalogo|cat[aá]logo|pagina|p[aá]gina|sitio|web|pasame el link|mandame el link|pasame la pagina|pasame la web|ver modelos|ver equipos|verlo aca|verlo ac[aá]|mostrame el link)/.test(normalized);
const asksComparison = /(cual de los dos|cu[aá]l de los dos|compar|versus|\\bvs\\b|mejor)/.test(normalized);
const wantsHoursInfo = /(horario|horarios|abren|cierran|hora|abierto|abierta|abiertos|abiertas|atienden|atencion|atención|abren hoy|hoy esta abierto|hoy esta abierta|hoy estan abiertos|hoy estan abiertas|feriado|feriados)/.test(normalized);
const wantsPaymentAcceptance =
  /(reciben|aceptan|toman|aceptas|recibis)/.test(normalized) &&
  /(tarjeta|naranja|macro|visa|credito|credit)/.test(normalized);
const wantsNonProductStoreAsk =
  /(plan canje|parte de pago|parte pago|permuta|permutas|toma de usado|toma de usados|\bcanje\b|mayorista|imagenes rot|sidebar)/.test(normalized);
const wantsStoreInfo =
  wantsHoursInfo ||
  wantsPaymentAcceptance ||
  wantsNonProductStoreAsk ||
  /(ubicacion|direccion|sucursal|medios de pago|medio de pago|envio|envios|warranty|garantia|como llego|donde estan|donde quedan|retiro|mapa)/.test(normalized);
const hasConversationProductContext = Boolean(interestedProductKey || candidateProducts[0]?.product_key);
const asksProductFollowUp = /(cuotas|cuota|tarjeta|transferencia|efectivo|link de pago|pagar|pagarlo|entrega|envio|retiro|garantia|stock|disponible|color|colores|memoria|almacenamiento|ram|usd|dolar|promo|precio)/.test(normalized);
const usesRelativeReference = /(\\b(ese|esa|este|esta|mismo|misma|anterior|quiero ese|quiero esa|dame ese|dame esa)\\b|^y\\b)/.test(normalized);

const customerBrandHints = Array.isArray(customer.brands_mentioned)
  ? customer.brands_mentioned.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
  : [];
const candidateBrandHints = candidateProducts
  .slice(0, 3)
  .map((product) => String(product.brand_key || '').trim().toLowerCase())
  .filter(Boolean);
const hasModelSpecificSignal = Boolean(explicitFamilyMatch || storageValue !== null || tierKey !== null || hasModelVariantToken || asksPriceDirectly);
const threadBrandHints = unique([
  ...customerBrandHints,
  looksLikeAppleKey(interestedProductKey) ? 'apple' : null,
  hasModelSpecificSignal && candidateBrandHints.length === 1 ? candidateBrandHints[0] : null,
]);
const threadBrandKey = brandKeys.length === 0 ? threadBrandHints[0] || null : null;
const standaloneAppleFamilyMatch = normalized.match(/\\b(14|15|16|17)\\b/);
const familyNumber = explicitFamilyMatch
  ? Number(explicitFamilyMatch[1])
  : (!brandKeys.length && (threadBrandKey === 'apple' || tierKey === 'pro' || tierKey === 'pro_max' || tierKey === 'plus') && standaloneAppleFamilyMatch
      ? Number(standaloneAppleFamilyMatch[1])
      : null);
const effectiveBrandKeys = brandKeys.length > 0 ? brandKeys : threadBrandKey ? [threadBrandKey] : [];

const topCandidateKeys = candidateProducts.slice(0, 3).map((product) => product.product_key).filter(Boolean);
const matchesCandidateRequest = (product) => {
  const haystack = String([
    product.brand_key || '',
    product.category || '',
    product.product_name || '',
    product.product_key || '',
    product.color || '',
    product.storage_gb != null ? String(product.storage_gb) + ' gb' : '',
  ].join(' '))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9\\s]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

  if (effectiveBrandKeys.includes('apple') && !/(iphone|apple|ipad|macbook)/.test(haystack)) {
    return false;
  }
  if (familyNumber !== null && !new RegExp('(?:^|\\\\s)' + familyNumber + '(?:\\\\s|$)').test(haystack)) {
    return false;
  }
  if (tierKey === 'pro_max' && !/\\bpro max\\b|\\bpromax\\b/.test(haystack)) {
    return false;
  }
  if (tierKey === 'ultra' && !/\\bultra\\b/.test(haystack)) {
    return false;
  }
  if (tierKey === 'pro' && !/\\bpro\\b/.test(haystack)) {
    return false;
  }
  if (tierKey === 'plus' && !/\\bplus\\b/.test(haystack)) {
    return false;
  }
  if (storageValue !== null && !new RegExp('\\\\b' + storageValue + '\\\\s*gb\\\\b').test(haystack)) {
    return false;
  }
  if (productTypeKeys.includes('tablet') && !/\\b(tablet|ipad|tab)\\b/.test(haystack)) {
    return false;
  }
  if (productTypeKeys.includes('speaker') && !/\\b(jbl|parlante|parlantes|speaker|speakers)\\b/.test(haystack)) {
    return false;
  }
  return true;
};
const hasExactNewCandidateMatch = candidateProducts.some(matchesCandidateRequest);
const hasExplicitExactIntent = effectiveBrandKeys.length > 0 && (familyNumber !== null || storageValue !== null || hasModelVariantToken || asksPriceDirectly || (brandKeys.length > 0 && tierKey !== null));
const hasContextualExactIntent = brandKeys.length === 0 && Boolean(threadBrandKey) && (familyNumber !== null || storageValue !== null || hasModelVariantToken || tierKey !== null);
const hasCategoryBrowseIntent = productTypeKeys.length > 0 && !hasExplicitExactIntent && !hasContextualExactIntent;

let route_key = 'generic_sales';
let retrieval_scope = 'catalog_broad';
let search_mode = 'brand_browse';
let should_offer_store_url = false;
let should_offer_used_iphones = false;
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
  wantsStoreInfo &&
  brandKeys.length === 0 &&
  familyNumber === null &&
  storageValue === null &&
  tierKey === null &&
  !hasModelVariantToken
) {
  route_key = 'store_info';
  retrieval_scope = 'store_info';
  search_mode = 'info';
  confidence = 0.94;
  rationale = 'La consulta es sobre horarios, ubicación, pagos, envíos o garantía de la tienda.';
  use_info_responder = true;
  should_offer_store_url = asksCatalogLink;
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
} else if (hasExplicitExactIntent || hasContextualExactIntent) {
  route_key = 'exact_product_quote';
  retrieval_scope = 'catalog_narrow';
  search_mode = asksComparison ? 'comparison' : (threadBrandKey && brandKeys.length === 0 ? 'thread_context' : 'exact');
  confidence = candidateProducts.length > 0 ? 0.9 : 0.78;
  rationale = asksComparison
    ? 'Consulta de comparación o cotización entre modelos concretos.'
    : threadBrandKey && brandKeys.length === 0
      ? 'Consulta sobre un modelo concreto usando el contexto de la conversación.'
      : 'Consulta con marca y detalles de modelo suficientes para cotización puntual.';
  should_offer_store_url = false;
} else if (wantsStoreInfo) {
  route_key = 'store_info';
  retrieval_scope = 'store_info';
  search_mode = 'info';
  confidence = 0.9;
  rationale = 'La consulta es sobre ubicación, horarios, pagos, envíos o garantía.';
  use_info_responder = true;
  should_offer_store_url = asksCatalogLink;
} else if (brandKeys.length > 0 || tierKey !== null || hasCategoryBrowseIntent) {
  route_key = 'brand_catalog';
  retrieval_scope = 'catalog_broad';
  search_mode = asksComparison ? 'comparison' : tierKey ? 'tier_browse' : hasCategoryBrowseIntent ? 'category_browse' : 'brand_browse';
  confidence = 0.82;
  rationale = asksComparison
    ? 'Consulta de comparación dentro del catálogo.'
    : hasCategoryBrowseIntent
      ? 'Consulta de catálogo por categoría de producto.'
      : 'Consulta de catálogo por marca o línea.';
  should_offer_store_url = asksCatalogLink;
} else {
  route_key = 'generic_sales';
  retrieval_scope = 'catalog_broad';
  search_mode = 'brand_browse';
  confidence = 0.7;
  rationale = 'Consulta comercial amplia sin producto exacto.';
  should_offer_store_url = asksCatalogLink;
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
      should_offer_used_iphones,
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

  const openAiNode =
    (workflow.nodes ?? []).find((entry) => entry?.name === "OpenAI Chat Model") ||
    (workflow.nodes ?? []).find((entry) => entry?.name === "Groq Chat Model") ||
    (workflow.nodes ?? []).find((entry) => entry?.name === "Google Gemini Chat Model");

  if (openAiNode) {
    openAiNode.name = "OpenAI Chat Model";
    openAiNode.type = "@n8n/n8n-nodes-langchain.lmChatOpenAi";
    openAiNode.typeVersion = 1;
    openAiNode.parameters = {
      model: '={{ $json.responder_model_name || "gpt-5.4-mini" }}',
      options: {},
    };
    openAiNode.credentials = {
      openAiApi: {
        name: "OpenAI account",
      },
    };
  }

  if (workflow.connections?.["Groq Chat Model"]) {
    workflow.connections["OpenAI Chat Model"] = workflow.connections["Groq Chat Model"];
    delete workflow.connections["Groq Chat Model"];
  }

  if (workflow.connections?.["Google Gemini Chat Model"]) {
    workflow.connections["OpenAI Chat Model"] = workflow.connections["Google Gemini Chat Model"];
    delete workflow.connections["Google Gemini Chat Model"];
  }

  updateNodeOptions(workflow, "AI Agent (Sales)", {
    systemMessage:
      "Sos el vendedor de WhatsApp de TechnoStore Salta: cercano, claro y profesional. Sin markdown, sin asteriscos. Prohibido inventar: stock, colores, precios, cuotas, montos sin interés, links, modelos o datos que no estén en el contexto (recent_thread, store, candidate_products). Si el usuario nombra un modelo concreto y está en candidate_products, respondé SOLO de ese equipo en ese turno: no ofrezcas otro modelo ni “también te paso la ficha de…” salvo que el usuario pida alternativas, comparar, “qué más tenés” o una consulta genérica de marca sin modelo. Si pide un equipo que no figura en candidate_products, decilo en una frase y ofrecé alternativas del mismo listado. Si falta un dato, aclaración corta o catálogo. Listados: un producto por bloque, orden de candidate_products. Una sola marca en la lista: no cruces con otra marca salvo que lo pidan. URLs solo si vienen en product_url. No aceptamos compras con DNI. Contado ≠ financiado. Por defecto con cuotas comunicá el monto POR CUOTA (bancarizada_cuota, macro_cuota) y cuotas_qty; no muestres bancarizada_total ni macro_total salvo que el usuario pida explícitamente total financiado o precio final en cuotas. Nunca digas que el precio se mantiene en cuotas. Cuotas presenciales típicamente hasta 6. Cerrá con UNA pregunta solo si suma; no fuerces. Guías de marca (iPhone escalera, Samsung amplio, etc.) solo cuando aplique consulta genérica. Devolvé SOLO JSON con reply_text, selected_product_keys, actions, state_delta.",
  });

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

const brandKeysInList = [
  ...new Set(candidateProducts.map((p) => String(p.brand_key || '').toLowerCase()).filter(Boolean)),
];
const singleBrandCatalog = brandKeysInList.length === 1;
const listCap = singleBrandCatalog
  ? Math.min(100, candidateProducts.length)
  : router.route_key === 'exact_product_quote'
    ? 4
    : 5;
const curatedCandidates = prioritizedCandidates.slice(0, listCap).map((product) => ({
  product_key: product.product_key,
  slug: product.slug,
  model: product.model,
  product_name: product.product_name,
  description: product.description ?? null,
  brand_key: product.brand_key,
  category: product.category || null,
  condition: product.condition,
  storage_gb: product.storage_gb,
  ram_gb: product.ram_gb ?? null,
  color: product.color,
  network: product.network ?? null,
  battery_health: product.battery_health ?? null,
  in_stock: product.in_stock,
  delivery_type: product.delivery_type ?? null,
  delivery_days: product.delivery_days,
  price_ars: product.price_ars,
  promo_price_ars: product.promo_price_ars,
  price_usd: product.price_usd,
  cuotas_qty: product.cuotas_qty ?? null,
  bancarizada_total: product.bancarizada_total ?? null,
  bancarizada_cuota: product.bancarizada_cuota ?? null,
  bancarizada_interest: product.bancarizada_interest ?? null,
  macro_total: product.macro_total ?? null,
  macro_cuota: product.macro_cuota ?? null,
  macro_interest: product.macro_interest ?? null,
  image_url: product.image_url,
  product_url: product.product_url || null,
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

const mergedThreadForNorm = recentThread
  .filter((entry) => entry.role === 'user')
  .map((entry) => String(entry.message || '').trim())
  .filter(Boolean)
  .concat([String(data.user_message || '').trim()])
  .join(' ')
  .trim();

const userNorm = String(mergedThreadForNorm || data.user_message || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\\u0300-\\u036f]/g, '')
  .replace(/[^a-z0-9\\s]/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim();

const nameHay = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const mentionsIphoneBrand = /(^| )(iphone|apple)( |$)/.test(userNorm) || /iphone/.test(userNorm);
const hasIphoneFamilyDigit = /\\b(1[1-7])\\b/.test(userNorm);
const asksIphoneCheapest = /(mas barato|más barato|barato|economico|económico|accesible|mas accesible|más accesible)/.test(userNorm);
const asksIphoneCompare1516 = /(15|16)/.test(userNorm) && /(vs|versus|entre|compar|diferencia|convine|conviene)/.test(userNorm);
const mentionsIphoneSe = /\\biphone\\s*se\\b|\\bse\\s*3\\b|\\bse\\s*2022\\b/.test(userNorm);

const appleCandidates = curatedCandidates.filter(
  (p) =>
    String(p.brand_key || '').toLowerCase() === 'apple' ||
    /iphone/.test(String(p.product_name || '').toLowerCase()),
);

const iphoneGenMatch = userNorm.match(/\\b(1[1-7])\\b/);
const iphoneGen = iphoneGenMatch ? iphoneGenMatch[1] : null;

const appleProductMatchesIphoneGen = (product, gen) => {
  if (!gen) return false;
  const h = nameHay(product.product_name);
  const g = String(gen);
  if (!h.includes(g)) return false;
  return /iphone|apple/.test(String(product.product_name || '').toLowerCase());
};

const iphoneRequestedMissingFromList =
  mentionsIphoneBrand &&
  !mentionsIphoneSe &&
  iphoneGen &&
  appleCandidates.length > 0 &&
  !appleCandidates.some((p) => appleProductMatchesIphoneGen(p, iphoneGen));

const iphoneAskedButNoAppleInList =
  mentionsIphoneBrand && !mentionsIphoneSe && appleCandidates.length === 0;

const iphoneLadderCase =
  router.route_key === 'brand_catalog' &&
  mentionsIphoneBrand &&
  !hasIphoneFamilyDigit &&
  !mentionsIphoneSe;

const wantsSamsung =
  /(^| )(samsung|galaxy)( |$)/.test(userNorm) ||
  /\\bs\\s*(2[0-9]|1[0-9])\\b/.test(userNorm) ||
  /\\bs(2[0-9]|1[0-9])\\b/.test(userNorm) ||
  /\\ba\\s*(0?[1-9]|1[0-9]|2[0-9])\\b/.test(userNorm);

const samsungCandidates = curatedCandidates.filter(
  (p) => String(p.brand_key || '').toLowerCase() === 'samsung',
);

const samsungSNask = (() => {
  const m = userNorm.match(/\\bs\\s*(2[0-9]|1[0-9])\\b/) || userNorm.match(/\\bs(2[0-9]|1[0-9])\\b/);
  return m ? m[1] : null;
})();

const samsungAask = (() => {
  const m = userNorm.match(/\\ba\\s*(0?[1-9]|1[0-9]|2[0-9])\\b/);
  return m ? m[1].replace(/^0+/, '') || m[1] : null;
})();

const samsungProductMatchesAsk = (p) => {
  const h = nameHay(p.product_name);
  if (samsungSNask && h.includes('s' + samsungSNask)) return true;
  if (samsungAask && h.includes('a' + samsungAask)) return true;
  return false;
};

const samsungRequestedMissingFromList =
  wantsSamsung &&
  samsungCandidates.length > 0 &&
  (samsungSNask || samsungAask) &&
  !samsungCandidates.some(samsungProductMatchesAsk);

const wantsXiaomiFamily =
  /(redmi|xiaomi|poco|\\bnote\\s*[0-9]{1,2}\\b|mi\\s*[0-9]{1,2}\\b)/.test(userNorm);

const xiaomiCandidates = curatedCandidates.filter((p) => {
  const b = String(p.brand_key || '').toLowerCase();
  return b === 'xiaomi' || b === 'redmi';
});

const noteGenMatch = userNorm.match(/\\bnote\\s*(1[0-9]|[0-9])\\b/);
const noteGen = noteGenMatch ? noteGenMatch[1].replace(/^0+/, '') || noteGenMatch[1] : null;

const xiaomiProductMatchesNoteAsk = (p) => {
  if (!noteGen) return false;
  const h = nameHay(p.product_name);
  return h.includes('note') && h.includes(noteGen);
};

const xiaomiNoteRequestedMissing =
  wantsXiaomiFamily &&
  xiaomiCandidates.length > 0 &&
  noteGen &&
  !xiaomiCandidates.some(xiaomiProductMatchesNoteAsk);

const wantsMotorola = /(motorola|\\bmoto\\b|moto\\s*g)/.test(userNorm);
const motorolaCandidates = curatedCandidates.filter(
  (p) => String(p.brand_key || '').toLowerCase() === 'motorola',
);

const motoGask = (() => {
  const m = userNorm.match(/\\bg\\s*([0-9]{1,3})\\b/);
  return m ? m[1] : null;
})();

const motorolaRequestedMissing =
  wantsMotorola &&
  motorolaCandidates.length > 0 &&
  motoGask &&
  !motorolaCandidates.some((p) => nameHay(p.product_name).includes('g' + motoGask));

const samsungBroadCase =
  router.route_key === 'brand_catalog' &&
  wantsSamsung &&
  samsungCandidates.length > 0 &&
  !samsungSNask &&
  !samsungAask;

const xiaomiBroadCase =
  router.route_key === 'brand_catalog' &&
  wantsXiaomiFamily &&
  xiaomiCandidates.length > 0 &&
  !noteGen;

let iphonePlaybook = '';
if (iphoneLadderCase && !iphoneAskedButNoAppleInList) {
  iphonePlaybook = [
    '--- iPhone: consulta amplia (sin número de línea 11–17 en el mensaje) ---',
    'Armá la respuesta en español rioplatense, texto plano. Sustituí [Modelo], montos y URLs solo con datos de candidate_products (promo_price_ars si existe, si no price_ars; product_url obligatorio si lo listás).',
    'Escalera de referencia 13 → 15 → 16 → 17: incluí solo modelos que existan en candidate_products, en ese orden. Por cada uno: una línea de pitch corto + "Queda en ARS …" + línea "Link: …" con product_url. Dejá una línea en blanco entre modelos.',
    'Pitchs orientativos (adaptá si el product_name no coincide; no inventes specs que contradigan la ficha):',
    'iPhone 13 — el más económico que manejamos en esa escalera; iPhone serio sin gastar de más.',
    'iPhone 15 — USB-C y cámara muy sólida; punto dulce para mucha gente.',
    'iPhone 16 — línea nueva, mejor en foto y pantalla.',
    'iPhone 17 — lo más nuevo de Apple en esa línea.',
    'Al final, UNA pregunta de cierre: prioridad precio, cámara o tamaño de pantalla (o presupuesto aproximado).',
    'Si el tono del usuario encaja, mapeá a estas plantillas (siempre ancladas a candidate_products):',
    '(A) "Más información" / "qué iPhones tienen": saludo breve + bloques 13/15/16/17 presentes + cierre con una pregunta.',
    '(B) "Cuánto sale el iPhone" sin modelo: depende de modelo y memoria; los que más suelen convenir si están en catálogo son 13, 15, 16 y 17 — pasá valores y links solo de los que figuren; ofrecé rango de presupuesto si falta.',
    '(C) "El más barato" / económico: el más accesible entre los de la escalera que vengan (suele ser 13); si también está el 15, mencioná el salto natural por USB-C y cámara.',
    '(D) Comparar 15 vs 16: si ambos están en candidate_products, contraste breve (precio vs novedad foto/pantalla) + precios + link cada uno + una pregunta cámara vs ahorro.',
    '(E) Color / memoria: solo lo que diga candidate_products; si no está, no inventes: ofrecé la variante más cercana listada o catálogo.',
    '(F) Nuevo / garantía: usá condition de candidate_products y store.store_warranty_new si existe; sin inventar políticas.',
    '(G) Catálogo / links: store.store_website_url + links directos product_url de los candidatos que menciones.',
    '(H) Cómo comprar / medios: web + link de pago por WhatsApp + transferencia al alias del link; complementá con store.store_payment_methods.',
    '(I) Cuotas: contado vs total financiado; solo cifras de candidate_products (bancarizada_*, macro_*, cuotas_qty) o aclarar en local; nunca "el precio se mantiene" en cuotas.',
    'Si el usuario nombró un número de línea (11–17) que NO está en candidate_products, aclaralo al inicio y ofrecé igual la escalera 13→15→16→17 con lo que SÍ figure, explicando en una frase por qué son alternativas razonables (precio, generación cercana, stock real).',
  ].join('\\n');
}

if (iphoneLadderCase && asksIphoneCheapest) {
  iphonePlaybook += '\\n\\n--- Refuerzo: piden lo más barato ---\\nPriorizá el iPhone 13 si está en candidate_products; si no, el más bajo precio real de la escalera presente. Mencioná salto al 15 si ambos están.';
}

if (iphoneLadderCase && asksIphoneCompare1516) {
  iphonePlaybook += '\\n\\n--- Refuerzo: comparación 15 vs 16 ---\\nUsá plantilla (D) solo si ambos modelos están en candidate_products; si falta uno, listá el disponible y ofrecé alternativa sin inventar el faltante.';
}

let iphoneSubstitutePlaybook = '';
if (iphoneRequestedMissingFromList || iphoneAskedButNoAppleInList) {
  iphoneSubstitutePlaybook = [
    '--- iPhone: pidieron un modelo que no figura en candidate_products (o no hay iPhones en esta lista) ---',
    'Primero una frase honesta: el equipo pedido no está en la lista de este turno (no inventes llegadas ni reservas).',
    'Si hay otros iPhone en candidate_products: armá la escalera 13 → 15 → 16 → 17 solo con los que existan; por cada uno pitch breve + ARS + Link. Explicá en una o dos frases por qué son buen plan B (misma experiencia Apple, otro precio, generación cercana).',
    'Si no hay ningún iPhone en candidate_products: dirigí a store.store_website_url para ver Apple; si en candidate_products hay Android de gama similar, podés mencionar hasta 2 como opción alternativa, sin menospreciar iPhone.',
    'Cerrá con UNA pregunta (presupuesto, prioridad foto/pantalla, o memoria).',
  ].join('\\n');
}

let samsungPlaybook = '';
if (samsungRequestedMissingFromList || samsungBroadCase) {
  samsungPlaybook = [
    '--- Samsung (consultas frecuentes tipo Galaxy S / Ultra / FE / A) ---',
    'Solo usá modelos que estén en candidate_products. Texto plano, un bloque por equipo, línea en blanco entre modelos, ARS + Link cuando listés.',
    samsungRequestedMissingFromList
      ? 'El usuario pidió una referencia (S o A con número) que no aparece en candidate_products: decilo sin dramatismo y ofrecé hasta 4 alternativas Samsung del listado (priorizá misma familia: si buscaban Ultra y hay otro Ultra; si buscaban A y hay otro A; si no, el S más cercano en precio o el tope de lista).'
      : 'Consulta amplia Samsung: orden sugerido si hay varios en lista — tope de gama (S Ultra o similar) primero si está, luego S “equilibrio” / FE si hay, luego línea A para precio; solo mencioná lo que exista.',
    'Pitchs orientativos (adaptá al product_name real): Ultra — tope de cámara y pantalla; FE — buen equilibrio precio/rendimiento; A — entrada fuerte al ecosistema Samsung.',
    'Si solo hay un candidato Samsung y el usuario ya nombró un modelo concreto que está en la lista, NO agregues otro modelo ni “opción superior”: desarrollá solo ese pedido.',
    'Cerrá con una pregunta solo si la consulta era amplia; si el usuario pidió un modelo puntual, no metas otro equipo en el cierre.',
  ].join('\\n');
}

let xiaomiPlaybook = '';
if (xiaomiNoteRequestedMissing || xiaomiBroadCase) {
  xiaomiPlaybook = [
    '--- Redmi / Xiaomi / Note (consultas frecuentes en chat) ---',
    'Solo candidate_products. Si pidieron un Note o Redmi numerado que no está en la lista, decilo y ofrecé hasta 4 alternativas Xiaomi/Redmi del listado ordenadas por precio (o por “más nuevo” si el nombre lo muestra).',
    'Consulta amplia sin número: resumí la gama que SÍ viene en candidate_products — por ejemplo Note vs número, o Xiaomi número — sin inventar modelos.',
    'Tono: accesibilidad y buena relación precio; una pregunta de cierre (presupuesto o uso: juego, foto, batería).',
  ].join('\\n');
}

let motorolaPlaybook = '';
if (
  wantsMotorola &&
  (motorolaRequestedMissing || (router.route_key === 'brand_catalog' && motorolaCandidates.length > 0))
) {
  motorolaPlaybook = [
    '--- Motorola / Moto G ---',
    motorolaRequestedMissing
      ? 'El Moto G o referencia pedida no figura en candidate_products: decilo y ofrecé hasta 3 Motorola del listado con ARS y link, explicando brevemente diferencia de gama.'
      : 'Listá los Motorola presentes en candidate_products con pitch breve de batería/software limpio si encaja; ARS + link; una pregunta de cierre.',
  ].join('\\n');
}

const promptParts = [
  'Respondé al siguiente turno comercial usando SOLO los datos provistos.',
  '**Modelo puntual (ej. Galaxy A26, S25 Ultra, iPhone 15, Redmi Note 13):** si el mensaje nombra un modelo concreto y ese equipo está en candidate_products, el reply debe hablar SOLO de ese producto: disponibilidad, contado, cuotas (ver reglas de cuota abajo), link si corresponde. PROHIBIDO en el mismo mensaje ofrecer “también la ficha del…”, “opción superior”, otro Samsung/iPhone, o upsell, salvo que el usuario haya pedido explícitamente alternativas, comparar, “qué más tenés”, “qué gama”, o venga solo la marca sin modelo (ej. “qué Samsung tienen”).',
  'Usá recent_thread y focused_product_key para sostener el contexto del hilo.',
  'Si el usuario hace referencia a "ese", "el anterior", "y en cuotas?", "y la entrega?" o similares, continuá sobre el último producto relevante del hilo.',
  'Si el usuario nombra un modelo concreto y ese equipo (o esa variante memoria/color) no está en candidate_products, decilo en una frase y ofrecé de inmediato alternativas reales del mismo listado: priorizá misma marca y precio cercano; si no hay de la marca, explicá brevemente por qué otra opción del listado podría servir. Tono consultivo, sin presión. Si candidate_products está vacío, usá store.store_website_url sin inventar SKUs.',
  'Si en candidate_products hay un modelo de la misma marca y misma gama (por ejemplo otra generación S Ultra o otra memoria) que sirve como reemplazo, presentalo como alternativa real: no digas que el producto pedido "no figura en el catálogo de este turno" si ya estás ofreciendo un equipo sustituto que sí está en la lista. Reservá "no figura en este turno" para cuando no haya ningún sustituto razonable en candidate_products.',
  'Formateá todos los precios en ARS con separadores argentinos, por ejemplo ARS 1.165.080.',
  'Contado: usá promo_price_ars si viene; si no, price_ars. Eso NO es el total en cuotas.',
  'Cuotas presenciales en sucursal: solo lo que permita este negocio por datos del producto — típicamente hasta 6 cuotas (cuotas_qty) con financiación bancarizada o Macro. Si el usuario pide 8, 12, 18 cuotas o más, aclarar que por acá la referencia es hasta 6 cuotas presenciales con esos medios, no inventes otros plazos.',
  'PROHIBIDO decir que "el precio se mantiene" o que en cuotas queda igual que de contado. **Por defecto** (salvo que el usuario pida explícitamente total a pagar, “cuánto sale financiado en total”, “precio final en cuotas”): comunicá la financiación como **N cuotas de ARS X** usando bancarizada_cuota y macro_cuota (y cuotas_qty). No cites bancarizada_total ni macro_total en la respuesta rutinaria: esos totales solo si el usuario pidió ver el total financiado. Si solo tenés totales y no cuota en datos, decí contado y que en sucursal le confirman la cuota.',
  'No calcules cuota dividiendo el precio de contado. No digas sin interés ni promos bancarias inventadas.',
  'Si el usuario nombra un banco o tarjeta concreta (ej. Visa ICBC): no inventes tasa ni cuota por banco; si hay datos bancarizada_* o macro_* en candidate_products para ese equipo, usalos como referencia general; si no, decí que el detalle lo confirman al pagar.',
  'Complementá con store.store_payment_methods solo para el relato de medios (Naranja, Macro, bancarizadas); no contradigas cuotas_qty ni los montos de candidate_products.',
  'No inventes disponibilidad, colores ni stock. Si el dato no está respaldado por candidate_products, decí que te lo consulten por catálogo o pedí una aclaración breve.',
  'Si listás productos, hacelo con un producto por línea y texto plano, sin markdown ni **. Cuando compartas varios modelos, dejá una línea en blanco entre uno y otro.',
  'Si candidate_products trae un solo brand_key (toda la lista es la misma marca), quedate en esa marca: no ofrezcas iPhone u otras marcas salvo que el usuario pida explícitamente otra marca o una comparación.',
  'candidate_products es la única fuente de verdad para productos. No menciones marcas, categorías, modelos o precios que no estén ahí.',
  'Plazos en cuotas: usá solo cuotas_qty y los montos bancarizada_* / macro_* del producto. Si cuotas_qty es 6, no hables de 12 cuotas como si fueran el plan de referencia; corregí al dato del producto.',
  'Si la consulta es amplia como "catálogo", "lista de precios" o "modelos", primero intentá acotarla por marca o categoría. Si candidate_products ya viene claramente filtrado, podés listar esos resultados sin inventar otros. Si candidate_products trae iPhone priorizados, respetá ese orden exacto.',
  'Los productos pueden incluir celulares, tablets y parlantes JBL.',
  'Plan canje, parte de pago, permuta, toma de usado o crédito personal: respondé claro que no lo aceptamos. No ofrezcas excepción, evaluación ni cotización del usado.',
  'Compra mayorista: no inventes condiciones ni precios especiales; decí que la confirma el equipo comercial.',
  'Consolas, notebooks u otros rubros que no estén en candidate_products: no inventes stock ni precios; decí que en el catálogo de este turno no figuran y ofrecé ver la web o consultar otro modelo que sí aparezca.',
  'Comparaciones técnicas (cámara, batería, rendimiento): no inventes benchmarks ni specs; solo contrastá si el contexto trae datos; si no, orientá a la ficha del producto en el link.',
  'Solo usá product_url si ya viene en candidate_products. No inventes links. En este negocio los iPhone usan /iphone/{sku} y el resto usa /{sku}, pero preferí siempre el product_url provisto.',
  'No prometas ni ofrezcas un link de pago directo en una consulta normal de producto. Solo mencioná un link real si ya existe en el contexto del pedido web. Si no, explicá el proceso para avanzar con la compra.',
  'Si preguntan por pago, link de pago, transferencia o cómo comprar, explicá que en technostoresalta.com avanzan en pocos clics, reciben el link de pago por WhatsApp y pagan transfiriendo al alias que figura en ese link. La entrega o el retiro se coordinan por este mismo chat. No aceptamos compras con DNI.',
];

if (iphonePlaybook) {
  promptParts.push(iphonePlaybook);
}

if (iphoneSubstitutePlaybook) {
  promptParts.push(iphoneSubstitutePlaybook);
}

if (samsungPlaybook) {
  promptParts.push(samsungPlaybook);
}

if (xiaomiPlaybook) {
  promptParts.push(xiaomiPlaybook);
}

if (motorolaPlaybook) {
  promptParts.push(motorolaPlaybook);
}

promptParts.push(
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
);

const prompt = promptParts.join('\\n\\n');

return [{
  json: {
    ...data,
    responder_model_name: String($env.OPENAI_MODEL_SALES || 'gpt-5.4-mini'),
    chatInput: prompt,
  }
}];`
  );

  updateNodeJsCode(
    workflow,
    "Normalize Sales Response",
    `const base = $('Build Sales Prompt').first().json || {};
const raw = $input.first().json || {};

const fallbackExactCandidate = Array.isArray(base.context?.candidate_products) ? base.context.candidate_products[0] : null;
const rawText = String(raw.output || raw.text || '').trim();
const normalizedUserMessage = String(base.user_message || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\\u0300-\\u036f]/g, '')
  .replace(/[^a-z0-9\\s]/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim();
const asksBuyingStep = /(pago|pagar|comprar|compra|link de pago|transferencia|cuotas|envio|retiro|como compro|como comprar|senia|seña)/.test(normalizedUserMessage);

let parsed = null;
try {
  parsed = JSON.parse(rawText);
} catch (error) {
  const match = rawText.match(/\\{[\\s\\S]*\\}/);
  if (match) {
    try {
      parsed = JSON.parse(match[0]);
    } catch (innerError) {
      parsed = null;
    }
  }
}

const formatArs = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount);
};
const stripMarkdownArtifacts = (value) =>
  String(value || '')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\`([^\`]+)\`/g, '$1')
    .replace(/\\*([^*\\n]+)\\*/g, '$1')
    .replace(/_([^_\\n]+)_/g, '$1');
const normalizeReplySpacing = (value) =>
  stripMarkdownArtifacts(String(value || ''))
    .replace(/\\r\\n/g, '\\n')
    .replace(/[ \\t]+\\n/g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .replace(/[ \\t]{2,}/g, ' ')
    .trim();
const hasPositiveAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
};
const stripInstallmentMentions = (value) =>
  normalizeReplySpacing(
    String(value || '')
      .replace(/(?:^|[.!?]\\s+|\\n+)[^.!?\\n]*\\b(?:cuota|cuotas|financi|bancarizada|macro|sin inter[eé]s)\\b[^.!?\\n]*[.!?]?/gi, ' ')
      .replace(/\\n\\s*\\n/g, '\\n')
  );
const buildInstallmentSnippet = (product, includeTotals = false) => {
  const cuotasQty = Number(product?.cuotas_qty);
  if (!Number.isFinite(cuotasQty) || cuotasQty < 2) {
    return null;
  }

  const options = [];

  if (hasPositiveAmount(product?.bancarizada_cuota)) {
    let line = cuotasQty + ' cuotas de ARS ' + formatArs(product.bancarizada_cuota) + ' con bancarizadas';
    if (includeTotals && hasPositiveAmount(product?.bancarizada_total)) {
      line += ' (total ARS ' + formatArs(product.bancarizada_total) + ')';
    }
    options.push(line);
  }

  if (hasPositiveAmount(product?.macro_cuota)) {
    let line = cuotasQty + ' cuotas de ARS ' + formatArs(product.macro_cuota) + ' con Macro';
    if (includeTotals && hasPositiveAmount(product?.macro_total)) {
      line += ' (total ARS ' + formatArs(product.macro_total) + ')';
    }
    options.push(line);
  }

  return options.length > 0 ? options.join(' o ') : null;
};
const inferCatalogFamilyNumber = (product) => {
  const haystack = String([
    product?.brand_key || '',
    product?.category || '',
    product?.product_name || '',
    product?.product_key || '',
  ].join(' '))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9\\s]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

  const familyMatch = haystack.match(/(?:iphone|galaxy|redmi|note|poco|moto|motorola|pixel|xiaomi)\\s+([0-9]{1,3})/i);
  if (familyMatch) {
    return Number(familyMatch[1]);
  }

  const standaloneAppleMatch = haystack.match(/\\b(13|15|16|17)\\b/);
  return standaloneAppleMatch ? Number(standaloneAppleMatch[1]) : null;
};
const productPublicPrice = (product) => {
  const promoPrice = Number(product?.promo_price_ars);
  if (Number.isFinite(promoPrice) && promoPrice > 0) {
    return promoPrice;
  }

  const price = Number(product?.price_ars);
  if (Number.isFinite(price) && price > 0) {
    return price;
  }

  return Number.POSITIVE_INFINITY;
};
const compareCatalogCandidates = (left, right) => {
  if (Number(right?.in_stock) !== Number(left?.in_stock)) {
    return Number(right?.in_stock) - Number(left?.in_stock);
  }

  const leftPrice = productPublicPrice(left);
  const rightPrice = productPublicPrice(right);
  if (leftPrice !== rightPrice) {
    return leftPrice - rightPrice;
  }

  return String(left?.product_name || '').localeCompare(String(right?.product_name || ''), 'es');
};
const formatCatalogPrice = (product) => {
  const formatted = formatArs(product?.promo_price_ars ?? product?.price_ars);
  return formatted ? 'ARS ' + formatted : 'Consultar precio';
};
const formatCatalogAvailability = (product) => {
  if (product?.in_stock) {
    return 'Disponible';
  }
  if (Number(product?.delivery_days) > 0) {
    return 'Entrega estimada en ' + Number(product.delivery_days) + ' días';
  }
  return 'Consultar disponibilidad';
};
const buildAggressiveIphoneReply = (products) => {
  const appleProducts = products
    .filter((product) => String(product?.brand_key || '').trim().toLowerCase() === 'apple')
    .sort(compareCatalogCandidates);
  if (appleProducts.length === 0) {
    return null;
  }

  const preferredFamilies = [13, 15, 16, 17];
  const selectedByFamily = [];
  const selectedKeys = new Set();

  for (const family of preferredFamilies) {
    const familyCandidate = appleProducts.find(
      (product) => !selectedKeys.has(String(product?.product_key || '')) && inferCatalogFamilyNumber(product) === family
    );
    if (!familyCandidate) {
      continue;
    }

    selectedByFamily.push(familyCandidate);
    selectedKeys.add(String(familyCandidate.product_key || ''));
  }

  const remainderProducts = appleProducts.filter(
    (product) => !selectedKeys.has(String(product?.product_key || ''))
  );
  const selectedProducts = [...selectedByFamily, ...remainderProducts].slice(0, 4);
  if (selectedProducts.length === 0) {
    return null;
  }

  const lines = ['Te paso los iPhone más convenientes que estamos moviendo hoy:', ''];
  selectedProducts.forEach((product, index) => {
    lines.push(String(index + 1) + '. ' + String(product.product_name || 'iPhone'));
    lines.push('Precio: ' + formatCatalogPrice(product));
    lines.push('Estado: ' + formatCatalogAvailability(product));
    if (product?.product_url) {
      lines.push('Link: ' + String(product.product_url).trim());
    }
    lines.push('');
  });
  lines.push('Si querés, te lo filtro por Pro, Pro Max, memoria o presupuesto.');

  return {
    replyText: normalizeReplySpacing(lines.join('\\n')),
    selectedProductKeys: selectedProducts.map((product) => String(product.product_key || '')).filter(Boolean),
    summary:
      'Se mostraron ' +
      String(selectedProducts.length) +
      ' modelos iPhone priorizados: ' +
      selectedProducts.map((product) => String(product.product_name || 'iPhone')).join(', ') +
      '.',
  };
};
const hasSpecificModelSignal = /(?:iphone|galaxy|redmi|note|poco|moto|motorola|pixel|xiaomi)\\s+[0-9]{1,3}|\\b(64|128|256|512|1024)\\b(?:\\s*gb)?|\\bpro max\\b|\\bpromax\\b|\\bultra\\b|\\bpro\\b|\\bplus\\b|\\b(?:a\\d{1,3}|s\\d{1,3}|g\\d{1,3}|x\\d{1,3}|z\\s?flip\\s?\\d|z\\s?fold\\s?\\d|edge\\s?\\d{1,3}|note\\s?\\d{1,3}|reno\\s?\\d{1,3}|find\\s?x\\d{1,2})\\b/i.test(normalizedUserMessage);
const asksBroadIphoneCatalog =
  base.router_output?.route_key === 'brand_catalog' &&
  /\\b(iphone|apple)\\b/.test(normalizedUserMessage) &&
  !hasSpecificModelSignal;

const fallbackReply = (() => {
  if (base.router_output?.route_key === 'exact_product_quote' && fallbackExactCandidate) {
    const priceArs = formatArs(fallbackExactCandidate.promo_price_ars || fallbackExactCandidate.price_ars);
    return 'Sí, tengo ' + fallbackExactCandidate.product_name + '. Queda en ARS ' + priceArs + '. Si querés, te cuento cómo avanzar con la compra o vemos si es el modelo que más te conviene.';
  }
  return 'Sí, te ayudo por acá. Si querés también podés mirar todo el catálogo en https://technostoresalta.com. ¿Qué modelo o presupuesto tenés en mente?';
})();

let selectedProductKeys = Array.isArray(parsed?.selected_product_keys) ? parsed.selected_product_keys : [];
let actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
const stateDelta = parsed?.state_delta && typeof parsed.state_delta === 'object' ? parsed.state_delta : {};
let replyText = normalizeReplySpacing(parsed?.reply_text || fallbackReply);

const priceCandidates = Array.isArray(base.context?.candidate_products) ? base.context.candidate_products : [];
const findCandidateByKey = (productKey) =>
  priceCandidates.find((product) => String(product?.product_key || '') === String(productKey || ''));
for (const product of priceCandidates) {
  for (const rawPrice of [product?.promo_price_ars, product?.price_ars]) {
    const numericPrice = Number(rawPrice);
    const formattedPrice = formatArs(numericPrice);
    if (!Number.isFinite(numericPrice) || !formattedPrice) continue;
    const rawString = String(Math.trunc(numericPrice));
    replyText = replyText
      .replace(new RegExp(\`ARS\\\\s*\${rawString}(?!\\\\d)\`, 'g'), \`ARS \${formattedPrice}\`)
      .replace(new RegExp(\`\\\\$\\\\s*\${rawString}(?!\\\\d)\`, 'g'), \`ARS \${formattedPrice}\`)
      .replace(new RegExp(\`(?<!\\\\d)\${rawString}(?!\\\\d)\`, 'g'), formattedPrice);
  }
}

if (asksBroadIphoneCatalog) {
  const iphoneCatalogReply = buildAggressiveIphoneReply(priceCandidates);
  if (iphoneCatalogReply) {
    replyText = iphoneCatalogReply.replyText;
    selectedProductKeys = iphoneCatalogReply.selectedProductKeys;
    if (selectedProductKeys.length > 0) {
      stateDelta.selected_product_keys = selectedProductKeys;
    }
    stateDelta.summary = iphoneCatalogReply.summary;
  }
}

if (base.router_output?.route_key === 'exact_product_quote') {
  replyText = replyText.replace(
    /Si quer[eé]s,\\s*te paso el link de pago[^.]*\\.?/gi,
    'Si querés, te cuento cómo avanzar con la compra.'
  );

  if (!asksBuyingStep) {
    replyText = replyText
      .replace(/Para avanzar con la compra[^.]*\\.?/gi, '')
      .replace(/Pod[eé]s iniciar la compra[^.]*\\.?/gi, '')
      .replace(/Si prefer[ií]s avanzar online[^.]*\\.?/gi, '')
      .trim();
  }
}

const asksFinancingIntent = /(cuota|cuotas|financi|tarjeta|bancarizada|macro|medio[s]? de pago|sin inter)/i.test(normalizedUserMessage);
const asksTotalFinanced = /(total financiado|total en cuotas|precio final en cuotas|cu[aá]nto sale financiado en total)/i.test(normalizedUserMessage);
const primaryFinancingProduct =
  selectedProductKeys.map(findCandidateByKey).find(Boolean) ||
  (base.router_output?.route_key === 'exact_product_quote' ? fallbackExactCandidate : (priceCandidates.length === 1 ? priceCandidates[0] : null));

if (asksFinancingIntent && primaryFinancingProduct) {
  const installmentSnippet = buildInstallmentSnippet(primaryFinancingProduct, asksTotalFinanced);
  if (installmentSnippet) {
    const cleanedReply = stripInstallmentMentions(replyText);
    const prefix = cleanedReply ? (/[.!?]$/.test(cleanedReply) ? ' ' : '. ') : '';
    replyText = normalizeReplySpacing(cleanedReply + prefix + 'Cuotas presenciales: ' + installmentSnippet + '.');
  }
} else if (!asksFinancingIntent) {
  replyText = stripInstallmentMentions(replyText);
}

return [{
  json: {
    ...base,
    responder_output: {
      route_key: base.router_output?.route_key || 'generic_sales',
      reply_text: replyText,
      selected_product_keys: selectedProductKeys,
      actions,
      state_delta: stateDelta,
    },
    responder_provider_name: 'openai',
    responder_model_name: base.responder_model_name || 'gpt-5.4-mini',
    responder_raw_text: rawText,
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
const wantsHours = /(horario|horarios|abren|cierran|hora|abierto|abierta|abiertos|abiertas|atienden|atencion|atención|abren hoy|hoy esta abierto|hoy esta abierta|hoy estan abiertos|hoy estan abiertas|feriado|feriados)/.test(message);
const asksHolidayHours = /(feriado|feriados)/.test(message);
const wantsPayments =
  /(pago|pagos|cuotas|tarjeta|transferencia|efectivo|crypto|mercado pago|link de pago|naranja|macro|credito personal|credito con dni)/.test(message);
const wantsShipping = /(envio|envios|despacho|retiro)/.test(message);
const wantsWarranty = /(garantia|warranty)/.test(message);
const wantsTradeHelp = /(plan canje|parte de pago|parte pago|permuta|permutas|toma de usado|toma de usados|\bcanje\b)/.test(message);
const wantsWholesale = /mayorista/.test(message);
const wantsWebsiteIssue =
  /(imagen rota|imagenes rotas|imagenes rot|sidebar|web rota|sitio roto|error en la web|no carga la web)/.test(message);
const asksCatalogLink = /(catalogo|cat[aá]logo|pagina|p[aá]gina|sitio|web|ver modelos|ver equipos)/.test(message);

const formatArs = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount);
};

const paymentProcess =
  'Si decidís avanzar, te armamos el link de pago por WhatsApp y pagás transfiriendo al alias que aparece ahí. No aceptamos compras con DNI. Después coordinamos la entrega o el retiro por este mismo chat.';

const order = storefrontHandoff.order || {};
const payment = storefrontHandoff.payment || {};
const selectedProductKeys = order?.product_key ? [String(order.product_key)] : [];
const isStorefrontOrigin = order?.checkout_channel === 'storefront' && Number(order?.id || 0) > 0;
const orderLabel = isStorefrontOrigin ? 'pedido web #' + order.id : 'pedido';

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
    const totalText = formatArs(order?.total || order?.subtotal);
    if (payment?.status === 'paid') {
      replyText = 'Tu pago ya figura aprobado para ' + (order?.title || 'tu pedido') + '. Si querés, seguimos por este chat con la coordinación de entrega o retiro.';
    } else if (payment?.url) {
      replyText = 'Perfecto, ya te preparé el link de pago para ' + (order?.title || 'tu pedido') + (totalText ? ' por ARS ' + totalText : '') + '. Pagalo acá: ' + payment.url + ' Transferís al alias que aparece en el link y después seguimos por este mismo chat para coordinar la entrega o el retiro.';
    } else if (payment?.message) {
      replyText = (Number(order?.id || 0) > 0 ? 'Tomé tu ' + orderLabel + '. ' : '') + payment.message + ' Si querés, también puedo seguir la coordinación por acá.';
    } else {
      replyText = Number(order?.id || 0) > 0
        ? 'Perfecto, ya tomé tu ' + orderLabel + '. Seguimos por acá con la compra y la coordinación.'
        : 'Perfecto, seguimos por acá con la compra y la coordinación.';
    }
    stateDelta.intent_key = 'storefront_order';
    stateDelta.funnel_stage = 'closing';
    stateDelta.lead_score_delta = 10;
    stateDelta.selected_product_keys = selectedProductKeys;
    stateDelta.summary = 'Seguimiento de pedido con link de pago por WhatsApp.';
    break;
  }
  case 'store_info':
  default: {
    const parts = [];
    if (wantsLocation || (!wantsHours && !wantsPayments && !wantsShipping && !wantsWarranty)) {
      if (store.store_address) parts.push('Estamos en ' + store.store_address + '.');
      stateDelta.share_store_location = wantsLocation;
    }
    if (asksHolidayHours) parts.push('En feriados seguimos atendiendo normalmente.');
    if (wantsHours && store.store_hours) parts.push((asksHolidayHours ? 'Horario habitual: ' : 'Hoy estamos atendiendo. Horario: ') + store.store_hours);
    if (wantsPayments) {
      if (store.store_payment_methods) parts.push('Medios de pago: ' + store.store_payment_methods + '.');
      parts.push(paymentProcess);
    }
    if (wantsShipping && store.store_shipping_policy) parts.push('Envíos: ' + store.store_shipping_policy);
    if (wantsWarranty) {
      if (store.store_warranty_new) parts.push('Nuevos: ' + store.store_warranty_new);
      if (store.store_warranty_used) parts.push('Usados: ' + store.store_warranty_used);
    }
    if (wantsTradeHelp) {
      parts.push(
        'No aceptamos plan canje, permutas, parte de pago ni toma de usados.',
      );
    }
    if (wantsWholesale) {
      parts.push(
        'Consultas mayoristas o por volumen las confirma el equipo comercial; decinos cantidad y modelos y lo vemos.',
      );
    }
    if (wantsWebsiteIssue) {
      parts.push(
        'Gracias por el aviso sobre la web: lo pasamos para revisión. Mientras tanto podés consultar modelos y precios por acá.',
      );
    }
    if (router.should_offer_store_url && asksCatalogLink) {
      parts.push('El catálogo está en ' + website + '.');
      actions = ['attach_store_url'];
    }
    if (parts.length === 0) {
      parts.push('Sí, te ayudo por acá. Decime qué modelo buscás y te paso precio y disponibilidad.');
    }
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
      selected_product_keys: selectedProductKeys,
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
const recentMessages = Array.isArray(context.recent_messages) ? context.recent_messages : [];
const website = String(context.store?.store_website_url || 'https://technostoresalta.com').trim();
const websiteHost = website.replace(/^https?:\\/\\//, '').replace(/\\/$/, '').toLowerCase();
const storefrontPaymentUrl = String(context.storefront_handoff?.payment?.url || '').trim();
const normalizedUserMessage = String(data.user_message || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\\u0300-\\u036f]/g, '')
  .replace(/[^a-z0-9\\s]/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim();

const asksCatalogLink = /(catalogo|cat[aá]logo|pagina|p[aá]gina|sitio|web|pasame el link|mandame el link|pasame la pagina|pasame la web|ver modelos|ver equipos|verlo aca|verlo ac[aá]|mostrame el link)/.test(normalizedUserMessage);
const asksBuyingStep = /(pago|pagar|comprar|compra|link de pago|transferencia|cuotas|envio|retiro|como compro|como comprar|senia|seña)/.test(normalizedUserMessage);

const recentAssistantTexts = recentMessages
  .filter((message) => message.role === 'bot')
  .map((message) => String(message.message || '').trim())
  .filter(Boolean);

const unique = (values) => [...new Set(values.filter(Boolean))];
const escapeRegExp = (value) => String(value || '').replace(/[-/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
const allowedActions = new Set([
  'attach_store_url',
  'attach_product_images',
  'share_store_location',
  'no_reply',
]);

const normalizeReplySpacing = (value) =>
  String(value || '')
    .replace(/\\r\\n/g, '\\n')
    .replace(/[ \\t]+\\n/g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .replace(/[ \\t]{2,}/g, ' ')
    .trim();
const stripMarkdownArtifacts = (value) =>
  String(value || '')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\`([^\`]+)\`/g, '$1')
    .replace(/\\*([^*\\n]+)\\*/g, '$1')
    .replace(/_([^_\\n]+)_/g, '$1');

const stripUnexpectedUrls = (text, allowedUrls = []) =>
  normalizeReplySpacing(stripMarkdownArtifacts(text))
    .replace(/https?:\\/\\/\\S+/gi, (url) => {
      if (!allowedUrls.length) return '';
      return allowedUrls.some((allowedUrl) => url.includes(String(allowedUrl).replace(/^https?:\\/\\//, ''))) ? url : '';
    })
    .trim();

const stripDanglingUrlPrompts = (text) => {
  const current = normalizeReplySpacing(text);
  if (/https?:\\/\\//i.test(current)) {
    return current;
  }

  return current
    .replace(/(?:^|[\\s.])(?:lo\\s+pod[eé]s\\s+ver|pod[eé]s\\s+verlo|pod[eé]s\\s+mirarlo|miralo|ver\\s+m[aá]s\\s+detalles)\\s+ac[aá]\\s*:?(?=\\s|$)/gi, ' ')
    .replace(/(?:^|[\\s.])ac[aá]\\s*:?(?=\\s|$)/gi, ' ')
    .replace(/\\s*,\\s*([.!?]|$)/g, '$1')
    .replace(/\\s+([.,!?])/g, '$1')
    .trim();
};

const appendExactProductUrl = (text, productUrl) => {
  if (!productUrl) return normalizeReplySpacing(text);
  const trimmed = normalizeReplySpacing(text)
    .replace(/[,:;]+$/, '')
    .replace(/\\b(?:si te interesa|si te sirve|si quer[eé]s(?: ver m[aá]s detalles)?)(?:[,:;.]*)$/i, '')
    .trim();
  if (trimmed.includes(productUrl)) return trimmed;
  if (!trimmed) return 'Lo podés ver acá: ' + productUrl;
  const separator = /[.!?]$/.test(trimmed) ? ' ' : '. ';
  return (trimmed + separator + 'Lo podés ver acá: ' + productUrl).trim();
};
const [topCandidate, secondCandidate] = candidateProducts;
const topCandidateScore = Number(topCandidate?.score || 0);
const secondCandidateScore = Number(secondCandidate?.score || 0);
const hasConfidentExactCandidate = Boolean(topCandidate?.product_key) && topCandidateScore >= 18 && (!secondCandidate || topCandidateScore - secondCandidateScore >= 6 || secondCandidateScore < 12);

let selectedProductKeys = unique(Array.isArray(responder.selected_product_keys) ? responder.selected_product_keys : []).filter((key) => candidateMap.has(key));
if (router.route_key === 'exact_product_quote' && selectedProductKeys.length === 0 && hasConfidentExactCandidate) {
  selectedProductKeys = [String(topCandidate.product_key)];
}

const selectedCatalogProductUrls = unique(
  selectedProductKeys.map((key) => String(candidateMap.get(key)?.product_url || '').trim())
);
const exactProductUrls = router.route_key === 'exact_product_quote' && (selectedProductKeys.length > 0 || hasConfidentExactCandidate)
  ? unique([
      ...selectedProductKeys.map((key) => String(candidateMap.get(key)?.product_url || '').trim()),
      hasConfidentExactCandidate ? String(topCandidate?.product_url || '').trim() : '',
    ])
  : [];
const primaryExactProductUrl = exactProductUrls[0] || '';
const priorStoreUrlMentions = websiteHost
  ? recentAssistantTexts.filter((text) => text.toLowerCase().includes(websiteHost)).length
  : 0;
const priorExactProductUrlMentions = exactProductUrls.length === 0
  ? 0
  : recentAssistantTexts.filter((text) => exactProductUrls.some((url) => url && text.includes(url))).length;
const canAppendStoreUrl = router.should_offer_store_url === true && (priorStoreUrlMentions === 0 || (priorStoreUrlMentions === 1 && asksBuyingStep));
const shouldAppendExactProductUrl = router.route_key === 'exact_product_quote' && primaryExactProductUrl && (selectedProductKeys.length > 0 || hasConfidentExactCandidate) && (asksCatalogLink || priorExactProductUrlMentions === 0);

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
if (['brand_catalog', 'generic_sales', 'store_info'].includes(router.route_key) && canAppendStoreUrl) {
  allowedUrls.push(website);
}
if (router.route_key === 'brand_catalog') {
  allowedUrls.push(...selectedCatalogProductUrls);
}
if (router.route_key === 'storefront_order' && storefrontPaymentUrl) {
  allowedUrls.push(storefrontPaymentUrl);
}
if (router.route_key === 'exact_product_quote' && shouldAppendExactProductUrl) {
  allowedUrls.push(...exactProductUrls);
}

let replyText = stripMarkdownArtifacts(stripDanglingUrlPrompts(stripUnexpectedUrls(responder.reply_text || '', allowedUrls)));
const validationErrors = [];
const validationWarnings = [];

if (!replyText) {
  validationWarnings.push({
    code: 'empty_reply_text',
    message: 'La respuesta del responder llegó vacía y se aplicó un fallback.',
    field: 'reply_text',
  });

  if (router.route_key === 'exact_product_quote' && topCandidate && (selectedProductKeys.length > 0 || hasConfidentExactCandidate)) {
    const product = topCandidate;
    const priceArs = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(product.promo_price_ars || product.price_ars);
    replyText = 'Sí, tengo ' + product.product_name + '. Queda en ARS ' + priceArs + '.';
    if (asksBuyingStep) {
      replyText += ' Si querés, te explico cómo seguir.';
    }
    if (shouldAppendExactProductUrl) {
      replyText = appendExactProductUrl(replyText, String(product.product_url || '').trim());
    }
  } else if (router.route_key === 'storefront_order' && storefrontPaymentUrl) {
    const order = context.storefront_handoff?.order || {};
    const totalText = Number(order.total || order.subtotal);
    const formattedTotal = Number.isFinite(totalText) ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(totalText) : null;
    replyText = 'Perfecto, ya te preparé el link de pago para ' + (order.title || 'tu pedido') + (formattedTotal ? ' por ARS ' + formattedTotal : '') + '. Pagalo acá: ' + storefrontPaymentUrl + ' Transferís al alias que aparece en el link y después seguimos por este mismo chat para coordinar la entrega o el retiro.';
  } else if (router.route_key === 'store_info') {
    replyText = 'Sí, te ayudo por acá. Decime qué necesitás y lo vemos.';
  } else {
    replyText = 'Sí, te ayudo por acá. Decime qué modelo buscás y te paso precio y disponibilidad.';
  }
}

if (canAppendStoreUrl && !/technostoresalta\\.com/i.test(replyText)) {
  const appendText = ' Si querés mirar el catálogo completo, está en ' + website + '.';
  replyText = normalizeReplySpacing(replyText + appendText);
}

if (router.route_key === 'exact_product_quote') {
  if (websiteHost) {
    const bareWebsitePattern = new RegExp(escapeRegExp(websiteHost) + '(?!\\\\/[A-Za-z0-9%_-]+)', 'gi');
    replyText = replyText.replace(bareWebsitePattern, '');
  }

  replyText = replyText
    .replace(/(?:si queres|si querés)?\\s*(?:tamb[ié]en\\s*)?(?:pod[eé]s|ten[eé]s)\\s+(?:ver|mirar)\\s+todo\\s+el\\s+cat[aá]logo(?:\\s+en)?\\s*\\.?/gi, '')
    .replace(/Si quer[eé]s,\\s*te cuento c[oó]mo avanzar con la compra\\.?/gi, 'Si querés, te paso más detalles.')
    .replace(/¿Te gustar[ií]a conocer las opciones de pago\\??/gi, '')
    .replace(/¿Te gustar[ií]a saber las opciones de pago\\??/gi, '')
    .replace(/¿Te gustar[ií]a que te ayude a (?:coordinar|avanzar|iniciar)[^?]*\\??/gi, '')
    .replace(/¿Hay alg[uú]n otro modelo o marca que te interese\\??/gi, '')
    .replace(/\\s+/g, ' ')
    .trim();

  if (!asksBuyingStep) {
    replyText = replyText
      .replace(/Para avanzar con la compra[^.]*\\.?/gi, '')
      .replace(/Pod[eé]s iniciar la compra[^.]*\\.?/gi, '')
      .replace(/Si prefer[ií]s avanzar online[^.]*\\.?/gi, '')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  if (shouldAppendExactProductUrl) {
    replyText = appendExactProductUrl(replyText, primaryExactProductUrl);
  }
}

replyText = normalizeReplySpacing(stripMarkdownArtifacts(stripDanglingUrlPrompts(replyText))).slice(0, 1100).trim();

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

const legacySourceFiles = readdirSync(sourceDir)
  .filter((file) => /^TechnoStore_v17_.*\.json$/.test(file))
  .sort();

const currentSourceFiles = readdirSync(outputDir)
  .filter((file) => /^TechnoStore_v18_.*\.json$/.test(file))
  .sort();

const files = legacySourceFiles.length > 0 ? legacySourceFiles : currentSourceFiles;
const activeSourceDir = legacySourceFiles.length > 0 ? sourceDir : outputDir;

const generated = [];

for (const file of files) {
  const inputPath = resolve(activeSourceDir, file);
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

console.log(JSON.stringify({ activeSourceDir, outputDir, generated }, null, 2));
