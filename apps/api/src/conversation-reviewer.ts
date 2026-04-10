import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { pool } from "./db.js";
import { ollamaChat } from "./ollama.js";
import { sendTelegramTextMessages } from "./telegram.js";

type LoggerLike = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type WorkflowReviewNode = {
  name: string;
  type: string;
  systemMessage?: string;
  jsCode?: string;
};

type WorkflowReviewFile = {
  file: string;
  workflowName: string;
  nodes: WorkflowReviewNode[];
};

type WorkflowReviewContext = {
  repoDir: string;
  repoCommitSha: string | null;
  files: WorkflowReviewFile[];
  compactText: string;
};

type ConversationRow = {
  id: number;
  channel_thread_key: string;
  status: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  customer_id: number | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  inbound_count: number;
  outbound_count: number;
};

type MessageRow = {
  conversation_id: number;
  id: number;
  direction: string;
  sender_kind: string;
  message_type: string;
  text_body: string | null;
  transcript: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type ConversationReviewInput = {
  conversation_id: number;
  channel_thread_key: string;
  customer_name: string;
  customer_phone: string | null;
  started_at: string;
  last_message_at: string | null;
  inbound_count: number;
  outbound_count: number;
  auto_flags: string[];
  auto_flag_details: string[];
  route_keys_seen: string[];
  workflow_summaries_seen: string[];
  validation_errors_seen: string[];
  validation_warnings_seen: string[];
  messages: Array<{
    message_id: number;
    created_at: string;
    role: string;
    message_type: string;
    text: string;
  }>;
};

type ReviewerIssueEvidence = {
  message_id?: number;
  quote?: string;
};

type ReviewerItem = {
  conversation_id: number;
  score_0_100: number;
  verdict: string;
  severity: string;
  issue_types: string[];
  what_went_wrong: string;
  root_cause_area: string;
  suggested_fix: string;
  evidence?: ReviewerIssueEvidence[];
};

type ReviewerBatchSummary = {
  overall_score_0_100?: number;
  conversations_with_issues?: number;
  top_issue_types?: Array<{ type: string; count: number }>;
  urgent_findings?: string[];
  recommended_changes?: Array<{
    priority?: string;
    area?: string;
    change?: string;
    reason?: string;
  }>;
  notable_wins?: string[];
};

type ReviewerResult = {
  batch_summary: ReviewerBatchSummary;
  items: ReviewerItem[];
};

type RunOptions = {
  triggeredBy?: string;
  force?: boolean;
  limit?: number;
  conversationIds?: number[];
};

type RunResult =
  | { status: "disabled"; reason: string }
  | { status: "busy" }
  | { status: "skipped"; reason: string; available?: number }
  | { status: "completed"; batchId: number; conversationCount: number };

const REVIEW_LOCK_KEY = 43002117;
const WORKFLOW_FILES = [
  "n8n/v18/TechnoStore_v18_entry.json",
  "n8n/v18/TechnoStore_v18_router.json",
  "n8n/v18/TechnoStore_v18_info_responder.json",
  "n8n/v18/TechnoStore_v18_sales_responder.json",
  "n8n/v18/TechnoStore_v18_validator.json",
  "n8n/v18/TechnoStore_v18_state_update.json",
];

let reviewIntervalHandle: NodeJS.Timeout | null = null;

function getReviewRepoCandidates() {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  return [
    config.CONVERSATION_REVIEW_REPO_DIR,
    resolve(currentDir, "../../.."),
    "/srv/techno-open-claw",
  ].filter(Boolean);
}

function getReviewTargetChatIds() {
  if (config.CONVERSATION_REVIEW_TELEGRAM_CHAT_IDS.length > 0) {
    return config.CONVERSATION_REVIEW_TELEGRAM_CHAT_IDS;
  }

  return config.TELEGRAM_ALLOWED_CHAT_IDS;
}

function isReviewerEnabled() {
  return config.CONVERSATION_REVIEW_ENABLED;
}

/** Manual runs from the admin UI / API (`manual_api`, `manual_selection`) work without the cron flag. */
function isManualReviewTrigger(options: RunOptions) {
  const t = options.triggeredBy ?? "";
  return t === "manual_api" || t === "manual_selection";
}

function reviewerModelLabel() {
  const override = config.OLLAMA_REVIEW_MODEL.trim();
  const main = config.OLLAMA_MODEL.trim();
  return override || main || "qwen3.5:cloud";
}

function pickReviewRepoDir() {
  for (const candidate of getReviewRepoCandidates()) {
    const next = String(candidate || "").trim();
    if (!next) {
      continue;
    }

    const workflowPath = resolve(next, WORKFLOW_FILES[0]);
    if (existsSync(workflowPath)) {
      return next;
    }
  }

  return null;
}

function normalizeMessageText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUrls(value: string | null | undefined) {
  return String(value || "").match(/https?:\/\/\S+/gi) || [];
}

function detectBrands(value: string | null | undefined) {
  const text = normalizeMessageText(value);
  const brands = new Set<string>();
  if (/(^| )(iphone|apple|ipad|macbook)( |$)/.test(text)) brands.add("apple");
  if (/(^| )(samsung|galaxy)( |$)/.test(text)) brands.add("samsung");
  if (/(^| )(motorola|moto)( |$)/.test(text)) brands.add("motorola");
  if (/(^| )(xiaomi|xaomi|xiami)( |$)/.test(text)) brands.add("xiaomi");
  if (/(^| )(redmi|rexmi|redmy|poco)( |$)/.test(text)) brands.add("redmi");
  if (/(^| )(google|pixel)( |$)/.test(text)) brands.add("google");
  if (/(^| )(jbl)( |$)/.test(text)) brands.add("jbl");
  return [...brands];
}

function extractRequestedStorage(value: string | null | undefined) {
  const text = normalizeMessageText(value);
  const exactMatch = text.match(/\b(64|128|256|512|1024)\b(?:\s*gb)?\b/);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  const approximateMatch =
    text.match(/\b(\d{2,4})\b(?=(?:\s*gb)?\s*(?:de\s+)?(?:memo\w*|almacen\w*|giga\w*|gb)\b)/i) ||
    text.match(/(?:memo\w*|almacen\w*|giga\w*|gb)\s*(?:de\s*)?\b(\d{2,4})\b/i);

  if (!approximateMatch) {
    return null;
  }

  const valueNum = Number(approximateMatch[1]);
  if (!Number.isFinite(valueNum)) {
    return null;
  }
  if (valueNum >= 60 && valueNum <= 70) return 64;
  if (valueNum >= 118 && valueNum <= 138) return 128;
  if (valueNum >= 240 && valueNum <= 270) return 256;
  if (valueNum >= 480 && valueNum <= 540) return 512;
  if (valueNum >= 950 && valueNum <= 1100) return 1024;
  return null;
}

function extractRequestedRam(value: string | null | undefined) {
  const text = normalizeMessageText(value);
  const ramMatch =
    text.match(/\b(4|6|8|12|16)\b(?=(?:\s*gb)?\s*(?:de\s+)?ram\b)/i) ||
    text.match(/\bram\s*(?:de\s*)?\b(4|6|8|12|16)\b(?:\s*gb)?/i) ||
    text.match(/\b(4|6|8|12|16)\s*gb\s*ram\b/i);

  return ramMatch ? Number(ramMatch[1]) : null;
}

function detectConversationFlags(messages: MessageRow[]) {
  const flags = new Set<string>();
  const details: string[] = [];

  for (let index = 1; index < messages.length; index += 1) {
    const prev = messages[index - 1];
    const current = messages[index];
    if (prev.direction !== "outbound" || current.direction !== "outbound") {
      continue;
    }

    const prevText = normalizeMessageText(prev.text_body ?? prev.transcript);
    const currentText = normalizeMessageText(current.text_body ?? current.transcript);
    if (!prevText || prevText !== currentText) {
      continue;
    }

    const prevAt = Date.parse(prev.created_at);
    const currentAt = Date.parse(current.created_at);
    if (Number.isFinite(prevAt) && Number.isFinite(currentAt) && currentAt - prevAt <= 8000) {
      flags.add("possible_duplicate_bot_send");
      details.push(
        `Possible duplicate bot send: outbound messages ${prev.id} and ${current.id} are identical within ${Math.round((currentAt - prevAt) / 1000)}s.`
      );
    }
  }

  for (const message of messages) {
    if (message.direction !== "outbound") {
      continue;
    }

    const text = String(message.text_body ?? message.transcript ?? "");
    if (/(bancarizada|macro|naranja)[^.\n]{0,40}:\s*\d{2,4}(?![.\d])/i.test(text)) {
      flags.add("possible_broken_financing_amount");
      details.push(`Broken financing amount pattern in outbound message ${message.id}.`);
    }

    if (/(plan canje|permuta|parte de pago|toma de usado)/i.test(text) && /(caso a caso|lo vemos|se evalua|se evalúa)/i.test(text)) {
      flags.add("possible_trade_in_policy_violation");
      details.push(`Possible trade-in policy violation in outbound message ${message.id}.`);
    }

    if (text.length > 1100) {
      flags.add("bot_message_over_length_limit");
      details.push(`Outbound message ${message.id} exceeds 1100 characters.`);
    }

    if (
      !extractUrls(text).length &&
      /(?:m[aá]s\s+info|m[aá]s\s+detalles|link|pod[eé]s\s+verlo|lo\s+pod[eé]s\s+ver|ver\s+todos\s+sus\s+detalles|toda\s+la\s+informaci[oó]n|foto|fotos)\s*:?/i.test(
        text
      )
    ) {
      flags.add("possible_missing_url_after_cta");
      details.push(`Missing URL after CTA in outbound message ${message.id}.`);
    }

    if (extractUrls(text).some((url) => /(?:test|random|placeholder|dummy|demo|sample)/i.test(url))) {
      flags.add("possible_test_or_placeholder_url");
      details.push(`Unsafe catalog URL detected in outbound message ${message.id}.`);
    }

    if (/(bitcoin|usdt|crypto|criptomon)/i.test(text)) {
      flags.add("possible_unsupported_crypto_claim");
      details.push(`Unsupported crypto/payment mention in outbound message ${message.id}.`);
    }
  }

  for (let index = 0; index < messages.length; index += 1) {
    const inbound = messages[index];
    const outbound = messages[index + 1];
    if (!inbound || !outbound) {
      continue;
    }
    if (inbound.direction !== "inbound" || outbound.direction !== "outbound") {
      continue;
    }

    const inboundText = String(inbound.text_body ?? inbound.transcript ?? "");
    const outboundText = String(outbound.text_body ?? outbound.transcript ?? "");
    const inboundNormalized = normalizeMessageText(inboundText);
    const outboundNormalized = normalizeMessageText(outboundText);
    const requestedBrands = detectBrands(inboundText);
    const answeredBrands = detectBrands(outboundText);

    if (
      requestedBrands.length > 0 &&
      answeredBrands.length > 0 &&
      !requestedBrands.some((brand) => answeredBrands.includes(brand)) &&
      /(https?:\/\/|lo pod[eé]s ver ac[aá]|link)/i.test(outboundText)
    ) {
      flags.add("possible_brand_mismatch");
      details.push(
        `Brand mismatch risk: inbound ${inbound.id} asks for ${requestedBrands.join(", ")} but outbound ${outbound.id} points to ${answeredBrands.join(", ")}.`
      );
    }

    const requestedStorage = extractRequestedStorage(inboundText);
    const requestedRam = extractRequestedRam(inboundText);
    if (requestedStorage != null && !new RegExp(`\\b${requestedStorage}\\s*gb\\b`, "i").test(outboundNormalized)) {
      if (/(no|sin|no hay|no veo|no está|no esta)/i.test(outboundNormalized) === false) {
        flags.add("possible_storage_variant_mismatch");
        details.push(
          `Storage mismatch risk: inbound ${inbound.id} asks for ${requestedStorage}GB but outbound ${outbound.id} does not mention that variant.`
        );
      }
    }
    if (requestedRam != null && !new RegExp(`(?:\\b${requestedRam}\\s*gb\\s*ram\\b|\\bram\\s*${requestedRam}\\b)`, "i").test(outboundNormalized)) {
      if (/(no|sin|no hay|no veo|no está|no esta)/i.test(outboundNormalized) === false) {
        flags.add("possible_ram_variant_mismatch");
        details.push(
          `RAM mismatch risk: inbound ${inbound.id} asks for ${requestedRam}GB RAM but outbound ${outbound.id} does not mention that variant.`
        );
      }
    }

    if (/(cuota|cuotas|financi|naranja|macro|tarjeta)/i.test(inboundNormalized)) {
      const hasConcreteFinancing =
        /cuotas?\s+de\s+ars/i.test(outboundText) || /(bancarizada|macro)/i.test(outboundText);
      const soundsEvasive = /(sucursal|confirman|te confirman|te dicen|lo vemos|al pagar)/i.test(outboundText);
      if (!hasConcreteFinancing && soundsEvasive) {
        flags.add("possible_evasive_financing_answer");
        details.push(
          `Financing question may have been answered evasively: inbound ${inbound.id}, outbound ${outbound.id}.`
        );
      }
    }

    if (/(foto|fotos|imagen|imagenes|como se ve|mostrame|mandame foto|mandame imagen)/i.test(inboundNormalized)) {
      if (!extractUrls(outboundText).length) {
        flags.add("possible_image_request_not_fulfilled");
        details.push(`Image/photo request in inbound ${inbound.id} answered without URL or asset in outbound ${outbound.id}.`);
      }
    }

    if (/(gracias|muchas gracias|perfecto|listo|joya)/i.test(inboundNormalized)) {
      if (normalizeMessageText(outboundText) && extractUrls(outboundText).length > 0) {
        flags.add("possible_redundant_followup_after_close");
        details.push(`Outbound message ${outbound.id} repeats a URL/link right after a user closing signal in inbound ${inbound.id}.`);
      }
    }
  }

  return {
    flags: [...flags],
    details,
  };
}

function buildConversationInput(conversation: ConversationRow, messages: MessageRow[]): ConversationReviewInput {
  const routeKeys = new Set<string>();
  const summaries = new Set<string>();
  const validationErrors = new Set<string>();
  const validationWarnings = new Set<string>();
  const conversationDiagnostics = detectConversationFlags(messages);

  for (const message of messages) {
    if (message.direction !== "outbound" || !message.payload || typeof message.payload !== "object") {
      continue;
    }

    const routeKey = String(message.payload.route_key ?? "").trim();
    if (routeKey) {
      routeKeys.add(routeKey);
    }

    const summary = String(message.payload.conversation_summary ?? "").trim();
    if (summary) {
      summaries.add(summary);
    }

    const rawErrors = Array.isArray(message.payload.validation_errors) ? message.payload.validation_errors : [];
    for (const item of rawErrors) {
      const next = String(item || "").trim();
      if (next) {
        validationErrors.add(next);
      }
    }

    const rawWarnings = Array.isArray(message.payload.validation_warnings) ? message.payload.validation_warnings : [];
    for (const item of rawWarnings) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const next = String((item as { code?: unknown }).code ?? "").trim();
      if (next) {
        validationWarnings.add(next);
      }
    }
  }

  const customerName =
    [conversation.first_name, conversation.last_name].filter(Boolean).join(" ").trim() ||
    conversation.title ||
    `Conversation ${conversation.id}`;

  return {
    conversation_id: conversation.id,
    channel_thread_key: conversation.channel_thread_key,
    customer_name: customerName,
    customer_phone: conversation.phone,
    started_at: conversation.created_at,
    last_message_at: conversation.last_message_at,
    inbound_count: Number(conversation.inbound_count || 0),
    outbound_count: Number(conversation.outbound_count || 0),
    auto_flags: conversationDiagnostics.flags,
    auto_flag_details: conversationDiagnostics.details.slice(0, 12),
    route_keys_seen: [...routeKeys],
    workflow_summaries_seen: [...summaries].slice(0, 5),
    validation_errors_seen: [...validationErrors],
    validation_warnings_seen: [...validationWarnings],
    messages: messages.map((message) => ({
      message_id: message.id,
      created_at: message.created_at,
      role:
        message.direction === "inbound"
          ? "customer"
          : message.sender_kind === "tool"
            ? "bot"
            : message.sender_kind,
      message_type: message.message_type,
      text: String(message.text_body ?? message.transcript ?? "").trim(),
    })),
  };
}

