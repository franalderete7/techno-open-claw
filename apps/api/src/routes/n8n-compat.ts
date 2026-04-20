import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import { query } from "../db.js";
import { config } from "../config.js";

const routesDir = dirname(fileURLToPath(import.meta.url));
/** Repo root: .../apps/api/src/routes → four levels up */
const repoRoot = resolve(routesDir, "../../../..");

function loadPricelistText(): { text: string; source: string } {
  const explicit = config.TECHNO_PRICELIST_PATH?.trim();
  const defaultPath = resolve(repoRoot, "data/techno-pricelist-abril.md");
  const tryPaths: Array<{ abs: string; label: string }> = [];

  if (explicit) {
    const abs = explicit.startsWith("/") ? explicit : resolve(process.cwd(), explicit);
    tryPaths.push({ abs, label: explicit });
  }
  tryPaths.push({ abs: defaultPath, label: "data/techno-pricelist-abril.md" });

  for (const { abs, label } of tryPaths) {
    if (abs && existsSync(abs)) {
      return { text: readFileSync(abs, "utf8"), source: label };
    }
  }

  return { text: "", source: "none" };
}

type NotesState = {
  tags: string[];
  leadScore: number;
  lastIntent: string | null;
  funnelStage: string | null;
  interestedProduct: string | null;
  paymentMethodLast: string | null;
  brandsMentioned: string[];
  lastBotInteraction: string | null;
};

function parseNotesState(notes: string | null): NotesState {
  const state: NotesState = {
    tags: [],
    leadScore: 0,
    lastIntent: null,
    funnelStage: null,
    interestedProduct: null,
    paymentMethodLast: null,
    brandsMentioned: [],
    lastBotInteraction: null,
  };

  if (!notes) {
    return state;
  }

  const lines = notes
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("tag:")) {
      state.tags.push(line.slice("tag:".length).trim());
      continue;
    }

    if (line.startsWith("lead_score:")) {
      const value = Number.parseInt(line.slice("lead_score:".length).trim(), 10);
      if (Number.isFinite(value)) {
        state.leadScore = value;
      }
      continue;
    }

    if (line.startsWith("last_intent:")) {
      state.lastIntent = line.slice("last_intent:".length).trim() || null;
      continue;
    }

    if (line.startsWith("funnel_stage:")) {
      state.funnelStage = line.slice("funnel_stage:".length).trim() || null;
      continue;
    }

    if (line.startsWith("interested_product:")) {
      state.interestedProduct = line.slice("interested_product:".length).trim() || null;
      continue;
    }

    if (line.startsWith("payment_method_last:")) {
      state.paymentMethodLast = line.slice("payment_method_last:".length).trim() || null;
      continue;
    }

    if (line.startsWith("brands_mentioned:")) {
      state.brandsMentioned = line
        .slice("brands_mentioned:".length)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      continue;
    }

    if (line.startsWith("last_bot_interaction:")) {
      state.lastBotInteraction = line.slice("last_bot_interaction:".length).trim() || null;
    }
  }

  state.tags = [...new Set(state.tags)];
  state.brandsMentioned = [...new Set(state.brandsMentioned)];

  return state;
}

function buildNotesState(params: { currentNotes: string | null; updates: Record<string, unknown> }) {
  const current = parseNotesState(params.currentNotes);

  if (Array.isArray(params.updates.tags)) {
    current.tags = params.updates.tags.map(String).filter(Boolean);
  }

  if (Number.isFinite(Number(params.updates.lead_score))) {
    current.leadScore = Math.max(0, Math.min(100, Number(params.updates.lead_score)));
  }

  if (params.updates.last_intent !== undefined) {
    current.lastIntent = params.updates.last_intent ? String(params.updates.last_intent) : null;
  }

  if (params.updates.funnel_stage !== undefined) {
    current.funnelStage = params.updates.funnel_stage ? String(params.updates.funnel_stage) : null;
  }

  if (params.updates.interested_product !== undefined) {
    current.interestedProduct = params.updates.interested_product ? String(params.updates.interested_product) : null;
  }

  if (params.updates.payment_method_last !== undefined) {
    current.paymentMethodLast = params.updates.payment_method_last ? String(params.updates.payment_method_last) : null;
  }

  if (Array.isArray(params.updates.brands_mentioned)) {
    current.brandsMentioned = params.updates.brands_mentioned.map(String).filter(Boolean);
  }

  if (params.updates.last_bot_interaction !== undefined) {
    current.lastBotInteraction = params.updates.last_bot_interaction ? String(params.updates.last_bot_interaction) : null;
  }

  const lines = [
    ...[...new Set(current.tags)].map((tag) => `tag:${tag}`),
    `lead_score:${current.leadScore}`,
  ];

  if (current.lastIntent) {
    lines.push(`last_intent:${current.lastIntent}`);
  }

  if (current.funnelStage) {
    lines.push(`funnel_stage:${current.funnelStage}`);
  }

  if (current.interestedProduct) {
    lines.push(`interested_product:${current.interestedProduct}`);
  }

  if (current.paymentMethodLast) {
    lines.push(`payment_method_last:${current.paymentMethodLast}`);
  }

  if (current.brandsMentioned.length > 0) {
    lines.push(`brands_mentioned:${[...new Set(current.brandsMentioned)].join(",")}`);
  }

  if (current.lastBotInteraction) {
    lines.push(`last_bot_interaction:${current.lastBotInteraction}`);
  }

  lines.push(`updated_at:${new Date().toISOString()}`);

  return lines.join("\n");
}

