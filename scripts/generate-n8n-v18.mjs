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
    `={{ JSON.stringify({ p_manychat_id: $json.subscriber_id, p_user_message: $json.user_message, p_recent_limit: 10, p_candidate_limit: 400, p_brand_fetch_limit: 400, p_storefront_order_id: $json.storefront_order_id || null, p_storefront_order_token: $json.storefront_order_token || null }) }}`
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
}

function patchSalesResponderWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_sales_responder.json") {
    return;
  }

  if (Array.isArray(workflow.nodes)) {
    workflow.nodes = workflow.nodes.filter(
      (entry) =>
        !["AI Agent (Sales)", "OpenAI Chat Model", "Groq Chat Model", "Google Gemini Chat Model"].includes(
          String(entry?.name || "")
        )
    );
  }

  if (!workflow.connections) {
    workflow.connections = {};
  }

  workflow.connections["When Executed by Another Workflow"] = {
    main: [
      [
        {
          node: "Build Sales Prompt",
          type: "main",
          index: 0,
        },
      ],
    ],
  };
  workflow.connections["Build Sales Prompt"] = {
    main: [
      [
        {
          node: "Normalize Sales Response",
          type: "main",
          index: 0,
        },
      ],
    ],
  };

  delete workflow.connections["AI Agent (Sales)"];
  delete workflow.connections["OpenAI Chat Model"];
  delete workflow.connections["Groq Chat Model"];
  delete workflow.connections["Google Gemini Chat Model"];

  updateNodeJsCode(
    workflow,
    "Build Sales Prompt",
    `const data = $input.first().json || {};
const context = data.context || {};
const router = data.router_output || {};
const candidateProducts = Array.isArray(context.candidate_products) ? context.candidate_products : [];

const unique = (values) => [...new Set(values.filter(Boolean))];
const formatBrandLabel = (brandKey) => {
  const labels = {
    apple: 'iPhone',
    samsung: 'Samsung',
    motorola: 'Motorola',
    xiaomi: 'Xiaomi',
    redmi: 'Redmi',
    google: 'Google Pixel',
    jbl: 'JBL',
  };
  return labels[brandKey] || String(brandKey || '').trim();
};
const formatArs = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return 'ARS ' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount);
};
const publicPrice = (product) => {
  const promo = Number(product?.promo_price_ars);
  if (Number.isFinite(promo) && promo > 0) return promo;
  const price = Number(product?.price_ars);
  if (Number.isFinite(price) && price > 0) return price;
  return Number.POSITIVE_INFINITY;
};
const sortProducts = (products) =>
  [...products].sort((left, right) => {
    if (Number(right?.in_stock) !== Number(left?.in_stock)) {
      return Number(right?.in_stock) - Number(left?.in_stock);
    }
    const leftPrice = publicPrice(left);
    const rightPrice = publicPrice(right);
    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }
    return String(left?.product_name || '').localeCompare(String(right?.product_name || ''), 'es');
  });
const buildInstallmentLine = (product) => {
  const cuotasQty = Number(product?.cuotas_qty);
  if (!Number.isFinite(cuotasQty) || cuotasQty < 2) return null;
  const options = [];
  const bancarizada = formatArs(product?.bancarizada_cuota);
  const macro = formatArs(product?.macro_cuota);
  if (bancarizada) options.push(cuotasQty + ' de ' + bancarizada + ' con bancarizadas');
  if (macro) options.push(cuotasQty + ' de ' + macro + ' con Macro');
  return options.length > 0 ? 'Cuotas: ' + options.join(' o ') : null;
};
const buildProductBlock = (product) => {
  const lines = [String(product?.product_name || 'Producto')];
  const contado = formatArs(product?.promo_price_ars ?? product?.price_ars);
  if (contado) lines.push('Contado: ' + contado);
  const cuotas = buildInstallmentLine(product);
  if (cuotas) lines.push(cuotas);
  if (product?.product_url) lines.push('Link: ' + String(product.product_url).trim());
  return lines.join('\\n');
};

const brandKeys = unique(candidateProducts.map((product) => String(product?.brand_key || '').trim().toLowerCase()).filter(Boolean));
const singleBrandKey = brandKeys.length === 1 ? brandKeys[0] : null;
const visibleProducts = sortProducts(candidateProducts).slice(0, router.route_key === 'exact_product_quote' ? 1 : candidateProducts.length);
const visibleKeys = visibleProducts.map((product) => String(product.product_key || '')).filter(Boolean);
const brandOptions = unique(candidateProducts.map((product) => formatBrandLabel(String(product?.brand_key || '').trim().toLowerCase())).filter(Boolean)).slice(0, 6);

let replyText = '';
let actions = [];
let selectedProductKeys = [];
let stateDelta = {
  intent_key: 'greeting',
  funnel_stage: 'browsing',
  lead_score_delta: 3,
  share_store_location: false,
  selected_product_keys: [],
  tags_to_add: [],
  tags_to_remove: [],
  payment_method_key: null,
  summary: 'Turno comercial determinístico.',
};

switch (router.route_key) {
  case 'brand_catalog': {
    if (!singleBrandKey) {
      replyText = brandOptions.length > 0
        ? 'Decime qué marca querés ver y te paso solo los precios de esa marca.\\n\\nHoy lo puedo filtrar por ' + brandOptions.join(', ') + '.'
        : 'Decime qué marca querés ver y te paso solo los precios de esa marca.';
      stateDelta.intent_key = 'catalog_browse';
      stateDelta.summary = 'Faltó una marca única para listar catálogo.';
      break;
    }

    if (visibleProducts.length === 0) {
      replyText = 'No veo productos activos de ' + formatBrandLabel(singleBrandKey) + ' en este momento. Si querés, te filtro otra marca.';
      stateDelta.intent_key = 'catalog_browse';
      stateDelta.summary = 'Sin productos activos para la marca pedida.';
      break;
    }

    replyText =
      'Te paso los precios de ' +
      formatBrandLabel(singleBrandKey) +
      ' que tenemos:\\n\\n' +
      visibleProducts.map((product) => buildProductBlock(product)).join('\\n\\n') +
      '\\n\\nSi querés, te lo filtro por memoria, color o presupuesto.';
    actions = ['attach_store_url'];
    selectedProductKeys = [...visibleKeys];
    stateDelta.intent_key = 'catalog_browse';
    stateDelta.summary = 'Catálogo determinístico por marca: ' + formatBrandLabel(singleBrandKey) + '.';
    break;
  }
  case 'exact_product_quote': {
    const product = visibleProducts[0] || candidateProducts[0] || null;
    if (!product) {
      replyText = brandOptions.length > 0
        ? 'Decime qué marca querés ver y te paso solo los precios de esa marca.\\n\\nHoy lo puedo filtrar por ' + brandOptions.join(', ') + '.'
        : 'Decime la marca o el modelo exacto y te paso el dato correcto.';
      stateDelta.intent_key = 'price_inquiry';
      stateDelta.funnel_stage = 'browsing';
      stateDelta.summary = 'No hubo producto concreto para cotizar.';
      break;
    }

    replyText =
      'Te paso el precio de ' +
      String(product.product_name || 'ese equipo') +
      ':\\n\\n' +
      buildProductBlock(product) +
      '\\n\\nSi querés, también te digo color, memoria o cómo avanzar con la compra.';
    actions = ['attach_store_url'];
    selectedProductKeys = [String(product.product_key || '')].filter(Boolean);
    stateDelta.intent_key = 'price_inquiry';
    stateDelta.funnel_stage = 'interested';
    stateDelta.lead_score_delta = 8;
    stateDelta.summary = 'Cotización determinística de producto puntual.';
    break;
  }
  case 'generic_sales':
  default: {
    replyText = brandOptions.length > 0
      ? 'Decime qué marca querés ver y te paso solo los precios de esa marca.\\n\\nHoy lo puedo filtrar por ' + brandOptions.join(', ') + '.'
      : 'Decime qué marca querés ver y te paso solo los precios de esa marca.';
    stateDelta.intent_key = 'greeting';
    stateDelta.funnel_stage = 'browsing';
    stateDelta.lead_score_delta = 3;
    stateDelta.summary = 'Se pidió la marca antes de listar productos.';
    break;
  }
}

stateDelta.selected_product_keys = [...selectedProductKeys];

return [{
  json: {
    ...data,
    responder_output: {
      route_key: router.route_key || 'generic_sales',
      reply_text: replyText.trim(),
      selected_product_keys: selectedProductKeys,
      actions,
      state_delta: stateDelta,
    },
    responder_provider_name: 'deterministic',
    responder_model_name: 'deterministic-brand-sales',
    responder_raw_text: replyText.trim(),
  }
}];`
  );

  updateNodeJsCode(
    workflow,
    "Normalize Sales Response",
    `const base = $input.first().json || {};
const responder = base.responder_output && typeof base.responder_output === 'object'
  ? base.responder_output
  : {
      route_key: base.router_output?.route_key || 'generic_sales',
      reply_text: 'Decime qué marca querés ver y te paso solo los precios de esa marca.',
      selected_product_keys: [],
      actions: [],
      state_delta: {
        intent_key: 'greeting',
        funnel_stage: 'browsing',
        lead_score_delta: 3,
        share_store_location: false,
        selected_product_keys: [],
        tags_to_add: [],
        tags_to_remove: [],
        payment_method_key: null,
        summary: 'Fallback determinístico por falta de respuesta.',
      },
    };

return [{
  json: {
    ...base,
    responder_output: responder,
    responder_provider_name: 'deterministic',
    responder_model_name: 'deterministic-brand-sales',
    responder_raw_text: String(responder.reply_text || ''),
  }
}];`
  );
}