function buildFallbackWorkflowContext(): WorkflowReviewContext {
  const compactText = [
    "Workflow JSONs (n8n v18) no están montados en este proceso: revisá sin el texto completo de los nodos.",
    "Comportamiento esperable del bot TechnoStore v18: router → context builder con candidate_products del catálogo → sales/info responders → validator → state update.",
    "Priorizá en la revisión: precios y cuotas alineados a datos del catálogo, sin inventar stock ni links, políticas (sin DNI, canje, crypto, etc.), tono, cierre, exactitud de variante (RAM/memoria/color) y manejo de pedidos de imagen/foto.",
  ].join("\n\n");

  return {
    repoDir: "(workflow files not mounted)",
    repoCommitSha: null,
    files: [],
    compactText,
  };
}

async function loadWorkflowReviewContext(): Promise<WorkflowReviewContext> {
  const repoDir = pickReviewRepoDir();
  if (!repoDir) {
    return buildFallbackWorkflowContext();
  }

  const files = await Promise.all(
    WORKFLOW_FILES.map(async (relativePath) => {
      const fullPath = resolve(repoDir, relativePath);
      const raw = await readFile(fullPath, "utf8");
      const parsed = JSON.parse(raw) as {
        name?: string;
        nodes?: Array<{
          name?: string;
          type?: string;
          parameters?: Record<string, unknown>;
        }>;
      };

      const nodes = Array.isArray(parsed.nodes)
        ? parsed.nodes.flatMap((node) => {
            const sections: WorkflowReviewNode[] = [];
            const parameters = node?.parameters ?? {};
            const name = String(node?.name || "Unnamed node");
            const type = String(node?.type || "");
            const systemMessage = typeof parameters.systemMessage === "string" ? parameters.systemMessage.trim() : "";
            const jsCode = typeof parameters.jsCode === "string" ? parameters.jsCode.trim() : "";

            if (systemMessage) {
              sections.push({
                name,
                type,
                systemMessage,
              });
            }

            if (jsCode) {
              sections.push({
                name,
                type,
                jsCode,
              });
            }

            return sections;
          })
        : [];

      return {
        file: relativePath,
        workflowName: String(parsed.name || relativePath),
        nodes,
      };
    })
  );

  let repoCommitSha: string | null = null;
  try {
    repoCommitSha = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    repoCommitSha = null;
  }

  const compactText = files
    .map((file) => {
      const sections = file.nodes
        .map((node) => {
          const parts = [`Node: ${node.name}`, `Type: ${node.type}`];
          if (node.systemMessage) {
            parts.push(`System Message:\n${node.systemMessage}`);
          }
          if (node.jsCode) {
            parts.push(`Code:\n${node.jsCode}`);
          }
          return parts.join("\n");
        })
        .join("\n\n");

      return [`Workflow File: ${file.file}`, `Workflow Name: ${file.workflowName}`, sections].filter(Boolean).join("\n\n");
    })
    .join("\n\n====================\n\n");

  return {
    repoDir,
    repoCommitSha,
    files,
    compactText,
  };
}

