#!/usr/bin/env node
/**
 * Generates n8n/v20/TechnoStore_v20.json — ManyChat ingress, debounce, minimal DB context (no catalog),
 * Groq assistant, WhatsApp send, customer notes update (no audit_logs).
 * Run: node ./scripts/generate-n8n-v20.mjs
 *
 * Optional env: N8N_GROQ_CHAT_MODEL_ID, N8N_GROQ_LM_CREDENTIAL_ID, N8N_GROQ_LM_CREDENTIAL_NAME
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = resolve(root, "n8n/v20/entry_includes.json");
const statePath = resolve(root, "n8n/v20/state_update_template.json");
const outDir = resolve(root, "n8n/v20");
const outPath = resolve(outDir, "TechnoStore_v20.json");

const entryPack = JSON.parse(readFileSync(entryPath, "utf8"));
const stateTpl = JSON.parse(readFileSync(statePath, "utf8"));

const keepNames = new Set(entryPack.nodes.map((n) => n.name));

const idMap = new Map();
for (const node of entryPack.nodes) {
  idMap.set(node.id, randomUUID());
}

function remapIds(node) {
  return { ...node, id: idMap.get(node.id) };
}

const baseNodes = entryPack.nodes.map((n) => {
  const next = remapIds(n);
  if (n.name === "Webhook") {
    next.parameters = { ...next.parameters, path: "techno-sales-v20" };
    next.webhookId = "techno-sales-v20";
  }
  return next;
});

const buildUpdateNode = stateTpl.nodes.find((n) => n.name === "Build Update Payload");
if (!buildUpdateNode) throw new Error("Build Update Payload not found in state template");

let buildUpdateJs = buildUpdateNode.parameters.jsCode.replaceAll("workflow_version: 'v18'", "workflow_version: 'v20'");
const turnStart = buildUpdateJs.indexOf("\nconst turnRow = ");
const returnIdx = buildUpdateJs.indexOf("\nreturn [{");
if (turnStart !== -1 && returnIdx !== -1 && returnIdx > turnStart) {
  buildUpdateJs = buildUpdateJs.slice(0, turnStart) + buildUpdateJs.slice(returnIdx);
}
buildUpdateJs = buildUpdateJs.replace(/\s*ai_turn_row: turnRow,\s*/g, "\n");

const manyChatCred = {
  httpHeaderAuth: { id: "REPLACE_MANYCHAT_CREDENTIAL", name: "ManyChat API" },
};

const groqLmCredId = String(process.env.N8N_GROQ_LM_CREDENTIAL_ID || "").trim();
const groqLmCredName = String(process.env.N8N_GROQ_LM_CREDENTIAL_NAME || "Groq API").trim();
const groqLmCredentials =
  groqLmCredId !== ""
    ? { groqApi: { id: groqLmCredId, name: groqLmCredName } }
    : { groqApi: { id: "REPLACE_GROQ_API_CREDENTIAL", name: "Groq API" } };

const groqChatModelId = String(process.env.N8N_GROQ_CHAT_MODEL_ID || "qwen/qwen3-32b").trim();