function patchInfoResponderWorkflow(workflow, outputFile) {
  if (outputFile !== "TechnoStore_v18_info_responder.json") {
    return;
  }
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
const candidateMap = new Map(candidateProducts.map((product) => [String(product.product_key || ''), product]));
const recentMessages = Array.isArray(context.recent_messages) ? context.recent_messages : [];
const website = String(context.store?.store_website_url || 'https://technostoresalta.com').trim();
const websiteHost = website.replace(/^https?:\\/\\//, '').replace(/\\/$/, '').toLowerCase();
const storefrontPaymentUrl = String(context.storefront_handoff?.payment?.url || '').trim();
const paymentProcess = 'Si decidís avanzar, te armamos el link de pago por WhatsApp y pagás transfiriendo al alias que aparece ahí. No aceptamos compras con DNI. Después coordinamos la entrega o el retiro por este mismo chat.';
const normalizedUserMessage = String(data.user_message || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\\u0300-\\u036f]/g, '')
  .replace(/[^a-z0-9\\s]/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim();

const asksCatalogLink = /(catalogo|cat[aá]logo|pagina|p[aá]gina|sitio|web|pasame el link|mandame el link|pasame la pagina|pasame la web|ver modelos|ver equipos|verlo aca|verlo ac[aá]|mostrame el link)/.test(normalizedUserMessage);
const asksBuyingStep = /(pago|pagar|comprar|compra|link de pago|transferencia|cuotas|envio|retiro|como compro|como comprar|senia|seña)/.test(normalizedUserMessage);
const asksFinancingIntent = /(cuota|cuotas|financi|tarjeta|bancarizada|macro|medio[s]? de pago|sin inter|naranja)/i.test(normalizedUserMessage);
const asksTotalFinanced = /(total financiado|total en cuotas|precio final en cuotas|cu[aá]nto sale financiado en total)/i.test(normalizedUserMessage);
const asksImageRequest = /(foto|fotos|imagen|imagenes|como se ve|como es|mostrame|mandame foto|mandame imagen)/.test(normalizedUserMessage);
const userClosedTurn = /(muchas gracias|mil gracias|ok gracias|dale gracias|perfecto gracias|listo gracias|gracias igual|joya gracias|gracias$)/.test(normalizedUserMessage);

const unique = (values) => [...new Set(values.filter(Boolean))];
const escapeRegExp = (value) => String(value || '').replace(/[-/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
const allowedActions = new Set([
  'attach_store_url',
  'attach_product_images',
  'share_store_location',
  'no_reply',
]);

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9\\s]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
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
const formatArs = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount);
};
const hasPositiveAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
};
const extractUrls = (value) => String(value || '').match(/https?:\\/\\/\\S+/gi) || [];
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
    .replace(/(?:^|[\\s.])(?:lo\\s+pod[eé]s\\s+ver|pod[eé]s\\s+verlo|pod[eé]s\\s+mirarlo|miralo|ver\\s+m[aá]s\\s+detalles|pod[eé]s\\s+ver\\s+todos\\s+sus\\s+detalles\\s+y\\s+fotos|lo\\s+encontr[aá]s\\s+con\\s+toda\\s+la\\s+informaci[oó]n)\\s+ac[aá]\\s*:?(?=\\s|$)/gi, ' ')
    .replace(/(?:^|[\\s.])(?:m[aá]s\\s+info|m[aá]s\\s+detalles|link)\\s*:?(?=\\s|$)/gi, ' ')
    .replace(/(?:^|[\\s.])ac[aá]\\s*:?(?=\\s|$)/gi, ' ')
    .replace(/\\s*,\\s*([.!?]|$)/g, '$1')
    .replace(/\\s+([.,!?])/g, '$1')
    .trim();
};
const appendUrl = (text, productUrl) => {
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
const isUnsafeCatalogUrl = (url) =>
  /(?:test|random|placeholder|dummy|demo|sample)/i.test(String(url || ''));
const pickDate = (value) => {
  const stamp = Date.parse(String(value || ''));
  return Number.isFinite(stamp) ? stamp : null;
};
const now = Date.now();
const recentBotMessages = recentMessages
  .filter((message) => message.role === 'bot')
  .map((message) => ({
    text: String(message.message || '').trim(),
    createdAt: pickDate(message.created_at),
  }))
  .filter((message) => message.text);
const recentAssistantTexts = recentBotMessages.map((message) => message.text);
const normalizeForDuplicateCheck = (value) =>
  normalizeText(String(value || '').replace(/https?:\\/\\/\\S+/gi, ' '));
const looksLikeDuplicateOfRecentReply = (value, withinMs = 120000) => {
  const normalized = normalizeForDuplicateCheck(value);
  if (!normalized) return false;

  return recentBotMessages.some((message) => {
    if (!message.text) return false;
    if (message.createdAt != null && now - message.createdAt > withinMs) return false;
    return normalizeForDuplicateCheck(message.text) === normalized;
  });
};
const detectBrands = (text) => {
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
  if (exactMatch) return Number(exactMatch[1]);

  const approximateMatch =
    text.match(/\\b(\\d{2,4})\\b(?=(?:\\s*gb)?\\s*(?:de\\s+)?(?:memo\\w*|almacen\\w*|giga\\w*|gb)\\b)/i) ||
    text.match(/(?:memo\\w*|almacen\\w*|giga\\w*|gb)\\s*(?:de\\s*)?\\b(\\d{2,4})\\b/i);
  return approximateMatch ? normalizeStorageValue(Number(approximateMatch[1])) : null;
};
const extractRamValue = (text) => {
  const ramMatch =
    text.match(/\\b(4|6|8|12|16)\\b(?=(?:\\s*gb)?\\s*(?:de\\s+)?ram\\b)/i) ||
    text.match(/\\bram\\s*(?:de\\s*)?\\b(4|6|8|12|16)\\b(?:\\s*gb)?/i) ||
    text.match(/\\b(4|6|8|12|16)\\s*gb\\s*ram\\b/i);
  return ramMatch ? Number(ramMatch[1]) : null;
};
const explicitFamilyMatch = normalizedUserMessage.match(/(?:iphone|galaxy|redmi|rexmi|redmy|note|poco|moto|motorola|pixel|xiaomi|xaomi|xiami)\\s+([0-9]{1,3})/i);
const standaloneAppleFamilyMatch = normalizedUserMessage.match(/\\b(14|15|16|17)\\b/);
const requestedBrands = detectBrands(normalizedUserMessage);
const requestedTier = extractTier(normalizedUserMessage);
const requestedStorage = extractStorageValue(normalizedUserMessage);
const requestedRam = extractRamValue(normalizedUserMessage);
const requestedFamilyNumber = explicitFamilyMatch
  ? Number(explicitFamilyMatch[1])
  : requestedBrands.includes('apple') && standaloneAppleFamilyMatch
    ? Number(standaloneAppleFamilyMatch[1])
    : null;
const productHaystack = (product) =>
  normalizeText([
    product?.brand_key || '',
    product?.category || '',
    product?.product_name || '',
    product?.product_key || '',
    product?.color || '',
    product?.ram_gb != null ? String(product.ram_gb) + ' gb ram' : '',
    product?.storage_gb != null ? String(product.storage_gb) + ' gb' : '',
  ].join(' '));
const candidateMatchesRequest = (product) => {
  const haystack = productHaystack(product);
  if (requestedBrands.length > 0) {
    const brandMatches = requestedBrands.some((brandKey) => haystack.includes(brandKey));
    if (!brandMatches) return false;
  }
  if (requestedFamilyNumber !== null && !new RegExp('(?:^|\\\\s)' + requestedFamilyNumber + '(?:\\\\s|$)').test(haystack)) {
    return false;
  }
  if (requestedTier === 'pro_max' && !/\\bpro max\\b|\\bpromax\\b/.test(haystack)) return false;
  if (requestedTier === 'ultra' && !/\\bultra\\b/.test(haystack)) return false;
  if (requestedTier === 'pro' && !/\\bpro\\b/.test(haystack)) return false;
  if (requestedTier === 'plus' && !/\\bplus\\b/.test(haystack)) return false;
  if (requestedStorage !== null && !new RegExp('\\\\b' + requestedStorage + '\\\\s*gb\\\\b').test(haystack)) return false;
  if (requestedRam !== null && !new RegExp('(?:\\\\b' + requestedRam + '\\\\s*gb\\\\s*ram\\\\b|\\\\bram\\\\s*' + requestedRam + '\\\\b)').test(haystack)) return false;
  return true;
};
const sortCandidates = (left, right) => {
  if (Number(right?.score || 0) !== Number(left?.score || 0)) return Number(right?.score || 0) - Number(left?.score || 0);
  if (Number(right?.in_stock || 0) !== Number(left?.in_stock || 0)) return Number(right?.in_stock || 0) - Number(left?.in_stock || 0);
  return String(left?.product_name || '').localeCompare(String(right?.product_name || ''), 'es');
};

const [topCandidate, secondCandidate] = candidateProducts;
const topCandidateScore = Number(topCandidate?.score || 0);
const secondCandidateScore = Number(secondCandidate?.score || 0);
const hasConfidentExactCandidate = Boolean(topCandidate?.product_key) && topCandidateScore >= 18 && (!secondCandidate || topCandidateScore - secondCandidateScore >= 6 || secondCandidateScore < 12);

let selectedProductKeys = unique(Array.isArray(responder.selected_product_keys) ? responder.selected_product_keys : [])
  .map((key) => String(key))
  .filter((key) => candidateMap.has(key));
if (router.route_key === 'exact_product_quote' && selectedProductKeys.length === 0 && hasConfidentExactCandidate) {
  selectedProductKeys = [String(topCandidate.product_key)];
}

const matchingCandidates = candidateProducts.filter(candidateMatchesRequest).sort(sortCandidates);
if (router.route_key === 'exact_product_quote' && matchingCandidates.length > 0) {
  const preferredKey = String(matchingCandidates[0].product_key || '');
  if (!selectedProductKeys.includes(preferredKey)) {
    selectedProductKeys = [preferredKey];
  }
}

const selectedCatalogProductUrls = unique(
  selectedProductKeys
    .map((key) => String(candidateMap.get(key)?.product_url || '').trim())
    .filter((url) => url && !isUnsafeCatalogUrl(url))
);
const exactProductUrls = router.route_key === 'exact_product_quote' && (selectedProductKeys.length > 0 || hasConfidentExactCandidate)
  ? unique([
      ...selectedProductKeys.map((key) => String(candidateMap.get(key)?.product_url || '').trim()),
      hasConfidentExactCandidate ? String(topCandidate?.product_url || '').trim() : '',
    ].filter((url) => url && !isUnsafeCatalogUrl(url)))
  : [];
const primaryExactProductUrl = exactProductUrls[0] || '';
const primaryProduct =
  selectedProductKeys.map((key) => candidateMap.get(key)).find(Boolean) ||
  matchingCandidates[0] ||
  (router.route_key === 'exact_product_quote' && hasConfidentExactCandidate ? topCandidate : null) ||
  null;

const priorStoreUrlMentions = websiteHost
  ? recentAssistantTexts.filter((text) => text.toLowerCase().includes(websiteHost)).length
  : 0;
const priorExactProductUrlMentions = exactProductUrls.length === 0
  ? 0
  : recentAssistantTexts.filter((text) => exactProductUrls.some((url) => url && text.includes(url))).length;
const canAppendStoreUrl = router.should_offer_store_url === true && (priorStoreUrlMentions === 0 || (priorStoreUrlMentions === 1 && asksBuyingStep));
const shouldAppendExactProductUrl = router.route_key === 'exact_product_quote' && primaryExactProductUrl && (selectedProductKeys.length > 0 || hasConfidentExactCandidate) && (asksCatalogLink || priorExactProductUrlMentions === 0 || asksImageRequest);

let actionList = unique(Array.isArray(responder.actions) ? responder.actions : []).filter((action) => allowedActions.has(action));
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
  selected_product_keys: unique(Array.isArray(stateDelta.selected_product_keys) ? stateDelta.selected_product_keys : []).map((key) => String(key)).filter((key) => candidateMap.has(key)),
  tags_to_add: unique(Array.isArray(stateDelta.tags_to_add) ? stateDelta.tags_to_add : []),
  tags_to_remove: unique(Array.isArray(stateDelta.tags_to_remove) ? stateDelta.tags_to_remove : []),
  payment_method_key: stateDelta.payment_method_key ?? null,
  summary: String(stateDelta.summary || router.rationale || 'Turno procesado').slice(0, 240),
};