function buildReviewerMessages(params: {
  workflowContext: WorkflowReviewContext;
  conversations: ConversationReviewInput[];
}) {
  const systemPrompt = [
    "Sos el reviewer QA del bot comercial de TechnoStore.",
    "Evaluás conversaciones reales contra el comportamiento esperado de los workflows v18.",
    "Priorizá errores concretos: precio, cuotas, políticas, producto equivocado, variante equivocada (RAM/memoria/color), links rotos, pedidos de imagen mal resueltos, duplicados, alucinaciones, tono flojo, cierre flojo, mala ruta, fallas del validator o timing.",
    "No seas complaciente: si algo está mal, marcá el problema aunque la venta parezca razonable.",
    "Si un problema parece venir de políticas del negocio, prompt del sales responder, normalización, routing, validator, timing del workflow o datos de catálogo, decilo explícitamente en root_cause_area.",
    "Tomá los auto_flags y auto_flag_details como señales de alto valor. No los copies ciegamente: confirmalos contra los mensajes antes de usarlos.",
    "Si auto_flags marca possible_missing_url_after_cta, possible_test_or_placeholder_url, possible_brand_mismatch, possible_ram_variant_mismatch, possible_storage_variant_mismatch, possible_evasive_financing_answer o possible_duplicate_bot_send, investigalo con prioridad.",
    "En suggested_fix, proponé el cambio más probable y accionable: routing, validator, sales_prompt, workflow_timing, catalog_data o policy_copy.",
    "Respondé SOLO JSON válido.",
  ].join(" ");

  const userPrompt = [
    "Revisá este lote de conversaciones comerciales.",
    "Tenés acceso al contexto extraído de los workflows v18 actuales para entender qué debería hacer el bot.",
    "Entregá este esquema exacto:",
    JSON.stringify(
      {
        batch_summary: {
          overall_score_0_100: 0,
          conversations_with_issues: 0,
          top_issue_types: [{ type: "pricing_error", count: 0 }],
          urgent_findings: ["string"],
          recommended_changes: [
            {
              priority: "high",
              area: "sales_responder",
              change: "string",
              reason: "string",
            },
          ],
          notable_wins: ["string"],
        },
        items: [
          {
            conversation_id: 0,
            score_0_100: 0,
            verdict: "good",
            severity: "low",
            issue_types: ["pricing_error"],
            what_went_wrong: "string",
            root_cause_area: "sales_prompt",
            suggested_fix: "string",
            evidence: [{ message_id: 0, quote: "string" }],
          },
        ],
      },
      null,
      2
    ),
    "Issue types válidos sugeridos: pricing_error, financing_error, policy_error, wrong_product_match, duplicate_send, tone_problem, weak_closing, hallucination, routing_error, validator_gap, workflow_timing, catalog_data_gap.",
    "Root cause areas válidas sugeridas: routing, sales_prompt, sales_normalizer, info_responder, validator, workflow_timing, catalog_data, policy_copy, unknown.",
    "Reglas extra de evaluación:",
    "- Si el usuario pide cuotas y el bot no da cuotas concretas pese a que la conversación sugiere que debería poder hacerlo, considerá financing_error o validator_gap.",
    "- Si el usuario pide foto/imagen y el bot manda home/storefront cuando ya había producto puntual, eso es weak_closing o validator_gap, y a veces wrong_product_match si además desvía el producto.",
    "- Si el usuario pide una variante concreta (ej. 8GB, 512GB, color) y el bot responde otra sin aclararlo, marcá wrong_product_match.",
    "- Si el bot promete 'Más info', 'Link', 'Lo podés ver acá' o similar sin URL real, marcá validator_gap.",
    "- Si aparece una URL test/random/placeholder, marcá catalog_data_gap y probablemente hallucination o validator_gap según corresponda.",
    "- Si hay respuestas casi iguales dentro de pocos segundos o justo después de un 'gracias', marcá duplicate_send o workflow_timing.",
    "Marcá una conversación como good solo si está realmente bien resuelta.",
    "Workflow context:",
    params.workflowContext.compactText,
    "Conversations to review:",
    JSON.stringify(params.conversations, null, 2),
  ].join("\n\n");

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

async function callOllamaReviewer(workflowContext: WorkflowReviewContext, conversations: ConversationReviewInput[]) {
  const messages = buildReviewerMessages({ workflowContext, conversations }) as Array<{
    role: "system" | "user";
    content: string;
  }>;

  const { content } = await ollamaChat({
    model: reviewerModelLabel(),
    messages,
    format: "json",
    temperature: 0.1,
    numPredict: 8192,
  });

  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Ollama reviewer returned empty content.");
  }

  try {
    return JSON.parse(trimmed) as ReviewerResult;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as ReviewerResult;
    }
    throw new Error("Ollama reviewer returned non-JSON content.");
  }
}

