import Fastify from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { query } from "./db.js";
import { requireBearerToken } from "./auth.js";
import { n8nCompatRoutes } from "./routes/n8n-compat.js";

const app = Fastify({
  logger: true,
});

const conversationStatusValues = ["open", "closed", "archived"] as const;
const messageDirectionValues = ["inbound", "outbound", "system"] as const;
const senderKindValues = ["customer", "agent", "admin", "tool", "system"] as const;
const messageTypeValues = ["text", "audio", "image", "video", "file", "event"] as const;

const jsonValueSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

function listLimitSchema(defaultLimit = 50, maxLimit = 200) {
  return z.coerce
    .number()
    .int()
    .positive()
    .default(defaultLimit)
    .transform((value) => Math.min(value, maxLimit));
}

app.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      error: "validation_error",
      issues: error.issues,
    });
  }

  request.log.error(error);
  return reply.status(500).send({
    error: "internal_server_error",
  });
});

app.get("/health", async () => {
  const now = await query<{ now: string }>("select now()::text as now");

  return {
    ok: true,
    service: "techno-open-claw-api",
    databaseTime: now[0]?.now ?? null,
  };
});

app.register(async (protectedApp) => {
  protectedApp.addHook("preHandler", requireBearerToken);
  protectedApp.register(n8nCompatRoutes, { prefix: "/rest/v1" });

  protectedApp.get("/v1/dashboard", async () => {
    const [customers] = await query<{ count: string }>("select count(*)::text as count from public.customers");
    const [openConversations] = await query<{ count: string }>(
      "select count(*)::text as count from public.conversations where status = 'open'"
    );
    const [messages] = await query<{ count: string }>("select count(*)::text as count from public.messages");

    return {
      customers: Number(customers?.count ?? 0),
      openConversations: Number(openConversations?.count ?? 0),
      messages: Number(messages?.count ?? 0),
    };
  });

  protectedApp.post("/v1/customers/upsert", async (request, reply) => {
    const schema = z.object({
      external_ref: z.string().trim().optional().nullable(),
      first_name: z.string().trim().optional().nullable(),
      last_name: z.string().trim().optional().nullable(),
      phone: z.string().trim().optional().nullable(),
      email: z.string().trim().email().optional().nullable(),
      notes: z.string().trim().optional().nullable(),
    });
    const body = schema.parse(request.body);

    if (!body.external_ref && !body.phone && !body.email) {
      return reply.code(400).send({ error: "Provide external_ref, phone, or email to upsert a customer." });
    }

    let existingRows: Record<string, unknown>[] = [];

    if (body.external_ref) {
      existingRows = await query(`select * from public.customers where external_ref = $1 limit 1`, [body.external_ref]);
    }

    if (existingRows.length === 0 && body.phone) {
      existingRows = await query(`select * from public.customers where phone = $1 limit 1`, [body.phone]);
    }

    if (existingRows.length === 0 && body.email) {
      existingRows = await query(`select * from public.customers where email = $1 limit 1`, [body.email]);
    }

    const existing = existingRows[0] as { id: number } | undefined;

    if (!existing) {
      const createdRows = await query(
        `
          insert into public.customers (
            external_ref,
            first_name,
            last_name,
            phone,
            email,
            notes
          ) values ($1, $2, $3, $4, $5, $6)
          returning *
        `,
        [
          body.external_ref ?? null,
          body.first_name ?? null,
          body.last_name ?? null,
          body.phone ?? null,
          body.email ?? null,
          body.notes ?? null,
        ]
      );

      return reply.code(201).send(createdRows[0]);
    }

    const updateKeys = ["external_ref", "first_name", "last_name", "phone", "email", "notes"] as const;
    const entries = updateKeys.map((k) => [k, body[k]] as const).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      const currentRows = await query(`select * from public.customers where id = $1`, [existing.id]);
      return currentRows[0] ?? null;
    }

    const setParts: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, val] of entries) {
      setParts.push(`${key} = $${i}`);
      values.push(val);
      i++;
    }
    values.push(existing.id);

    const updatedRows = await query(
      `
        update public.customers
        set ${setParts.join(", ")}
        where id = $${i}
        returning *
      `,
      values
    );

    return updatedRows[0];
  });

  protectedApp.get("/v1/customers", async (request) => {
    const schema = z.object({
      q: z.string().trim().optional(),
      limit: listLimitSchema(),
    });
    const params = schema.parse(request.query);

    const values: unknown[] = [];
    let whereSql = "";

    if (params.q) {
      values.push(`%${params.q}%`);
      whereSql = `
        where
          coalesce(first_name, '') ilike $1
          or coalesce(last_name, '') ilike $1
          or coalesce(phone, '') ilike $1
          or coalesce(email, '') ilike $1
      `;
    }

    values.push(params.limit);

    const rows = await query(
      `
        select
          id,
          external_ref,
          first_name,
          last_name,
          phone,
          email,
          notes,
          created_at,
          updated_at
        from public.customers
        ${whereSql}
        order by updated_at desc, id desc
        limit $${values.length}
      `,
      values
    );

    return { items: rows };
  });

  protectedApp.post("/v1/conversations/upsert", async (request) => {
    const schema = z.object({
      customer_id: z.coerce.number().int().positive().optional().nullable(),
      channel: z.string().trim().min(1),
      channel_thread_key: z.string().trim().min(1),
      status: z.enum(conversationStatusValues).default("open"),
      title: z.string().trim().optional().nullable(),
      last_message_at: z.string().datetime().optional().nullable(),
    });
    const body = schema.parse(request.body);

    const rows = await query(
      `
        insert into public.conversations (
          customer_id,
          channel,
          channel_thread_key,
          status,
          title,
          last_message_at
        ) values ($1, $2, $3, $4, $5, $6)
        on conflict (channel_thread_key)
        do update set
          customer_id = coalesce(excluded.customer_id, public.conversations.customer_id),
          channel = excluded.channel,
          status = excluded.status,
          title = coalesce(excluded.title, public.conversations.title),
          last_message_at = coalesce(excluded.last_message_at, public.conversations.last_message_at)
        returning *
      `,
      [
        body.customer_id ?? null,
        body.channel,
        body.channel_thread_key,
        body.status,
        body.title ?? null,
        body.last_message_at ?? null,
      ]
    );

    return rows[0];
  });

  protectedApp.get("/v1/conversations", async (request) => {
    const schema = z.object({
      limit: listLimitSchema(),
    });
    const params = schema.parse(request.query);

    const rows = await query(
      `
        select
          c.id,
          c.channel,
          c.channel_thread_key,
          c.status,
          c.last_message_at,
          c.created_at,
          c.updated_at,
          cu.id as customer_id,
          cu.first_name,
          cu.last_name,
          cu.phone
        from public.conversations c
        left join public.customers cu on cu.id = c.customer_id
        order by c.last_message_at desc nulls last, c.id desc
        limit $1
      `,
      [params.limit]
    );

    return { items: rows };
  });

  protectedApp.get("/v1/conversations/:conversationId/messages", async (request) => {
    const schema = z.object({
      conversationId: z.coerce.number().int().positive(),
    });
    const { conversationId } = schema.parse(request.params);

    const rows = await query(
      `
        select
          id,
          direction,
          sender_kind,
          message_type,
          text_body,
          media_url,
          transcript,
          payload,
          created_at
        from public.messages
        where conversation_id = $1
        order by created_at asc, id asc
      `,
      [conversationId]
    );

    return { items: rows };
  });

  protectedApp.post("/v1/messages", async (request, reply) => {
    const schema = z.object({
      conversation_id: z.coerce.number().int().positive(),
      direction: z.enum(messageDirectionValues),
      sender_kind: z.enum(senderKindValues),
      message_type: z.enum(messageTypeValues),
      text_body: z.string().trim().optional().nullable(),
      media_url: z.string().trim().optional().nullable(),
      transcript: z.string().trim().optional().nullable(),
      payload: z.record(z.string(), jsonValueSchema).optional().default({}),
    });
    const body = schema.parse(request.body);

    const rows = await query(
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
        returning *
      `,
      [
        body.conversation_id,
        body.direction,
        body.sender_kind,
        body.message_type,
        body.text_body ?? null,
        body.media_url ?? null,
        body.transcript ?? null,
        body.payload,
      ]
    );

    const message = rows[0];

    await query(
      `
        update public.conversations
        set
          last_message_at = $1,
          updated_at = now()
        where id = $2
      `,
      [message.created_at, body.conversation_id]
    );

    return reply.code(201).send(message);
  });

  protectedApp.get("/v1/settings/:key", async (request, reply) => {
    const schema = z.object({
      key: z.string().trim().min(1),
    });
    const { key } = schema.parse(request.params);

    const rows = await query(`select key, value, description, updated_at from public.settings where key = $1`, [key]);
    const setting = rows[0];

    if (!setting) {
      return reply.code(404).send({ error: "Setting not found." });
    }

    return setting;
  });

  protectedApp.get("/v1/settings", async () => {
    const rows = await query(
      `
        select
          key,
          value,
          description,
          updated_at
        from public.settings
        order by key asc
      `
    );

    return { items: rows };
  });

  protectedApp.put("/v1/settings/:key", async (request) => {
    const paramsSchema = z.object({
      key: z.string().trim().min(1),
    });
    const bodySchema = z.object({
      value: jsonValueSchema,
      description: z.string().trim().nullable().optional(),
    });

    const { key } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);

    const rows = await query(
      `
        insert into public.settings (key, value, description)
        values ($1, $2::jsonb, $3)
        on conflict (key)
        do update set
          value = excluded.value,
          description = excluded.description,
          updated_at = now()
        returning key, value, description, updated_at
      `,
      [key, JSON.stringify(body.value), body.description ?? null]
    );

    return rows[0];
  });
});

async function start() {
  try {
    await app.listen({
      host: config.API_HOST,
      port: config.API_PORT,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