if (selectedProductKeys.length > 0) {
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

const buildFollowUpQuestion = (product) => {
  if (userClosedTurn) return '';
  if (asksFinancingIntent) return '¿Querés que te diga si te conviene más bancarizada o Macro?';
  if (asksBuyingStep) return '¿Querés que te explique cómo avanzar con la compra?';
  if (asksImageRequest) return '¿Querés que te pase también precio y cuotas de esta versión?';
  if (requestedRam !== null || requestedStorage !== null) return '¿Lo buscabas en esta versión o querés comparar otra memoria?';
  return product ? '¿Querés que te pase cuotas, color o disponibilidad de este equipo?' : '¿Querés que lo veamos por marca o presupuesto?';
};
const buildExactReply = (product, intro = '') => {
  const pieces = [];
  if (intro) pieces.push(intro.trim());
  pieces.push((intro ? '' : (product?.in_stock ? 'Sí, tengo ' : 'Te puedo ofrecer ')) + String(product?.product_name || 'ese equipo') + '.');

  const priceText = formatArs(product?.promo_price_ars ?? product?.price_ars);
  if (priceText) {
    pieces.push('Contado: ARS ' + priceText + '.');
  }

  let built = normalizeReplySpacing(pieces.join(' '));
  if (shouldAppendExactProductUrl) {
    built = appendUrl(built, String(product?.product_url || '').trim());
  }
  const followUp = buildFollowUpQuestion(product);
  if (followUp) {
    built = normalizeReplySpacing(built + ' ' + followUp);
  }
  return built;
};

if (extractUrls(replyText).some(isUnsafeCatalogUrl)) {
  validationErrors.push({
    code: 'unsafe_catalog_url',
    message: 'Se detectó una URL de prueba o placeholder en la respuesta.',
    field: 'reply_text',
  });
  replyText = stripUnexpectedUrls(replyText, allowedUrls);
}

if (/(bitcoin|usdt|crypto|criptomon)/i.test(replyText)) {
  validationErrors.push({
    code: 'unsupported_payment_claim',
    message: 'Se detectó una mención de crypto o medio no permitido.',
    field: 'reply_text',
  });
  replyText = normalizeReplySpacing(
    replyText.replace(/[^.!?\\n]*\\b(?:bitcoin|usdt|crypto|criptomon\\w+)\\b[^.!?\\n]*[.!?]?/gi, ' ')
  );
  if (asksBuyingStep || asksFinancingIntent) {
    replyText = normalizeReplySpacing(replyText + ' ' + paymentProcess);
  }
}

if (!replyText) {
  validationWarnings.push({
    code: 'empty_reply_text',
    message: 'La respuesta del responder llegó vacía y se aplicó un fallback.',
    field: 'reply_text',
  });

  if (router.route_key === 'exact_product_quote' && primaryProduct) {
    replyText = buildExactReply(primaryProduct);
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

if (router.route_key === 'exact_product_quote' && primaryProduct) {
  const exactMatchSatisfied = candidateMatchesRequest(primaryProduct) || (requestedBrands.length === 0 && requestedFamilyNumber == null && requestedStorage == null && requestedRam == null && !requestedTier);
  if (!exactMatchSatisfied) {
    validationErrors.push({
      code: 'exact_match_unavailable',
      message: 'La respuesta se estaba apoyando en un producto que no coincide con la variante pedida.',
      field: 'selected_product_keys',
    });
  }

  const intro = exactMatchSatisfied
    ? ''
    : matchingCandidates[0]
      ? 'No veo justo esa variante, pero lo más cercano real que sí tengo es'
      : requestedBrands.length > 0
        ? 'No veo ese modelo exacto en este turno'
        : '';

  replyText = exactMatchSatisfied
    ? buildExactReply(primaryProduct)
    : matchingCandidates[0]
      ? buildExactReply(matchingCandidates[0], intro)
      : 'No veo ese modelo exacto en este turno. Si querés, mirá el catálogo completo en ' + website + '.';

  if (!exactMatchSatisfied && matchingCandidates[0]) {
    selectedProductKeys = [String(matchingCandidates[0].product_key || '')];
    finalStateDelta.selected_product_keys = [...selectedProductKeys];
  }
}

if (canAppendStoreUrl && !/technostoresalta\\.com/i.test(replyText) && (asksCatalogLink || router.route_key === 'generic_sales')) {
  replyText = normalizeReplySpacing(replyText + ' Si querés mirar el catálogo completo, está en ' + website + '.');
}

if (router.route_key === 'brand_catalog' && selectedCatalogProductUrls.length > 0 && extractUrls(replyText).length === 0) {
  const urlsBlock = selectedCatalogProductUrls.slice(0, 3).join('\\n');
  replyText = normalizeReplySpacing(replyText + '\\n\\nLinks:\\n' + urlsBlock);
}

if (router.route_key === 'exact_product_quote' && primaryProduct && shouldAppendExactProductUrl) {
  replyText = appendUrl(replyText, primaryExactProductUrl);
}

if (asksFinancingIntent && primaryProduct) {
  const financing = buildInstallmentSnippet(primaryProduct, asksTotalFinanced);
  if (financing) {
    const cleanedReply = stripInstallmentMentions(replyText);
    const prefix = cleanedReply ? (/[.!?]$/.test(cleanedReply) ? ' ' : '. ') : '';
    replyText = normalizeReplySpacing(cleanedReply + prefix + 'Cuotas presenciales: ' + financing + '.');
  } else if (!/cuota/i.test(replyText)) {
    validationWarnings.push({
      code: 'missing_financing_data',
      message: 'No había cuota concreta en datos del producto; se dejó aclaración neutral.',
      field: 'reply_text',
    });
    const cleanedReply = stripInstallmentMentions(replyText);
    const prefix = cleanedReply ? (/[.!?]$/.test(cleanedReply) ? ' ' : '. ') : '';
    replyText = normalizeReplySpacing(cleanedReply + prefix + 'En sucursal te confirman la cuota exacta de este equipo.');
  }
} else if (!asksFinancingIntent) {
  replyText = stripInstallmentMentions(replyText);
}

if (asksBuyingStep && router.route_key !== 'storefront_order' && !/link de pago por WhatsApp/i.test(replyText)) {
  replyText = normalizeReplySpacing(replyText + ' ' + paymentProcess);
}

const missingUrlAfterLinkPhrase =
  !extractUrls(replyText).length &&
  /(?:m[aá]s\\s+info|m[aá]s\\s+detalles|link|pod[eé]s\\s+verlo|lo\\s+pod[eé]s\\s+ver|ver\\s+todos\\s+sus\\s+detalles|toda\\s+la\\s+informaci[oó]n|foto|fotos)/i.test(replyText);
if (missingUrlAfterLinkPhrase) {
  validationErrors.push({
    code: 'missing_url_after_cta',
    message: 'Se detectó una CTA a link o fotos sin URL real.',
    field: 'reply_text',
  });

  if (router.route_key === 'exact_product_quote' && primaryExactProductUrl) {
    replyText = appendUrl(replyText, primaryExactProductUrl);
  } else if (canAppendStoreUrl) {
    replyText = appendUrl(replyText, website);
  }
}

replyText = normalizeReplySpacing(
  stripMarkdownArtifacts(
    stripDanglingUrlPrompts(
      replyText
        .replace(/(?:si queres|si querés)?\\s*(?:tamb[ié]en\\s*)?(?:pod[eé]s|ten[eé]s)\\s+(?:ver|mirar)\\s+todo\\s+el\\s+cat[aá]logo(?:\\s+en)?\\s*\\.?/gi, router.route_key === 'exact_product_quote' ? '' : '$&')
    )
  )
).slice(0, 1100).trim();

if (userClosedTurn && recentBotMessages.some((message) => normalizeForDuplicateCheck(message.text) === normalizeForDuplicateCheck(replyText))) {
  actionList = unique([...actionList, 'no_reply']);
  validationWarnings.push({
    code: 'closing_turn_no_repeat',
    message: 'El usuario ya cerró y la respuesta repetía información del turno anterior.',
    field: 'reply_text',
  });
}

if (!actionList.includes('no_reply') && looksLikeDuplicateOfRecentReply(replyText)) {
  actionList = unique([...actionList, 'no_reply']);
  validationWarnings.push({
    code: 'duplicate_recent_reply',
    message: 'La respuesta es prácticamente igual a una enviada hace instantes; se omite para evitar duplicado.',
    field: 'reply_text',
  });
}

const replyMessages = [];
const primaryImageUrl = primaryProduct && !isUnsafeCatalogUrl(primaryProduct.image_url) ? String(primaryProduct.image_url || '').trim() : '';
if (!actionList.includes('no_reply') && asksImageRequest && primaryImageUrl) {
  actionList = unique([...actionList, 'attach_product_images']);
  replyMessages.push({ type: 'image', image_url: primaryImageUrl, url: primaryImageUrl });
}
if (replyText) {
  replyMessages.push({ type: 'text', text: replyText });
}

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