function buildBatchMarkdown(batchId: number, summary: ReviewerBatchSummary, items: ReviewerItem[]) {
  const issueCounts = new Map<string, number>();
  for (const item of items) {
    for (const issueType of item.issue_types || []) {
      issueCounts.set(issueType, (issueCounts.get(issueType) || 0) + 1);
    }
  }

  const topIssues = [...issueCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([type, count]) => `- ${type}: ${count}`);

  const worstItems = [...items]
    .sort((left, right) => left.score_0_100 - right.score_0_100)
    .slice(0, 5)
    .map(
      (item) =>
        `- Conversation ${item.conversation_id}: ${item.score_0_100}/100 · ${item.issue_types.join(", ") || "sin issue_types"} · ${item.suggested_fix}`
    );

  const recommendedChanges = (summary.recommended_changes || [])
    .slice(0, 5)
    .map(
      (change, index) =>
        `${index + 1}. [${String(change.priority || "medium").toUpperCase()}] ${String(change.area || "unknown")}: ${String(change.change || "").trim()}`
    );

  return [
    `# Conversation Review Batch ${batchId}`,
    "",
    `Overall score: ${Number(summary.overall_score_0_100 || 0)}/100`,
    `Conversations reviewed: ${items.length}`,
    `Conversations with issues: ${Number(summary.conversations_with_issues || 0)}`,
    "",
    "## Top Issues",
    ...(topIssues.length > 0 ? topIssues : ["- No repeated issue types detected."]),
    "",
    "## Recommended Changes",
    ...(recommendedChanges.length > 0 ? recommendedChanges : ["1. No recommended changes returned by the reviewer."]),
    "",
    "## Worst Conversations",
    ...(worstItems.length > 0 ? worstItems : ["- No low-scoring conversations in this batch."]),
    "",
    "## Urgent Findings",
    ...((summary.urgent_findings || []).length > 0 ? (summary.urgent_findings || []).map((line) => `- ${line}`) : ["- None."]),
  ].join("\n");
}

