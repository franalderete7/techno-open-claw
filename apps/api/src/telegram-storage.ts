import { pool } from "./db.js";

export async function upsertTelegramCustomer(params: {
  externalRef: string;
  firstName: string | null;
  lastName: string | null;
}) {
  const existing = await pool.query<{ id: number }>(
    `select id from public.customers where external_ref = $1 limit 1`,
    [params.externalRef]
  );

  if (existing.rows[0]) {
    const result = await pool.query<{ id: number }>(
      `
        update public.customers
        set
          first_name = coalesce(first_name, $2),
          last_name = coalesce(last_name, $3),
          updated_at = now()
        where external_ref = $1
        returning id
      `,
      [params.externalRef, params.firstName, params.lastName]
    );

    return result.rows[0].id;
  }

  const created = await pool.query<{ id: number }>(
    `
      insert into public.customers (external_ref, first_name, last_name)
      values ($1, $2, $3)
      returning id
    `,
    [params.externalRef, params.firstName, params.lastName]
  );

  return created.rows[0].id;
}

export async function upsertTelegramConversation(params: {
  customerId: number;
  conversationKey: string;
  conversationTitle: string;
  messageAt: Date;
}) {
  const result = await pool.query<{ id: number }>(
    `
      insert into public.conversations (
        customer_id,
        channel,
        channel_thread_key,
        status,
        title,
        last_message_at
      ) values ($1, 'telegram', $2, 'open', $3, $4)
      on conflict (channel_thread_key)
      do update set
        customer_id = coalesce(excluded.customer_id, public.conversations.customer_id),
        status = 'open',
        title = coalesce(excluded.title, public.conversations.title),
        last_message_at = greatest(excluded.last_message_at, public.conversations.last_message_at)
      returning id
    `,
    [params.customerId, params.conversationKey, params.conversationTitle, params.messageAt.toISOString()]
  );

  return result.rows[0].id;
}

export async function saveConversationMessage(params: {
  conversationId: number;
  direction: "inbound" | "outbound";
  senderKind: "customer" | "tool";
  messageType: "text" | "audio" | "image" | "video" | "file";
  textBody?: string | null;
  mediaUrl?: string | null;
  transcript?: string | null;
  payload?: Record<string, unknown>;
}) {
  const result = await pool.query<{ id: number }>(
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
      returning id
    `,
    [
      params.conversationId,
      params.direction,
      params.senderKind,
      params.messageType,
      params.textBody ?? null,
      params.mediaUrl ?? null,
      params.transcript ?? null,
      params.payload ?? {},
    ]
  );

  await pool.query(
    `
      update public.conversations
      set last_message_at = now(), updated_at = now()
      where id = $1
    `,
    [params.conversationId]
  );

  return result.rows[0].id;
}

export async function saveTelegramInboundMessage(params: {
  conversationId: number;
  messageType: "text" | "audio" | "image" | "video" | "file";
  textBody?: string | null;
  mediaUrl?: string | null;
  transcript?: string | null;
  payload?: Record<string, unknown>;
}) {
  const telegramMessageId = params.payload?.telegramMessageId;

  if (telegramMessageId != null) {
    const existing = await pool.query<{ id: number }>(
      `
        select id
        from public.messages
        where conversation_id = $1
          and direction = 'inbound'
          and sender_kind = 'customer'
          and payload ->> 'telegramMessageId' = $2
        order by id desc
        limit 1
      `,
      [params.conversationId, String(telegramMessageId)]
    );

    if (existing.rows[0]) {
      return {
        id: existing.rows[0].id,
        duplicate: true,
      };
    }
  }

  const id = await saveConversationMessage({
    conversationId: params.conversationId,
    direction: "inbound",
    senderKind: "customer",
    messageType: params.messageType,
    textBody: params.textBody,
    mediaUrl: params.mediaUrl,
    transcript: params.transcript,
    payload: params.payload,
  });

  return {
    id,
    duplicate: false,
  };
}