function parsePositiveId(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function defaultStoreFromConfig(): Record<string, unknown> {
  const raw = config.TECHNO_BOT_STORE_JSON?.trim();
  if (!raw) {
    return {
      name: "TechnoStore",
      store_address: null,
      store_phone: null,
      store_hours: null,
      store_website_url: null,
    };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { name: "TechnoStore", raw_store_json_invalid: true };
  }
}

export const n8nCompatRoutes: FastifyPluginAsync = async (app) => {
  app.post("/rpc/upsert_customer", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? body.subscriber_id ?? body.id ?? "").trim();

    if (!manychatId) {
      return reply.code(400).send({ error: "Missing p_manychat_id" });
    }

    const externalRef = `manychat:${manychatId}`;
    const phone = String(body.p_whatsapp_phone ?? body.p_phone ?? body.phone ?? "").trim() || null;
    const firstName = String(body.p_first_name ?? body.first_name ?? "").trim() || null;
    const lastName = String(body.p_last_name ?? body.last_name ?? "").trim() || null;
    const timezone = String(body.p_timezone ?? body.timezone ?? "").trim();

    const existingRows = await query<{ id: number; notes: string | null }>(
      `
        select id, notes
        from public.customers
        where external_ref = $1
           or ($2::text is not null and phone = $2)
        order by case when external_ref = $1 then 0 else 1 end
        limit 1
      `,
      [externalRef, phone]
    );

    const notesUpdate = timezone ? { timezone } : {};
    let customerId: number;

    if (existingRows[0]) {
      customerId = existingRows[0].id;
      const nextNotes = timezone
        ? `${existingRows[0].notes ? `${existingRows[0].notes}\n` : ""}timezone:${timezone}`.trim()
        : existingRows[0].notes;

      await query(
        `
          update public.customers
          set
            external_ref = coalesce(external_ref, $1),
            phone = coalesce($2, phone),
            first_name = coalesce($3, first_name),
            last_name = coalesce($4, last_name),
            notes = $5,
            updated_at = now()
          where id = $6
        `,
        [externalRef, phone, firstName, lastName, nextNotes, customerId]
      );
    } else {
      const rows = await query<{ id: number }>(
        `
          insert into public.customers (
            external_ref,
            phone,
            first_name,
            last_name,
            notes
          ) values ($1, $2, $3, $4, $5)
          returning id
        `,
        [externalRef, phone, firstName, lastName, Object.keys(notesUpdate).length > 0 ? `timezone:${timezone}` : null]
      );

      customerId = rows[0].id;
    }

    return reply.send({
      upsert_customer: customerId,
      customer_id: customerId,
      id: customerId,
    });
  });

  app.post("/conversations", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (body.skip_save === true) {
      return reply.send({
        skipped: true,
        reason: String(body.reason ?? "skip_save"),
      });
    }

    const manychatId = String(body.manychat_id ?? body.subscriber_id ?? "").trim();

    if (!manychatId) {
      return reply.code(400).send({ error: "Missing manychat_id" });
    }

    const customerId = parsePositiveId(body.customer_id);
    const conversationKey = `manychat:${manychatId}`;
    const channel = String(body.channel ?? "manychat").trim() || "manychat";
    const title = String(body.phone ?? body.whatsapp_phone_number_id ?? `ManyChat ${manychatId}`).trim();

    const conversationRows = await query<{ id: number }>(
      `
        insert into public.conversations (
          customer_id,
          channel,
          channel_thread_key,
          status,
          title,
          last_message_at
        ) values ($1, $2, $3, 'open', $4, now())
        on conflict (channel_thread_key)
        do update set
          customer_id = coalesce(excluded.customer_id, public.conversations.customer_id),
          status = 'open',
          title = coalesce(nullif(excluded.title, ''), public.conversations.title),
          last_message_at = now(),
          updated_at = now()
        returning id
      `,
      [customerId, channel, conversationKey, title || null]
    );

    const conversationId = conversationRows[0].id;
    const role = String(body.role ?? "user").trim().toLowerCase();
    const direction = role === "bot" ? "outbound" : "inbound";
    const senderKind = role === "bot" ? "tool" : "customer";
    const rawType = String(body.message_type ?? "text").trim().toLowerCase();
    const messageType =
      rawType === "audio" || rawType === "image" || rawType === "video" || rawType === "file" || rawType === "event"
        ? rawType
        : "text";
    const textBody = String(body.message ?? body.text ?? "").trim() || null;
    const transcript = String(body.audio_transcription ?? "").trim() || null;

    if (role === "bot" && !textBody) {
      return reply.code(400).send({ error: "Missing bot message text" });
    }

    if (direction === "inbound" && senderKind === "customer") {
      const duplicateRows = await query<{ id: number; created_at: string }>(
        `
          select id, created_at
          from public.messages
          where conversation_id = $1
            and direction = 'inbound'
            and sender_kind = 'customer'
            and message_type = $2
            and text_body is not distinct from $3
            and transcript is not distinct from $4
            and created_at >= now() - interval '5 seconds'
          order by created_at desc, id desc
          limit 1
        `,
        [conversationId, messageType, textBody, transcript]
      );

      if (duplicateRows[0]) {
        return reply.send({
          id: duplicateRows[0].id,
          conversation_id: conversationId,
          duplicate: true,
        });
      }
    }

    const rows = await query<{ id: number; created_at: string }>(
      `
        insert into public.messages (
          conversation_id,
          direction,
          sender_kind,
          message_type,
          text_body,
          media_url,
          transcript,
          payload
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning id, created_at
      `,
      [conversationId, direction, senderKind, messageType, textBody, null, transcript, body]
    );

    await query(
      `
        update public.conversations
        set last_message_at = $1, updated_at = now()
        where id = $2
      `,
      [rows[0].created_at, conversationId]
    );

    return reply.send({
      id: rows[0].id,
      conversation_id: conversationId,
      duplicate: false,
    });
  });

  app.post("/rpc/check_is_latest_message", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? "").trim();
    const messageId = Number(body.p_message_id ?? body.message_id);

    if (!manychatId || !Number.isFinite(messageId)) {
      return reply.code(400).send({ error: "Missing p_manychat_id or p_message_id" });
    }

    const rows = await query<{ id: number | string }>(
      `
        select m.id
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
        where c.channel_thread_key = $1
          and m.direction = 'inbound'
          and m.sender_kind = 'customer'
        order by m.created_at desc, m.id desc
        limit 1
      `,
      [`manychat:${manychatId}`]
    );

    const latestRaw = rows[0]?.id;
    const latestMessageId = latestRaw == null || latestRaw === "" ? null : Number(latestRaw);

    const isLatest =
      latestMessageId == null || !Number.isFinite(latestMessageId) ? true : latestMessageId === messageId;

    return reply.send({
      check_is_latest_message: isLatest,
      latest_message_id: latestMessageId,
      checked_message_id: messageId,
    });
  });

  app.post("/rpc/claim_reply_send", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? "").trim();
    const messageId = Number(body.p_message_id ?? body.message_id);

    if (!manychatId || !Number.isFinite(messageId)) {
      return reply.code(400).send({ error: "Missing p_manychat_id or p_message_id" });
    }

    const rows = await query<{ id: number | string }>(
      `
        update public.messages m
        set payload = jsonb_set(
          coalesce(m.payload, '{}'::jsonb),
          '{reply_send_claimed_at}',
          to_jsonb(now()),
          true
        )
        from public.conversations c
        where m.id = $2
          and m.conversation_id = c.id
          and c.channel_thread_key = $1
          and m.direction = 'inbound'
          and m.sender_kind = 'customer'
          and coalesce(m.payload->>'reply_send_claimed_at', '') = ''
        returning m.id
      `,
      [`manychat:${manychatId}`, messageId]
    );

    return reply.send({
      claim_reply_send: rows.length > 0,
      claimed_message_id: rows[0]?.id == null ? null : Number(rows[0].id),
      checked_message_id: messageId,
    });
  });

  app.post("/rpc/v20_build_turn_context", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? "").trim();
    const recentLimit = Math.max(1, Math.min(20, Number(body.p_recent_limit ?? 10) || 10));

    if (!manychatId) {
      return reply.code(400).send({ error: "Missing p_manychat_id" });
    }

    const customerRows = await query<{
      id: number;
      external_ref: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      email: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        select id, external_ref, first_name, last_name, phone, email, notes, created_at, updated_at
        from public.customers
        where external_ref = $1
        limit 1
      `,
      [`manychat:${manychatId}`]
    );

    const customerRow = customerRows[0] ?? null;
    const customerState = parseNotesState(customerRow?.notes ?? null);

    const conversationRows = await query<{ id: number }>(
      `
        select id
        from public.conversations
        where channel_thread_key = $1
        limit 1
      `,
      [`manychat:${manychatId}`]
    );

    const conversationId = conversationRows[0]?.id ?? null;

    const recentMessagesRaw =
      conversationId == null
        ? []
        : await query<{
            id: number;
            direction: string;
            message_type: string;
            text_body: string | null;
            transcript: string | null;
            created_at: string;
          }>(
            `
              select id, direction, message_type, text_body, transcript, created_at
              from public.messages
              where conversation_id = $1
              order by created_at desc, id desc
              limit $2
            `,
            [conversationId, recentLimit]
          );

    const recentChrono = [...recentMessagesRaw].reverse();

    const recent_messages = recentChrono.map((m) => {
      const role = m.direction === "outbound" ? "bot" : "user";
      const text = String(m.text_body ?? m.transcript ?? "").trim();
      return {
        role,
        message: text,
        message_type: m.message_type,
        created_at: m.created_at,
      };
    });

    const customer = {
      customer_id: customerRow?.id ?? null,
      manychat_id: manychatId,
      first_name: customerRow?.first_name ?? null,
      last_name: customerRow?.last_name ?? null,
      phone: customerRow?.phone ?? null,
      email: customerRow?.email ?? null,
      tags: customerState.tags,
      lead_score: customerState.leadScore,
      last_intent: customerState.lastIntent,
      funnel_stage: customerState.funnelStage,
      interested_product: customerState.interestedProduct,
      payment_method_last: customerState.paymentMethodLast,
      brands_mentioned: customerState.brandsMentioned,
      last_bot_interaction: customerState.lastBotInteraction,
    };

    const store = defaultStoreFromConfig();
    const pricelist = loadPricelistText();

    return reply.send({
      v20_build_turn_context: {
        customer,
        recent_messages,
        candidate_products: [],
        store,
        storefront_handoff: null,
        pricelist_markdown: pricelist.text,
        pricelist_source: pricelist.source,
      },
    });
  });

  app.patch("/customers", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const url = new URL(request.url, "http://localhost");
    const rawManychatQuery = url.searchParams.get("manychat_id") ?? "";
    const manychatId = rawManychatQuery.startsWith("eq.") ? rawManychatQuery.slice(3) : rawManychatQuery;

    if (!manychatId) {
      return reply.code(400).send({ error: "Missing manychat_id query filter" });
    }

    const externalRef = `manychat:${manychatId}`;
    const rows = await query<{ id: number; notes: string | null }>(
      `
        select id, notes
        from public.customers
        where external_ref = $1
        limit 1
      `,
      [externalRef]
    );

    let customerId = rows[0]?.id ?? null;
    let currentNotes = rows[0]?.notes ?? null;

    if (!customerId) {
      const created = await query<{ id: number }>(
        `
          insert into public.customers (external_ref)
          values ($1)
          returning id
        `,
        [externalRef]
      );

      customerId = created[0].id;
      currentNotes = null;
    }

    const nextNotes = buildNotesState({
      currentNotes,
      updates: body,
    });

    const updatedRows = await query(
      `
        update public.customers
        set notes = $1, updated_at = now()
        where id = $2
        returning id, external_ref, phone, first_name, last_name, notes, updated_at
      `,
      [nextNotes, customerId]
    );

    return reply.send(updatedRows[0]);
  });
};