function buildTelegramSummary(batchId: number, summary: ReviewerBatchSummary, items: ReviewerItem[]) {
  const repeatedIssues = (summary.top_issue_types || [])
    .slice(0, 4)
    .map((entry) => `- ${entry.type}: ${entry.count}`)
    .join("\n");

  const worstItems = [...items]
    .sort((left, right) => left.score_0_100 - right.score_0_100)
    .slice(0, 3)
    .map(
      (item) =>
        `- Conv ${item.conversation_id}: ${item.score_0_100}/100 · ${item.issue_types.join(", ") || "sin issue_types"} · ${String(item.root_cause_area || "unknown")} · ${String(item.suggested_fix || "sin fix").trim()}`
    )
    .join("\n");

  const recommendedChanges = (summary.recommended_changes || [])
    .slice(0, 3)
    .map((entry, index) => `${index + 1}. ${String(entry.area || "unknown")}: ${String(entry.change || "").trim()}`)
    .join("\n");

  return [
    `Conversation review batch #${batchId}`,
    `Score general: ${Number(summary.overall_score_0_100 || 0)}/100`,
    `Conversaciones revisadas: ${items.length}`,
    `Con problemas: ${Number(summary.conversations_with_issues || 0)}`,
    "",
    "Top problemas:",
    repeatedIssues || "- Sin problemas repetidos.",
    "",
    "Peores conversaciones:",
    worstItems || "- Ninguna marcada como problemática.",
    "",
    "Cambios recomendados:",
    recommendedChanges || "1. Sin cambios recomendados por el reviewer.",
  ].join("\n");
}