const tailNodes = [
  {
    parameters: {
      method: "POST",
      url: "={{ $env.OPENCLAW_API_BASE_URL }}/rest/v1/rpc/v20_build_turn_context",
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
        "={{ JSON.stringify({ p_manychat_id: $json.subscriber_id, p_recent_limit: 12 }) }}",
      options: { timeout: 30000 },
    },
    id: randomUUID(),
    name: "Fetch Minimal Context",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [3180, 280],
    continueOnFail: true,
    alwaysOutputData: true,
  },
  {
    parameters: {
      jsCode:
        "const base = $('Debounce Check').first().json || {};\nconst raw = $input.first().json || {};\nconst context = raw.v20_build_turn_context || raw || {};\nif (!context.store || typeof context.store !== 'object') {\n  context.store = {};\n}\nreturn [{\n  json: {\n    ...base,\n    context,\n  }\n}];",
    },
    id: randomUUID(),
    name: "Normalize Context",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [3460, 280],
  },
  {
    parameters: {
      jsCode: `const row = $input.first().json || {};
const ctx = row.context || {};
const store = ctx.store || {};
const storeBits = [
  store.name ? \`Nombre: \${store.name}\` : '',
  store.store_address || store.address ? \`Dirección: \${store.store_address || store.address}\` : '',
  store.store_phone || store.phone ? \`Tel: \${store.store_phone || store.phone}\` : '',
  store.store_hours || store.hours ? \`Horarios: \${store.store_hours || store.hours}\` : '',
  store.store_website_url ? \`Web: \${store.store_website_url}\` : '',
].filter(Boolean);
const storeBlock = storeBits.length ? storeBits.join('\\n') : '(Sin datos de tienda en API; pedí que un humano confirme horarios y dirección.)';
const recent = Array.isArray(ctx.recent_messages) ? ctx.recent_messages.slice(-8) : [];
const history = recent
  .map((m) => {
    const role = m.role === 'bot' ? 'Asistente' : 'Cliente';
    let txt = String(m.message || '').trim();
    if (!txt) return '';
    if (txt.length > 900) txt = txt.slice(0, 700) + '…';
    return \`\${role}: \${txt}\`;
  })
  .filter(Boolean)
  .join('\\n');
const firstName = String(row.first_name || 'ahí').trim() || 'ahí';
const priceBlock = String(ctx.pricelist_markdown || '').trim() || '(Lista de precios no disponible en el servidor; pedí que un humano confirme valores.)';
const agent_system_message = [
  'Sos el asistente virtual de TechnoStore en WhatsApp (celulares, accesorios, tecnología).',
  '',
  '## Estilo',
  '- Español rioplatense, natural, breve; como alguien del equipo.',
  '- Podés usar *negritas* y emojis como en WhatsApp cuando ayude a leer precios.',
  '',
  '## Hechos del local',
  '- Dirección, teléfono y horarios: SOLO del bloque TIENDA abajo.',
  '',
  '## Precios y financiación',
  '- Contado, reserva, cuotas y MACRO: usá ÚNICAMENTE el bloque LISTA DE PRECIOS; no inventes modelos ni cifras.',
  '- Si el cliente pide algo que no está en la lista, decí que un asesor confirma disponibilidad y precio.',
  '- Podés comentar características generales de equipos; montos siempre según la lista.',
  '',
  '## Contexto',
  '- No digas que buscaste en internet en tiempo real.',
  '- Off-topic: corto y redirigí a la tienda o celulares.',
  '',
  \`## Cliente\\nNombre de referencia: \${firstName}.\`,
  '',
  '## TIENDA',
  storeBlock,
  '',
  '## LISTA DE PRECIOS (abril / archivo del servidor)',
  priceBlock,
].join('\\n');
const userLine = String(row.user_message || '').trim().slice(0, 2000) || '(sin texto)';
const agent_user_prompt = [
  history ? \`## Historial reciente\\n\${history}\` : '',
  \`## Mensaje actual\\n\${userLine}\`,
].filter(Boolean).join('\\n\\n');
return [{ json: { ...row, agent_system_message, agent_user_prompt, groq_model: ${JSON.stringify(groqChatModelId)} } }];`,
    },
    id: randomUUID(),
    name: "Build Groq Chat Request",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [3740, 280],
  },
  {
    parameters: {
      model: groqChatModelId,
      options: {
        maxTokensToSample: 900,
        temperature: 0.4,
      },
    },
    id: randomUUID(),
    name: "Groq Chat Model (TechnoStore)",
    type: "@n8n/n8n-nodes-langchain.lmChatGroq",
    typeVersion: 1,
    position: [4020, 420],
    credentials: groqLmCredentials,
  },
  {
    parameters: {
      promptType: "define",
      text: "={{ $json.agent_user_prompt }}",
      hasOutputParser: false,
      needsFallback: false,
      options: {
        systemMessage: "={{ $json.agent_system_message }}",
        maxIterations: 2,
        returnIntermediateSteps: false,
        enableStreaming: false,
        passthroughBinaryImages: false,
      },
    },
    id: randomUUID(),
    name: "TechnoStore Assistant (AI Agent)",
    type: "@n8n/n8n-nodes-langchain.agent",
    typeVersion: 3.1,
    position: [4020, 280],
  },
  {
    parameters: {
      jsCode: `const raw = $input.first().json || {};
const row = $('Build Groq Chat Request').first().json || {};
const ctx = row.context || {};
const text = String(
  raw.output ??
    raw.text ??
    (raw.json && typeof raw.json === 'object' ? raw.json.output : '') ??
    raw.choices?.[0]?.message?.content ??
    '',
).trim() || 'Perdón, ahora no pude responder. ¿Podés repetir en una frase qué necesitás?';
const chunkManyChat = (t, limit) => {
  const s = String(t || '').trim();
  if (!s) return [];
  const out = [];
  let rest = s;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\\n\\n', limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf('. ', limit);
    if (cut < limit * 0.4) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
};
const parts = chunkManyChat(text, 1800);
const wa_messages = parts.map((p) => ({ type: 'text', text: p }));
const botMessageText = wa_messages.map((m) => m.text).join('\\n\\n────────\\n\\n');
const model = String(raw.model || row.groq_model || 'qwen/qwen3-32b').trim();
const router_output = {
  route_key: 'v20_groq_chat',
  confidence: 1,
  matched_product_keys: [],
  matched_brand: null,
  detected_city: null,
  detected_budget_range: null,
  detected_payment_method: null,
  rationale: 'v20 AI Agent (Groq)',
};
const responder_output = {
  selected_product_keys: [],
  actions: [],
  state_delta: { intent_key: 'v20_chat', funnel_stage: 'engaged', lead_score_delta: 1 },
  reply_text: botMessageText,
  raw_text: botMessageText,
};
const validator_output = {
  approved: true,
  reply_messages: wa_messages,
  selected_product_keys: [],
  actions: [],
  final_state_delta: {
    intent_key: 'v20_chat',
    funnel_stage: 'engaged',
    lead_score_delta: 1,
    selected_product_keys: [],
    share_store_location: false,
    tags_to_add: [],
    tags_to_remove: [],
    summary: 'Chat v20',
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
    responder_provider_name: 'groq',
    responder_model_name: model,
  },
}];`,
    },
    id: randomUUID(),
    name: "Build Groq Assistant Reply",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4300, 280],
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
    position: [4580, 280],
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
    position: [4860, 280],
  },
  {
    parameters: {
      jsCode:
        "const data = $('Build Groq Assistant Reply').first().json || $input.first()?.json || {};\nconst messages = Array.isArray(data.wa_messages)\n  ? data.wa_messages\n  : [{ type: 'text', text: data.bot_message_text || '' }];\nconst wa = [];\nfor (const m of messages) {\n  if (m.type === 'image' && (m.image_url || m.url)) {\n    const url = m.image_url || m.url;\n    wa.push({ type: 'image', url, image_url: url });\n    continue;\n  }\n  const t = String(m.text || '').trim();\n  if (t) wa.push({ type: 'text', text: t });\n}\nreturn [{\n  json: {\n    ...data,\n    payload: {\n      subscriber_id: data.subscriber_id,\n      data: {\n        version: 'v2',\n        content: {\n          type: 'whatsapp',\n          messages: wa,\n        },\n      },\n    },\n  }\n}];",
    },
    id: randomUUID(),
    name: "Prepare WhatsApp Payload",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [5140, 120],
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
    position: [5420, 120],
    credentials: manyChatCred,
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
    position: [5700, 120],
  },
  {
    parameters: {
      jsCode:
        "const data = $('Build Groq Assistant Reply').first().json || $input.first()?.json || {};\nreturn [{\n  json: {\n    ...data,\n    should_send: false,\n    send_result: {\n      attempted: false,\n      skipped: true,\n      reason: 'reply_send_not_claimed',\n      sent_at: new Date().toISOString(),\n    },\n  }\n}];",
    },
    id: randomUUID(),
    name: "Build Skipped State Input",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [5140, 440],
  },
  {
    parameters: { jsCode: buildUpdateJs },
    id: randomUUID(),
    name: "Build Update Payload",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [5980, 280],
  },
  ...["Update Customer", "Should Save Bot Message?", "Save Bot Message", "Return Result"].map((name) => {
    const src = stateTpl.nodes.find((n) => n.name === name);
    if (!src) throw new Error(`Missing state node: ${name}`);
    return { ...src, id: randomUUID(), position: [...src.position] };
  }),
];

