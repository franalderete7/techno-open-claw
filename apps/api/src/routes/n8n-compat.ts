import type { FastifyPluginAsync } from "fastify";
import { pool, query } from "../db.js";

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

type ProductRow = {
  id: number;
  sku: string;
  slug: string;
  brand: string;
  model: string;
  title: string;
  description: string | null;
  condition: string;
  price_amount: string | number | null;
  price_usd: string | number | null;
  promo_price_ars: string | number | null;
  currency_code: string;
  active: boolean;
  in_stock: boolean;
  delivery_days: number | null;
  image_url: string | null;
  color: string | null;
  storage_gb: number | null;
  created_at: string;
  updated_at: string;
  in_stock_units: number;
  reserved_units: number;
  sold_units: number;
  total_units: number;
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBrandKey(value: string) {
  return normalizeText(value).replace(/\s+/g, "_");
}

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

function buildNotesState(params: {
  currentNotes: string | null;
  updates: Record<string, unknown>;
}) {
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

function inferStorageGb(product: Pick<ProductRow, "model" | "title" | "description">) {
  const source = `${product.model} ${product.title} ${product.description ?? ""}`;
  const match = source.match(/\b(64|128|256|512|1024)\s*gb\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function inferColor(product: Pick<ProductRow, "title" | "description">) {
  const source = `${product.title} ${product.description ?? ""}`;
  const match = source.match(
    /\b(black|white|blue|red|green|pink|purple|gold|silver|gray|grey|naranja|negro|blanco|azul|rojo|verde|rosa|violeta|dorado|gris)\b/i
  );

  return match ? match[1] : null;
}

function scoreCandidate(product: ProductRow, userMessage: string) {
  const message = normalizeText(userMessage);
  if (!message) {
    return product.in_stock_units > 0 ? 5 : 0;
  }

  const haystack = normalizeText(`${product.brand} ${product.model} ${product.title} ${product.description ?? ""}`);
  const messageTokens = message.split(" ").filter((token) => token.length > 1);
  let score = 0;

  for (const token of messageTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 4 ? 6 : 2;
    }
  }

  if (message.includes(normalizeText(product.brand))) {
    score += 10;
  }

  if (message.includes(normalizeText(product.model))) {
    score += 12;
  }

  if (product.in_stock_units > 0) {
    score += 4;
  }

  return score;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function settingValueToText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  const record = asRecord(value);
  if (record) {
    if (typeof record.value === "string") return record.value.trim();
    if (typeof record.text === "string") return record.text.trim();
    if (typeof record.content === "string") return record.content.trim();
  }

  return "";
}

function parsePositiveId(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

    // ManyChat can occasionally deliver the same inbound event more than once
    // within a very short window. Reuse the recent identical inbound row so the
    // debounce RPC doesn't see the duplicate as a newer customer message.
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
      [
        conversationId,
        direction,
        senderKind,
        messageType,
        textBody,
        null,
        transcript,
        body,
      ]
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
    });
  });

  app.post("/rpc/check_is_latest_message", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? "").trim();
    const messageId = Number(body.p_message_id ?? body.message_id);

    if (!manychatId || !Number.isFinite(messageId)) {
      return reply.code(400).send({ error: "Missing p_manychat_id or p_message_id" });
    }

    const rows = await query<{ id: number }>(
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

    const latestMessageId = rows[0]?.id ?? null;

    return reply.send({
      check_is_latest_message: latestMessageId == null ? true : latestMessageId === messageId,
      latest_message_id: latestMessageId,
      checked_message_id: messageId,
    });
  });

  app.post("/rpc/v17_build_turn_context", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const manychatId = String(body.p_manychat_id ?? body.manychat_id ?? "").trim();
    const userMessage = String(body.p_user_message ?? body.user_message ?? "").trim();
    const recentLimit = Math.max(1, Math.min(20, Number(body.p_recent_limit ?? 6) || 6));
    const candidateLimit = Math.max(1, Math.min(20, Number(body.p_candidate_limit ?? 8) || 8));

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

    const customer = customerRows[0] ?? null;
    const customerState = parseNotesState(customer?.notes ?? null);

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

    const recentMessages = conversationId
      ? await query<{
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
        )
      : [];

    const productRows = await query<ProductRow>(
      `
        select
          p.id,
          p.sku,
          p.slug,
          p.brand,
          p.model,
          p.title,
          p.description,
          p.condition,
          p.price_amount,
          p.price_usd,
          p.promo_price_ars,
          p.currency_code,
          p.active,
          p.in_stock,
          p.delivery_days,
          p.image_url,
          p.color,
          p.storage_gb,
          p.created_at,
          p.updated_at,
          coalesce(inv.in_stock_units, 0) as in_stock_units,
          coalesce(inv.reserved_units, 0) as reserved_units,
          coalesce(inv.sold_units, 0) as sold_units,
          coalesce(inv.total_units, 0) as total_units
        from public.products p
        left join lateral (
          select
            count(*) filter (where status = 'in_stock')::int as in_stock_units,
            count(*) filter (where status = 'reserved')::int as reserved_units,
            count(*) filter (where status = 'sold')::int as sold_units,
            count(*)::int as total_units
          from public.stock_units su
          where su.product_id = p.id
        ) inv on true
        where p.active = true
        order by p.updated_at desc, p.id desc
        limit 120
      `
    );

    const candidateProducts = productRows
      .map((product) => ({
        score: scoreCandidate(product, userMessage),
        product_key: product.sku,
        product_name: product.title,
        brand_key: normalizeBrandKey(product.brand),
        condition: product.condition,
        storage_gb: product.storage_gb ?? inferStorageGb(product),
        color: product.color ?? inferColor(product),
        in_stock: product.in_stock_units > 0 || product.in_stock,
        in_stock_units: product.in_stock_units,
        delivery_days: product.delivery_days,
        price_ars: product.price_amount == null ? null : Number(product.price_amount),
        promo_price_ars: product.promo_price_ars == null ? null : Number(product.promo_price_ars),
        price_usd: product.price_usd == null ? null : Number(product.price_usd),
        image_url: product.image_url,
      }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (Number(right.in_stock) !== Number(left.in_stock)) return Number(right.in_stock) - Number(left.in_stock);
        return 0;
      })
      .slice(0, candidateLimit);

    const settingsRows = await query<{ key: string; value: unknown }>(
      `
        select key, value
        from public.settings
      `
    );

    const settingsMap = new Map(settingsRows.map((row) => [row.key, row.value]));
    const storeRoot = asRecord(settingsMap.get("store")) ?? {};

    const store = {
      store_location_name:
        settingValueToText(settingsMap.get("store_location_name")) ||
        settingValueToText(storeRoot.store_location_name) ||
        settingValueToText(storeRoot.name) ||
        "TechnoStore",
      store_address:
        settingValueToText(settingsMap.get("store_address")) ||
        settingValueToText(storeRoot.store_address),
      store_hours:
        settingValueToText(settingsMap.get("store_hours")) ||
        settingValueToText(storeRoot.store_hours),
      store_payment_methods:
        settingValueToText(settingsMap.get("store_payment_methods")) ||
        settingValueToText(storeRoot.store_payment_methods),
      store_shipping_policy:
        settingValueToText(settingsMap.get("store_shipping_policy")) ||
        settingValueToText(storeRoot.store_shipping_policy),
      store_warranty_new:
        settingValueToText(settingsMap.get("store_warranty_new")) ||
        settingValueToText(storeRoot.store_warranty_new),
      store_warranty_used:
        settingValueToText(settingsMap.get("store_warranty_used")) ||
        settingValueToText(storeRoot.store_warranty_used),
      store_website_url:
        settingValueToText(settingsMap.get("store_website_url")) ||
        settingValueToText(storeRoot.store_website_url) ||
        settingValueToText(storeRoot.storefront_url) ||
        "https://puntotechno.com",
    };

    return reply.send({
      v17_build_turn_context: {
        customer: customer
          ? {
              customer_id: customer.id,
              manychat_id: manychatId,
              first_name: customer.first_name,
              last_name: customer.last_name,
              phone: customer.phone,
              email: customer.email,
              lead_score: customerState.leadScore,
              funnel_stage: customerState.funnelStage,
              tags: customerState.tags,
              interested_product: customerState.interestedProduct,
              brands_mentioned: customerState.brandsMentioned,
              payment_method_last: customerState.paymentMethodLast,
              last_bot_interaction: customerState.lastBotInteraction,
            }
          : null,
        recent_messages: recentMessages
          .slice()
          .reverse()
          .map((message) => ({
            id: message.id,
            role: message.direction === "inbound" ? "user" : "bot",
            message: message.text_body ?? message.transcript ?? "",
            message_type: message.message_type,
            created_at: message.created_at,
          })),
        candidate_products: candidateProducts,
        store,
        storefront_handoff: {
          ok: false,
          order: null,
        },
      },
    });
  });

  app.patch("/customers", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const url = new URL(request.url, "http://localhost");
    const rawManychatQuery = url.searchParams.get("manychat_id") ?? "";
    const manychatId = rawManychatQuery.startsWith("eq.")
      ? rawManychatQuery.slice(3)
      : rawManychatQuery;

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

  app.post("/ai_workflow_turns", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const entityId = String(body.manychat_id ?? body.customer_id ?? Date.now());

    const rows = await query(
      `
        insert into public.audit_logs (
          actor_type,
          actor_id,
          action,
          entity_type,
          entity_id,
          metadata
        ) values ('tool', 'n8n', 'n8n.ai_turn.logged', 'workflow_turn', $1, $2)
        returning id, created_at
      `,
      [entityId, body]
    );

    return reply.code(201).send(rows[0]);
  });
};