async function fetchEligibleConversations(
  client: PoolClient,
  limit: number,
  idleMinutes: number,
  force: boolean
) {
  const rows = (
    await client.query<ConversationRow>(
      `
        select
          c.id,
          c.channel_thread_key,
          c.status,
          c.title,
          c.created_at,
          c.updated_at,
          c.last_message_at,
          cu.id as customer_id,
          cu.first_name,
          cu.last_name,
          cu.phone,
          count(*) filter (where m.direction = 'inbound' and m.sender_kind = 'customer')::int as inbound_count,
          count(*) filter (where m.direction = 'outbound' and m.sender_kind in ('tool', 'agent', 'admin'))::int as outbound_count
        from public.conversations c
        join public.messages m on m.conversation_id = c.id
        left join public.customers cu on cu.id = c.customer_id
        where c.channel = 'manychat'
          and (
            $2::boolean = true
            or coalesce(c.last_message_at, c.updated_at, c.created_at) <= now() - make_interval(mins => $1)
          )
          and not exists (
            select 1
            from public.conversation_review_items cri
            where cri.conversation_id = c.id
          )
        group by c.id, cu.id
        having
          count(*) filter (where m.direction = 'inbound' and m.sender_kind = 'customer') > 0
          and count(*) filter (where m.direction = 'outbound' and m.sender_kind in ('tool', 'agent', 'admin')) > 0
        order by coalesce(c.last_message_at, c.updated_at, c.created_at) asc, c.id asc
        limit $3
      `,
      [idleMinutes, force, limit]
    )
  ).rows;

  if (rows.length === 0) {
    return [];
  }

  const conversationIds = rows.map((row) => row.id);
  const messageRows = (
    await client.query<MessageRow>(
      `
        select
          conversation_id,
          id,
          direction,
          sender_kind,
          message_type,
          text_body,
          transcript,
          payload,
          created_at
        from public.messages
        where conversation_id = any($1::bigint[])
        order by conversation_id asc, created_at asc, id asc
      `,
      [conversationIds]
    )
  ).rows;

  const groupedMessages = new Map<number, MessageRow[]>();
  for (const row of messageRows) {
    const list = groupedMessages.get(row.conversation_id) || [];
    list.push(row);
    groupedMessages.set(row.conversation_id, list);
  }

  return rows.map((row) => buildConversationInput(row, groupedMessages.get(row.id) || []));
}