const baseConnections = { ...entryPack.connections };
baseConnections["Is Latest?"] = {
  main: [[{ node: "Fetch Minimal Context", type: "main", index: 0 }], []],
};

const stateConnections = {
  "Build Update Payload": stateTpl.connections["Build Update Payload"],
  "Update Customer": stateTpl.connections["Update Customer"],
  "Should Save Bot Message?": {
    main: [
      [{ node: "Save Bot Message", type: "main", index: 0 }],
      [{ node: "Return Result", type: "main", index: 0 }],
    ],
  },
  "Save Bot Message": {
    main: [[{ node: "Return Result", type: "main", index: 0 }]],
  },
};

const tailConnections = {
  "Fetch Minimal Context": {
    main: [[{ node: "Normalize Context", type: "main", index: 0 }]],
  },
  "Normalize Context": {
    main: [[{ node: "Build Groq Chat Request", type: "main", index: 0 }]],
  },
  "Build Groq Chat Request": {
    main: [[{ node: "TechnoStore Assistant (AI Agent)", type: "main", index: 0 }]],
  },
  "Groq Chat Model (TechnoStore)": {
    ai_languageModel: [[{ node: "TechnoStore Assistant (AI Agent)", type: "ai_languageModel", index: 0 }]],
  },
  "TechnoStore Assistant (AI Agent)": {
    main: [[{ node: "Build Groq Assistant Reply", type: "main", index: 0 }]],
  },
  "Build Groq Assistant Reply": {
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
  ...stateConnections,
};

const workflow = {
  name: "TechnoStore - AI Sales Agent v20 (minimal)",
  active: false,
  nodes: [...baseNodes, ...tailNodes],
  connections: { ...baseConnections, ...tailConnections },
  settings: { executionOrder: "v1" },
  tags: [],
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
