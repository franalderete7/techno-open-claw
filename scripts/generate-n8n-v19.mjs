#!/usr/bin/env node
/**
 * Generates n8n/v19/TechnoStore_v19_catalog_only.json — single-workflow v19 (catalog list only).
 * Run: node ./scripts/generate-n8n-v19.mjs
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = resolve(root, "n8n/v18/TechnoStore_v18_entry.json");
const statePath = resolve(root, "n8n/v18/TechnoStore_v18_state_update.json");
const outDir = resolve(root, "n8n/v19");
const outPath = resolve(outDir, "TechnoStore_v19_catalog_only.json");

const entry = JSON.parse(readFileSync(entryPath, "utf8"));
const stateWf = JSON.parse(readFileSync(statePath, "utf8"));

const keepNames = new Set([
  "Webhook",
  "Parse Input",
  "Is Audio?",
  "Download Audio",
  "Groq Whisper Transcribe",
  "Merge Input",
  "Upsert Customer",
  "Attach Customer Id",
  "Save Incoming Message",
  "Attach Saved Message",
  "Wait 8s Debounce",
  "Check Is Latest (RPC)",
  "Debounce Check",
  "Is Latest?",
]);

const idMap = new Map();
for (const node of entry.nodes) {
  if (keepNames.has(node.name)) {
    idMap.set(node.id, randomUUID());
  }
}

function remapIds(node) {
  return { ...node, id: idMap.get(node.id) };
}

const baseNodes = entry.nodes.filter((n) => keepNames.has(n.name)).map((n) => {
  const next = remapIds(n);
  if (n.name === "Webhook") {
    next.parameters = { ...next.parameters, path: "techno-sales-v19" };
    next.webhookId = "techno-sales-v19";
  }
  return next;
});

const buildUpdateNode = stateWf.nodes.find((n) => n.name === "Build Update Payload");
if (!buildUpdateNode) throw new Error("Build Update Payload not found in v18 state workflow");
const buildUpdateJs = buildUpdateNode.parameters.jsCode.replaceAll("workflow_version: 'v18'", "workflow_version: 'v19'");

const manyChatCred = entry.nodes.find((n) => n.name === "Send to WhatsApp")?.credentials;
const groqCred = entry.nodes.find((n) => n.name === "Groq Whisper Transcribe")?.credentials;

const catalogNodes = [
  {
    parameters: {
      method: "POST",
      url: "={{ $env.OPENCLAW_API_BASE_URL }}/rest/v1/rpc/v17_build_turn_context",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Authorization", value: "=Bearer {{ $env.OPENCLAW_API_TOKEN }}" },
          { name: "Content-Type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ p_manychat_id: $json.subscriber_id, p_user_message: $json.user_message, p_recent_limit: 10, p_candidate_limit: 5000, p_brand_fetch_limit: 5000, p_full_catalog: true, p_v19_catalog_all: true, p_full_catalog_max: 5000, p_storefront_order_id: $json.storefront_order_id || null, p_storefront_order_token: $json.storefront_order_token || null }) }}",
      options: { timeout: 60000 },
    },
    id: randomUUID(),
    name: "Fetch Full Catalog Context",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [3180, 280],
    continueOnFail: true,
    alwaysOutputData: true,
  },
  {
    parameters: {
      jsCode:
        "const base = $('Debounce Check').first().json || {};\nconst raw = $input.first().json || {};\nconst context = raw.v17_build_turn_context || raw || {};\nif (!context.store || typeof context.store !== 'object') {\n  context.store = {};\n}\nreturn [{\n  json: {\n    ...base,\n    context,\n  }\n}];",
    },
    id: randomUUID(),
    name: "Normalize Catalog Context",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [3460, 280],
  },
  {
    parameters: {
      jsCode: `const row = $input.first().json || {};
const ctx = row.context || {};
const products = Array.isArray(ctx.candidate_products) ? ctx.candidate_products : [];
const fmt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n);
};
const line = (p) => {
  const name = String(p.product_name || p.title || p.model || p.product_key || 'Producto').trim();
  const price = p.promo_price_ars ?? p.price_ars;
  const n = p.cuotas_qty != null && Number(p.cuotas_qty) > 0 ? Math.round(Number(p.cuotas_qty)) : null;
  const bCuota = fmt(p.bancarizada_cuota);
  const bTot = fmt(p.bancarizada_total);
  const mCuota = fmt(p.macro_cuota);
  const mTot = fmt(p.macro_total);
  const banc = !bCuota
    ? '—'
    : (n ? \`\${bCuota} × \${n}\` : String(bCuota)) + (bTot ? \` · total \${bTot}\` : '');
  const macro = !mCuota
    ? '—'
    : (n ? \`\${mCuota} × \${n}\` : String(mCuota)) + (mTot ? \` · total \${mTot}\` : '');
  const c = fmt(price);
  const contado = c ? \`ARS \${c}\` : '—';
  return \`🔥 \${name} | \${contado} | \${banc} | \${macro}\`;
};
const colLegend = 'Nombre | Contado | Bancarizadas | Macro';
const header = \`🚢 TechnoStore · catálogo completo (\${products.length} ítems) 🔥\\n\${colLegend}\`;
const lineStrings = products.length ? products.map(line) : ['(Sin productos activos por ahora.)'];
// ManyChat sendContent: each text bubble must be ≤ 2000 characters (validation error otherwise).
const MANYCHAT_TEXT_LIMIT = 1900;
const prefixFirst = \`\${header}\\n\\n\`;
const worstContinuationPrefix = \`🚢 Parte 99/99\\n\${colLegend}\\n\\n\`;
const blocks = [];
let curLines = [];
for (const ln of lineStrings) {
  const nextLines = curLines.length > 0 ? [...curLines, ln] : [ln];
  const blockStr = nextLines.join('\\n');
  const prefixLen = blocks.length === 0 ? prefixFirst.length : worstContinuationPrefix.length;
  if (blockStr.length + prefixLen > MANYCHAT_TEXT_LIMIT && curLines.length > 0) {
    blocks.push(curLines.join('\\n'));
    curLines = [ln];
  } else {
    curLines = nextLines;
  }
}
if (curLines.length > 0) blocks.push(curLines.join('\\n'));
const totalParts = blocks.length;
const wa_messages = blocks.map((block, i) => ({
  type: 'text',
  text:
    i === 0
      ? \`\${header}\\n\\n\${block}\`
      : \`🚢 Parte \${i + 1}/\${totalParts}\\n\${colLegend}\\n\\n\${block}\`,
}));
const botMessageText = wa_messages.map((m) => m.text).join('\\n\\n────────\\n\\n');
const router_output = {
  route_key: 'catalog_broadcast',
  confidence: 1,
  matched_product_keys: [],
  matched_brand: null,
  detected_city: null,
  detected_budget_range: null,
  detected_payment_method: null,
  rationale: 'v19 catálogo completo',
};
const responder_output = {
  selected_product_keys: [],
  actions: [],
  state_delta: { intent_key: 'catalog_list', funnel_stage: 'browsing', lead_score_delta: 1 },
  reply_text: botMessageText,
  raw_text: botMessageText,
};
const validator_output = {
  approved: true,
  reply_messages: wa_messages,
  selected_product_keys: [],
  actions: [],
  final_state_delta: {
    intent_key: 'catalog_list',
    funnel_stage: 'browsing',
    lead_score_delta: 1,
    selected_product_keys: [],
    share_store_location: false,
    tags_to_add: [],
    tags_to_remove: [],
    summary: 'Catálogo v19',
  },
  validation_errors: [],
  validation_warnings: [],
  fallback_reason: null,
};
return [{
  json: {
    ...row,
    context: ctx,
    router_output,
    responder_output,
    validator_output,
    should_send: true,
    bot_message_text: botMessageText,
    wa_messages,
    responder_provider_name: 'deterministic',
    responder_model_name: 'v19-catalog-list',
  },
}];`,
    },
    id: randomUUID(),
    name: "Build Catalog Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [3740, 280],
  },
  {
    parameters: {
      method: "POST",
      url: "={{ $env.OPENCLAW_API_BASE_URL }}/rest/v1/rpc/claim_reply_send",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Authorization", value: "=Bearer {{ $env.OPENCLAW_API_TOKEN }}" },
          { name: "Content-Type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ p_manychat_id: $json.subscriber_id, p_message_id: $json.saved_message_id || 0 }) }}",
      options: { timeout: 5000 },
    },
    id: randomUUID(),
    name: "Claim Reply Send (RPC)",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [4020, 280],
    continueOnFail: false,
    alwaysOutputData: false,
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: "strict", version: 2 },
        conditions: [
          {
            id: randomUUID(),
            leftValue: "={{ $json.claim_reply_send }}",
            rightValue: true,
            operator: { type: "boolean", operation: "equals" },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    id: randomUUID(),
    name: "Reply Claimed?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [4300, 280],
  },
  {
    parameters: {
      jsCode:
        "const data = $('Build Catalog Reply').first().json || {};\nconst messages = Array.isArray(data.wa_messages)\n  ? data.wa_messages\n  : [{ type: 'text', text: data.bot_message_text || '' }];\nconst wa = [];\nfor (const m of messages) {\n  if (m.type === 'image' && (m.image_url || m.url)) {\n    const url = m.image_url || m.url;\n    wa.push({ type: 'image', url, image_url: url });\n    continue;\n  }\n  const t = String(m.text || '').trim();\n  if (t) wa.push({ type: 'text', text: t });\n}\nreturn [{\n  json: {\n    ...data,\n    payload: {\n      subscriber_id: data.subscriber_id,\n      data: {\n        version: 'v2',\n        content: {\n          type: 'whatsapp',\n          messages: wa,\n        },\n      },\n    },\n  }\n}];",
    },
    id: randomUUID(),
    name: "Prepare WhatsApp Payload",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4580, 120],
  },
  {
    parameters: {
      method: "POST",
      url: "https://api.manychat.com/fb/sending/sendContent",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.payload) }}",
      options: { timeout: 30000 },
    },
    id: randomUUID(),
    name: "Send to WhatsApp",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [4860, 120],
    credentials: manyChatCred || {
      httpHeaderAuth: { id: "dTDdJWgAz1yrPfPe", name: "ManyChat API" },
    },
  },
  {
    parameters: {
      jsCode:
        "const data = $('Prepare WhatsApp Payload').first().json || {};\nconst sendResponse = $input.first().json || {};\nreturn [{\n  json: {\n    ...data,\n    send_result: {\n      attempted: true,\n      response: sendResponse,\n      sent_at: new Date().toISOString(),\n    },\n  }\n}];",
    },
    id: randomUUID(),
    name: "Build Sent State Input",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [5140, 120],
  },
  {
    parameters: {
      jsCode:
        "const data = $('Build Catalog Reply').first().json || {};\nreturn [{\n  json: {\n    ...data,\n    should_send: false,\n    send_result: {\n      attempted: false,\n      skipped: true,\n      reason: 'reply_send_not_claimed',\n      sent_at: new Date().toISOString(),\n    },\n  }\n}];",
    },
    id: randomUUID(),
    name: "Build Skipped State Input",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4580, 440],
  },
  {
    parameters: { jsCode: buildUpdateJs },
    id: randomUUID(),
    name: "Build Update Payload",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [5420, 280],
  },
  ...["Update Customer", "Should Save Bot Message?", "Save Bot Message", "Log AI Turn", "Return Result"].map(
    (name) => {
      const src = stateWf.nodes.find((n) => n.name === name);
      if (!src) throw new Error(`Missing state node: ${name}`);
      return { ...src, id: randomUUID(), position: [...src.position] };
    },
  ),
];

const baseConnections = {};
for (const [from, spec] of Object.entries(entry.connections)) {
  if (!keepNames.has(from)) continue;
  baseConnections[from] = spec;
}
baseConnections["Is Latest?"] = {
  main: [
    [{ node: "Fetch Full Catalog Context", type: "main", index: 0 }],
    [],
  ],
};

const tailConnections = {
  "Fetch Full Catalog Context": {
    main: [[{ node: "Normalize Catalog Context", type: "main", index: 0 }]],
  },
  "Normalize Catalog Context": {
    main: [[{ node: "Build Catalog Reply", type: "main", index: 0 }]],
  },
  "Build Catalog Reply": {
    main: [[{ node: "Claim Reply Send (RPC)", type: "main", index: 0 }]],
  },
  "Claim Reply Send (RPC)": {
    main: [[{ node: "Reply Claimed?", type: "main", index: 0 }]],
  },
  "Reply Claimed?": {
    main: [
      [{ node: "Prepare WhatsApp Payload", type: "main", index: 0 }],
      [{ node: "Build Skipped State Input", type: "main", index: 0 }],
    ],
  },
  "Prepare WhatsApp Payload": {
    main: [[{ node: "Send to WhatsApp", type: "main", index: 0 }]],
  },
  "Send to WhatsApp": {
    main: [[{ node: "Build Sent State Input", type: "main", index: 0 }]],
  },
  "Build Sent State Input": {
    main: [[{ node: "Build Update Payload", type: "main", index: 0 }]],
  },
  "Build Skipped State Input": {
    main: [[{ node: "Build Update Payload", type: "main", index: 0 }]],
  },
  "Build Update Payload": stateWf.connections["Build Update Payload"],
  "Update Customer": stateWf.connections["Update Customer"],
  "Should Save Bot Message?": stateWf.connections["Should Save Bot Message?"],
  "Save Bot Message": stateWf.connections["Save Bot Message"],
  "Log AI Turn": stateWf.connections["Log AI Turn"],
};

const workflow = {
  name: "TechnoStore - AI Sales Agent v19 (catálogo)",
  active: false,
  nodes: [...baseNodes, ...catalogNodes],
  connections: { ...baseConnections, ...tailConnections },
  settings: { executionOrder: "v1" },
  tags: [],
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