async function fetchConversationsByIds(client: PoolClient, conversationIds: number[]) {
  if (conversationIds.length === 0) {
    return [];
  }

  const rows = (
    await client.query<ConversationRow>(
      `
        select
          c.id,
          c.channel_thread_key,
          c.status,
          c.title,
          c.created_at,
          c.updated_at,
          c.last_message_at,
          cu.id as customer_id,
          cu.first_name,
          cu.last_name,
          cu.phone,
          count(*) filter (where m.direction = 'inbound' and m.sender_kind = 'customer')::int as inbound_count,
          count(*) filter (where m.direction = 'outbound' and m.sender_kind in ('tool', 'agent', 'admin'))::int as outbound_count
        from public.conversations c
        join public.messages m on m.conversation_id = c.id
        left join public.customers cu on cu.id = c.customer_id
        where c.id = any($1::bigint[])
          and c.channel = 'manychat'
        group by c.id, cu.id
        having
          count(*) filter (where m.direction = 'inbound' and m.sender_kind = 'customer') > 0
          and count(*) filter (where m.direction = 'outbound' and m.sender_kind in ('tool', 'agent', 'admin')) > 0
        order by array_position($1::bigint[], c.id::bigint) asc
      `,
      [conversationIds]
    )
  ).rows;

  if (rows.length === 0) {
    return [];
  }

  const messageRows = (
    await client.query<MessageRow>(
      `
        select
          conversation_id,
          id,
          direction,
          sender_kind,
          message_type,
          text_body,
          transcript,
          payload,
          created_at
        from public.messages
        where conversation_id = any($1::bigint[])
        order by conversation_id asc, created_at asc, id asc
      `,
      [conversationIds]
    )
  ).rows;

  const groupedMessages = new Map<number, MessageRow[]>();
  for (const row of messageRows) {
    const list = groupedMessages.get(row.conversation_id) || [];
    list.push(row);
    groupedMessages.set(row.conversation_id, list);
  }

  return rows.map((row) => buildConversationInput(row, groupedMessages.get(row.id) || []));
}

export async function getConversationReviewCandidates(limit: number) {
  const client = await pool.connect();

  try {
    const safeLimit = Math.max(1, Math.min(100, limit));
    const items = await fetchEligibleConversations(client, safeLimit, config.CONVERSATION_REVIEW_IDLE_MINUTES, false);
    return items.map((item) => {
      const lastCustomerMessage = [...item.messages].reverse().find((message) => message.role === "customer");
      const lastBotMessage = [...item.messages].reverse().find((message) => message.role === "bot");

      return {
        conversation_id: item.conversation_id,
        customer_name: item.customer_name,
        customer_phone: item.customer_phone,
        started_at: item.started_at,
        last_message_at: item.last_message_at,
        inbound_count: item.inbound_count,
        outbound_count: item.outbound_count,
        auto_flags: item.auto_flags,
        route_keys_seen: item.route_keys_seen,
        last_customer_message: lastCustomerMessage?.text ?? "",
        last_bot_message: lastBotMessage?.text ?? "",
      };
    });
  } finally {
    client.release();
  }
}

async function createBatchRecord(client: PoolClient, params: {
  triggeredBy: string;
  workflowContext: WorkflowReviewContext;
  conversations: ConversationReviewInput[];
}) {
  const rows = await client.query<{ id: number }>(
    `
      insert into public.conversation_review_batches (
        status,
        triggered_by,
        workflow_version,
        model_name,
        repo_dir,
        repo_commit_sha,
        conversation_count,
        conversation_ids,
        workflow_context
      ) values (
        'pending',
        $1,
        'v18',
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7::jsonb
      )
      returning id
    `,
    [
      params.triggeredBy,
      `ollama:${reviewerModelLabel()}`,
      params.workflowContext.repoDir,
      params.workflowContext.repoCommitSha,
      params.conversations.length,
      JSON.stringify(params.conversations.map((conversation) => conversation.conversation_id)),
      JSON.stringify({
        repo_dir: params.workflowContext.repoDir,
        repo_commit_sha: params.workflowContext.repoCommitSha,
        files: params.workflowContext.files,
      }),
    ]
  );

  return rows.rows[0].id;
}

async function markBatchFailed(client: PoolClient, batchId: number, error: string) {
  await client.query(
    `
      update public.conversation_review_batches
      set
        status = 'failed',
        failure_message = $2,
        reviewed_at = now()
      where id = $1
    `,
    [batchId, error]
  );
}

async function persistCompletedBatch(client: PoolClient, params: {
  batchId: number;
  result: ReviewerResult;
  markdown: string;
  deliveredChatIds: string[];
}) {
  for (const item of params.result.items) {
    await client.query(
      `
        insert into public.conversation_review_items (
          batch_id,
          conversation_id,
          score,
          verdict,
          severity,
          issue_types,
          root_cause_area,
          what_went_wrong,
          suggested_fix,
          evidence,
          raw_analysis
        ) values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6::jsonb,
          $7,
          $8,
          $9,
          $10::jsonb,
          $11::jsonb
        )
      `,
      [
        params.batchId,
        item.conversation_id,
        Math.max(0, Math.min(100, Number(item.score_0_100 || 0))),
        item.verdict || null,
        item.severity || null,
        JSON.stringify(item.issue_types || []),
        item.root_cause_area || null,
        item.what_went_wrong || null,
        item.suggested_fix || null,
        JSON.stringify(item.evidence || []),
        JSON.stringify(item),
      ]
    );
  }

  await client.query(
    `
      update public.conversation_review_batches
      set
        status = 'completed',
        overall_score = $2,
        summary_json = $3::jsonb,
        summary_markdown = $4,
        telegram_chat_ids = $5::jsonb,
        telegram_delivered_at = case when jsonb_array_length($5::jsonb) > 0 then now() else null end,
        reviewed_at = now()
      where id = $1
    `,
    [
      params.batchId,
      Math.max(0, Math.min(100, Number(params.result.batch_summary.overall_score_0_100 || 0))),
      JSON.stringify(params.result.batch_summary || {}),
      params.markdown,
      JSON.stringify(params.deliveredChatIds),
    ]
  );
}

