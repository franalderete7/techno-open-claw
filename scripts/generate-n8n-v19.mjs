#!/usr/bin/env node
/**
 * Generates n8n/v19/TechnoStore_v19_catalog_only.json — v19: full catalog (Samsung→Xiaomi→iPhone→rest),
 * follow-up question, then Groq Qwen chat for specs & tienda (requires last_intent on API customer).
 * Run: node ./scripts/generate-n8n-v19.mjs
 *
 * Groq model is stored as a fixed ID on the Groq Chat Model node (e.g. qwen/qwen3-32b). Change it in the n8n UI
 * dropdown after credentials load — do not use $env in the Model field; the editor cannot preview that and shows
 * “not accessible via UI, please run node”.
 * Optional when generating JSON: N8N_GROQ_CHAT_MODEL_ID=baked-model-id
 * LangChain: AI Agent + lmChatGroq (Groq Chat Model).
 *   Create n8n credentials type “Groq API” (not HTTP Header). Optional when generating JSON:
 *   N8N_GROQ_LM_CREDENTIAL_ID, N8N_GROQ_LM_CREDENTIAL_NAME
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

const groqLmCredId = String(process.env.N8N_GROQ_LM_CREDENTIAL_ID || "").trim();
const groqLmCredName = String(process.env.N8N_GROQ_LM_CREDENTIAL_NAME || "Groq API").trim();
const groqLmCredentials =
  groqLmCredId !== ""
    ? { groqApi: { id: groqLmCredId, name: groqLmCredName } }
    : { groqApi: { id: "REPLACE_GROQ_API_CREDENTIAL", name: "Groq API" } };

const groqChatModelId = String(process.env.N8N_GROQ_CHAT_MODEL_ID || "qwen/qwen3-32b").trim();

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
      jsCode:
        "const row = $input.first().json || {};\nconst ctx = row.context || {};\nconst cust = ctx.customer || {};\nconst lastIntent = cust.last_intent != null ? String(cust.last_intent) : '';\nconst msg = String(row.user_message || '').trim();\nconst refresh = /\\b(cat[aá]logo|lista\\s+completa|precios\\s+de\\s+todo|mostr[aá]me\\s+todo|mand[aá]me\\s+(el\\s+)?cat|env[ií]ame\\s+el\\s+cat)/i.test(msg);\nconst chatIntents = new Set(['catalog_list', 'v19_chat']);\nconst v19_use_catalog = refresh || !chatIntents.has(lastIntent);\nreturn [{ json: { ...row, v19_use_catalog } }];",
    },
    id: randomUUID(),
    name: "Decide v19 Path",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [3600, 280],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: "strict", version: 2 },
        conditions: [
          {
            id: randomUUID(),
            leftValue: "={{ $json.v19_use_catalog }}",
            rightValue: true,
            operator: { type: "boolean", operation: "equals" },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    id: randomUUID(),
    name: "Catalog or Chat?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [3740, 280],
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
const brandOrder = (bk) => {
  const k = String(bk || '').trim().toLowerCase();
  if (k === 'samsung') return 0;
  if (k === 'xiaomi') return 1;
  if (k === 'apple' || k === 'iphone') return 2;
  return 3;
};
const sortedProducts = [...products].sort((a, b) => {
  const d = brandOrder(a.brand_key) - brandOrder(b.brand_key);
  if (d !== 0) return d;
  const na = String(a.product_name || a.title || a.model || '');
  const nb = String(b.product_name || b.title || b.model || '');
  return na.localeCompare(nb, 'es', { sensitivity: 'base' });
});
const colLegend = 'Nombre | Contado | Bancarizadas | Macro';
const header = \`🚢 TechnoStore · catálogo completo (\${sortedProducts.length} ítems) 🔥\\n\${colLegend}\`;
const lineStrings = sortedProducts.length ? sortedProducts.map(line) : ['(Sin productos activos por ahora.)'];
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
let wa_messages = blocks.map((block, i) => ({
  type: 'text',
  text:
    i === 0
      ? \`\${header}\\n\\n\${block}\`
      : \`🚢 Parte \${i + 1}/\${totalParts}\\n\${colLegend}\\n\\n\${block}\`,
}));
const closing = '\\n\\n¿Qué modelo en particular te interesa?';
if (wa_messages.length > 0) {
  const li = wa_messages.length - 1;
  const t = wa_messages[li].text;
  if (t.length + closing.length <= MANYCHAT_TEXT_LIMIT) {
    wa_messages[li] = { type: 'text', text: t + closing };
  } else {
    wa_messages.push({ type: 'text', text: '¿Qué modelo en particular te interesa?' });
  }
}
let botMessageText = wa_messages.map((m) => m.text).join('\\n\\n────────\\n\\n');
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
    position: [3920, 160],
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
const storeBlock = storeBits.length ? storeBits.join('\\n') : '(Sin datos de tienda en contexto; decí que no tenés el dato exacto y ofrecé pasar con un humano.)';
const recent = Array.isArray(ctx.recent_messages) ? ctx.recent_messages.slice(-6) : [];
const history = recent
  .map((m) => {
    const role = m.role === 'bot' ? 'Asistente' : 'Cliente';
    let txt = String(m.message || '').trim();
    if (!txt) return '';
    if (m.role === 'bot' && (txt.includes('catálogo completo') || txt.includes('TechnoStore · catálogo') || txt.includes('Parte 2/'))) {
      txt = '[Ya te enviamos el catálogo completo por acá]';
    } else if (txt.length > 900) {
      txt = txt.slice(0, 700) + '…';
    }
    return \`\${role}: \${txt}\`;
  })
  .filter(Boolean)
  .join('\\n');
const firstName = String(row.first_name || 'ahí').trim() || 'ahí';
const agent_system_message = [
  'Sos el asistente virtual de TechnoStore en WhatsApp. La tienda vende celulares, accesorios y tecnología.',
  '',
  '## Cómo comunicarte',
  '- Español rioplatense, natural y simple, como una persona del equipo (no robótico).',
  '- Mensajes cortos por defecto; si piden detalle técnico o comparación, podés extender un poco.',
  '- No uses markdown pesado ni listas enormes; si comparan modelos, máximo 3–4 bullets o párrafos cortos.',
  '',
  '## Qué podés responder bien',
  '- Especificaciones y uso típico de celulares (pantalla, cámara, batería, rendimiento, ecosistema): usá conocimiento general del mercado.',
  '- Si hay duda (variantes de modelo, cambios de ficha técnica), decilo honestamente; no inventes números ni fechas.',
  '- Preguntas sobre el local: SOLO usá datos del bloque TIENDA más abajo. Si algo no figura ahí, decí que no tenés el dato y ofrecé que un humano lo confirme o que pasen por el local.',
  '',
  '## Qué no podés inventar',
  '- Precio al contado, cuotas, promociones, stock, reservas, garantías, envíos o “lo último que sale”: no afirmes nada concreto.',
  '- Decí que los valores y disponibilidad los acaban de ver en el catálogo que enviamos por este chat y que para cerrar o casos puntuales conviene hablar con la tienda o un asesor humano.',
  '',
  '## Contexto',
  '- No digas que buscaste en internet en tiempo real ni que tenés acceso a la web.',
  '- Si el mensaje es off-topic, respondé muy breve y redirigí amablemente a celulares o a la tienda.',
  '',
  \`## Trato al cliente\\nUsá un tono amable; podés tratar de “vos”. Nombre de referencia: \${firstName}.\`,
  '',
  '## TIENDA (única fuente de hechos sobre el local)',
  storeBlock,
].join('\\n');
const userLine = String(row.user_message || '').trim().slice(0, 2000) || '(sin texto)';
const agent_user_prompt = [
  history ? \`## Historial reciente (resumen del chat)\\n\${history}\` : '',
  \`## Mensaje actual del cliente\\n\${userLine}\`,
].filter(Boolean).join('\\n\\n');
return [{ json: { ...row, agent_system_message, agent_user_prompt, groq_model: ${JSON.stringify(groqChatModelId)} } }];`,
    },
    id: randomUUID(),
    name: "Build Groq Chat Request",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [3920, 420],
  },
  {
    parameters: {
      model: groqChatModelId,
      options: {
        maxTokensToSample: 900,
        temperature: 0.45,
      },
    },
    id: randomUUID(),
    name: "Groq Chat Model (TechnoStore)",
    type: "@n8n/n8n-nodes-langchain.lmChatGroq",
    typeVersion: 1,
    position: [4200, 560],
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
        maxIterations: 3,
        returnIntermediateSteps: false,
        enableStreaming: false,
        passthroughBinaryImages: false,
      },
    },
    id: randomUUID(),
    name: "TechnoStore Assistant (AI Agent)",
    type: "@n8n/n8n-nodes-langchain.agent",
    typeVersion: 3.1,
    position: [4200, 420],
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
  route_key: 'v19_groq_chat',
  confidence: 1,
  matched_product_keys: [],
  matched_brand: null,
  detected_city: null,
  detected_budget_range: null,
  detected_payment_method: null,
  rationale: 'v19 AI Agent (Groq)',
};
const responder_output = {
  selected_product_keys: [],
  actions: [],
  state_delta: { intent_key: 'v19_chat', funnel_stage: 'engaged', lead_score_delta: 1 },
  reply_text: botMessageText,
  raw_text: botMessageText,
};
const validator_output = {
  approved: true,
  reply_messages: wa_messages,
  selected_product_keys: [],
  actions: [],
  final_state_delta: {
    intent_key: 'v19_chat',
    funnel_stage: 'engaged',
    lead_score_delta: 1,
    selected_product_keys: [],
    share_store_location: false,
    tags_to_add: [],
    tags_to_remove: [],
    summary: 'Chat v19',
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
    position: [4400, 420],
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
    position: [4680, 280],
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
    position: [4960, 280],
  },
  {
    parameters: {
      jsCode:
        "const catalog = $('Build Catalog Reply').all();\nconst groq = $('Build Groq Assistant Reply').all();\nconst data = catalog.length ? catalog[0].json : groq[0].json;\nconst messages = Array.isArray(data.wa_messages)\n  ? data.wa_messages\n  : [{ type: 'text', text: data.bot_message_text || '' }];\nconst wa = [];\nfor (const m of messages) {\n  if (m.type === 'image' && (m.image_url || m.url)) {\n    const url = m.image_url || m.url;\n    wa.push({ type: 'image', url, image_url: url });\n    continue;\n  }\n  const t = String(m.text || '').trim();\n  if (t) wa.push({ type: 'text', text: t });\n}\nreturn [{\n  json: {\n    ...data,\n    payload: {\n      subscriber_id: data.subscriber_id,\n      data: {\n        version: 'v2',\n        content: {\n          type: 'whatsapp',\n          messages: wa,\n        },\n      },\n    },\n  }\n}];",
    },
    id: randomUUID(),
    name: "Prepare WhatsApp Payload",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [5240, 120],
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
    position: [5520, 120],
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
    position: [5800, 120],
  },
  {
    parameters: {
      jsCode:
        "const catalog = $('Build Catalog Reply').all();\nconst groq = $('Build Groq Assistant Reply').all();\nconst data = catalog.length ? catalog[0].json : groq[0].json;\nreturn [{\n  json: {\n    ...data,\n    should_send: false,\n    send_result: {\n      attempted: false,\n      skipped: true,\n      reason: 'reply_send_not_claimed',\n      sent_at: new Date().toISOString(),\n    },\n  }\n}];",
    },
    id: randomUUID(),
    name: "Build Skipped State Input",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [5240, 440],
  },
  {
    parameters: { jsCode: buildUpdateJs },
    id: randomUUID(),
    name: "Build Update Payload",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [6080, 280],
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
    main: [[{ node: "Decide v19 Path", type: "main", index: 0 }]],
  },
  "Decide v19 Path": {
    main: [[{ node: "Catalog or Chat?", type: "main", index: 0 }]],
  },
  "Catalog or Chat?": {
    main: [
      [{ node: "Build Catalog Reply", type: "main", index: 0 }],
      [{ node: "Build Groq Chat Request", type: "main", index: 0 }],
    ],
  },
  "Build Catalog Reply": {
    main: [[{ node: "Claim Reply Send (RPC)", type: "main", index: 0 }]],
  },
  "Build Groq Chat Request": {
    main: [[{ node: "TechnoStore Assistant (AI Agent)", type: "main", index: 0 }]],
  },
  "Groq Chat Model (TechnoStore)": {
    ai_languageModel: [
      [{ node: "TechnoStore Assistant (AI Agent)", type: "ai_languageModel", index: 0 }],
    ],
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