async function deliverBatchToTelegram(summaryText: string, logger: LoggerLike) {
  const chatIds = getReviewTargetChatIds();
  if (!config.TELEGRAM_BOT_TOKEN || chatIds.length === 0) {
    return [];
  }

  const delivered: string[] = [];
  for (const chatId of chatIds) {
    try {
      await sendTelegramTextMessages({
        botToken: config.TELEGRAM_BOT_TOKEN,
        chatId,
        text: summaryText,
      });
      delivered.push(chatId);
    } catch (error) {
      logger.error({ chatId, error }, "Failed to deliver conversation review batch to Telegram.");
    }
  }

  return delivered;
}

export async function runConversationReviewCycle(logger: LoggerLike, options: RunOptions = {}): Promise<RunResult> {
  if (!isReviewerEnabled() && !isManualReviewTrigger(options)) {
    logger.info(
      {
        triggeredBy: options.triggeredBy || "cron",
        enabled: config.CONVERSATION_REVIEW_ENABLED,
      },
      "Conversation review cycle skipped because reviewer is disabled."
    );
    return { status: "disabled", reason: "conversation_reviewer_not_configured" };
  }

  const client = await pool.connect();
  let batchId: number | null = null;

  try {
    const lockResult = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [REVIEW_LOCK_KEY]);
    if (!lockResult.rows[0]?.locked) {
      return { status: "busy" };
    }

    const workflowContext = await loadWorkflowReviewContext();
    const limit = Math.max(1, options.limit ?? config.CONVERSATION_REVIEW_BATCH_SIZE);
    const requestedConversationIds = [...new Set((options.conversationIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
    const conversations =
      requestedConversationIds.length > 0
        ? await fetchConversationsByIds(client, requestedConversationIds)
        : await fetchEligibleConversations(client, limit, config.CONVERSATION_REVIEW_IDLE_MINUTES, options.force === true);

    if (conversations.length === 0) {
      logger.info(
        {
          triggeredBy: options.triggeredBy || "cron",
        },
        "Conversation review cycle skipped because there are no eligible ManyChat conversations."
      );
      return { status: "skipped", reason: "no_eligible_conversations", available: 0 };
    }

    batchId = await createBatchRecord(client, {
      triggeredBy: options.triggeredBy || "cron",
      workflowContext,
      conversations,
    });

    const reviewResult = await callOllamaReviewer(workflowContext, conversations);
    const markdown = buildBatchMarkdown(batchId, reviewResult.batch_summary || {}, reviewResult.items || []);
    const telegramSummary = buildTelegramSummary(batchId, reviewResult.batch_summary || {}, reviewResult.items || []);
    const deliveredChatIds = await deliverBatchToTelegram(telegramSummary, logger);

    await persistCompletedBatch(client, {
      batchId,
      result: reviewResult,
      markdown,
      deliveredChatIds,
    });

    logger.info(
      { batchId, conversationCount: conversations.length, deliveredChatIds },
      "Conversation review batch completed."
    );

    return {
      status: "completed",
      batchId,
      conversationCount: conversations.length,
    };
  } catch (error) {
    if (batchId != null) {
      const message = error instanceof Error ? error.message : "Unknown conversation review error";
      await markBatchFailed(client, batchId, message);
    }
    throw error;
  } finally {
    try {
      await client.query("select pg_advisory_unlock($1)", [REVIEW_LOCK_KEY]);
    } catch {}
    client.release();
  }
}

export function startConversationReviewScheduler(logger: LoggerLike) {
  if (reviewIntervalHandle) {
    return;
  }

  if (!config.CONVERSATION_REVIEW_ENABLED) {
    logger.info(
      {
        enabled: config.CONVERSATION_REVIEW_ENABLED,
        batchSize: config.CONVERSATION_REVIEW_BATCH_SIZE,
        idleMinutes: config.CONVERSATION_REVIEW_IDLE_MINUTES,
        reviewRecipients: getReviewTargetChatIds(),
      },
      "Conversation review scheduler is disabled. Set CONVERSATION_REVIEW_ENABLED=true to turn it on."
    );
    return;
  }

  const intervalMs = Math.max(1, config.CONVERSATION_REVIEW_INTERVAL_MINUTES) * 60_000;

  const runScheduled = () => {
    void runConversationReviewCycle(logger, { triggeredBy: "cron" })
      .then((result) => {
        if (result.status === "completed") {
          return;
        }

        logger.info({ result }, "Conversation review cron cycle did not produce a batch.");
      })
      .catch((error) => {
        logger.error({ error }, "Conversation review cron cycle failed.");
      });
  };

  reviewIntervalHandle = setInterval(runScheduled, intervalMs);
  setTimeout(runScheduled, 15_000);

  logger.info(
    {
      intervalMinutes: config.CONVERSATION_REVIEW_INTERVAL_MINUTES,
      batchSize: config.CONVERSATION_REVIEW_BATCH_SIZE,
      idleMinutes: config.CONVERSATION_REVIEW_IDLE_MINUTES,
      reviewRecipients: getReviewTargetChatIds(),
    },
    "Conversation review scheduler started."
  );
}

export function stopConversationReviewScheduler() {
  if (!reviewIntervalHandle) {
    return;
  }

  clearInterval(reviewIntervalHandle);
  reviewIntervalHandle = null;
}
