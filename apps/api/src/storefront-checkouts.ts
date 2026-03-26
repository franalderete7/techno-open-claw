import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { pool } from "./db.js";
import { createGalioPaymentLink, getGalioPayment, hasGalioPayConfig } from "./galiopay.js";

type CheckoutChannel = "storefront" | "whatsapp" | "telegram" | "api";

type CreateStorefrontPaymentIntentInput = {
  productId: number;
  sourceHost?: string | null;
  sourcePath?: string | null;
  channel?: CheckoutChannel;
  customerId?: number | null;
  customerPhone?: string | null;
  customerName?: string | null;
};

type StorefrontPaymentIntentResult = {
  order_id: number;
  token: string;
  redirect_url: string;
  whatsapp_message: string;
  product_title: string;
  price_amount: number;
  currency_code: string;
};

type StorefrontHandoffResult = {
  ok: boolean;
  order: {
    id: number;
    order_number: string;
    item_count: number;
    product_id: number;
    product_key: string | null;
    subtotal: number;
    total: number;
    currency_code: string;
    status: string;
    title: string;
    image_url: string | null;
    delivery_days: number | null;
    checkout_channel: CheckoutChannel;
  } | null;
  payment: {
    ready: boolean;
    status: string | null;
    url: string | null;
    provider: "galiopay";
    message: string | null;
  } | null;
};

type CheckoutRow = {
  checkout_id: number;
  order_id: number;
  order_number: string;
  order_status: string;
  product_id: number;
  product_key: string | null;
  subtotal_amount: string | number;
  total_amount: string | number;
  currency_code: string;
  title_snapshot: string;
  unit_price_amount: string | number;
  image_url_snapshot: string | null;
  delivery_days_snapshot: number | null;
  galio_reference_id: string | null;
  galio_payment_url: string | null;
  galio_proof_token: string | null;
  galio_payment_id: string | null;
  galio_payment_status: string | null;
  checkout_status: string;
  checkout_channel: CheckoutChannel;
  source_host: string | null;
  metadata: Record<string, unknown> | null;
};

type ReusableCheckoutRow = {
  order_id: number;
  token: string;
};

type EnsureStorefrontCheckoutHandoffInput = {
  productId: number;
  sourceHost?: string | null;
  sourcePath?: string | null;
  channel?: CheckoutChannel;
  customerId?: number | null;
  customerPhone?: string | null;
  customerName?: string | null;
};

function toNumber(value: string | number | null | undefined) {
  const amount = Number(value ?? NaN);
  return Number.isFinite(amount) ? amount : null;
}

function normalizePhoneDigits(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  return digits || null;
}

function orderSourceForChannel(channel: CheckoutChannel) {
  switch (channel) {
    case "whatsapp":
      return "whatsapp" as const;
    case "telegram":
      return "telegram" as const;
    case "api":
      return "api" as const;
    case "storefront":
    default:
      return "web" as const;
  }
}

function orderNotePrefixForChannel(channel: CheckoutChannel) {
  switch (channel) {
    case "whatsapp":
      return "WhatsApp checkout";
    case "telegram":
      return "Telegram checkout";
    case "api":
      return "API checkout";
    case "storefront":
    default:
      return "Storefront checkout";
  }
}

function absolutePublicUrl(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (!config.PUBLIC_API_BASE_URL) {
    return null;
  }

  const base = config.PUBLIC_API_BASE_URL.replace(/\/$/, "");
  const path = value.startsWith("/") ? value : `/${value}`;
  return `${base}${path}`;
}

function buildWhatsAppMessage(orderId: number, token: string, title: string) {
  return `Hola! Quiero pagarlo ahora por ${title}. pedido web #${orderId} token ${token}`;
}

function buildWhatsAppRedirectUrl(message: string) {
  const phone = config.STORE_WHATSAPP_PHONE.replace(/\D+/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function createIntentToken() {
  return randomBytes(12).toString("hex");
}

async function writeSystemAuditLog(client: PoolClient, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  await client.query(
    `
      insert into public.audit_logs (
        actor_type,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
      ) values ('system', 'storefront', $1, $2, $3, $4)
    `,
    [action, entityType, entityId, metadata]
  );
}

async function getCheckoutRowForUpdate(client: PoolClient, orderId: number, token: string) {
  const result = await client.query<CheckoutRow>(
    `
      select
        sci.id as checkout_id,
        sci.order_id,
        o.order_number,
        o.status as order_status,
        sci.product_id,
        p.sku as product_key,
        o.subtotal_amount,
        o.total_amount,
        sci.currency_code,
        sci.title_snapshot,
        sci.unit_price_amount,
        sci.image_url_snapshot,
        sci.delivery_days_snapshot,
        sci.galio_reference_id,
        sci.galio_payment_url,
        sci.galio_proof_token,
        sci.galio_payment_id,
        sci.galio_payment_status,
        sci.status as checkout_status,
        sci.channel as checkout_channel,
        sci.source_host,
        sci.metadata
      from public.storefront_checkout_intents sci
      join public.orders o on o.id = sci.order_id
      left join public.products p on p.id = sci.product_id
      where sci.order_id = $1
        and sci.token = $2
      limit 1
      for update
    `,
    [orderId, token]
  );

  return result.rows[0] ?? null;
}

async function attachCheckoutCustomerContext(params: {
  orderId: number;
  token: string;
  customerId?: number | null;
  customerPhone?: string | null;
  customerName?: string | null;
}) {
  const customerPhone = params.customerPhone?.trim() || null;
  const customerName = params.customerName?.trim() || null;
  const hasContext = params.customerId != null || customerPhone || customerName;

  if (!hasContext) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    await client.query(
      `
        update public.orders
        set
          customer_id = coalesce(customer_id, $2),
          updated_at = now()
        where id = $1
      `,
      [params.orderId, params.customerId ?? null]
    );

    await client.query(
      `
        update public.storefront_checkout_intents
        set
          customer_phone = coalesce(nullif(customer_phone, ''), $3),
          customer_name = coalesce(nullif(customer_name, ''), $4),
          updated_at = now()
        where order_id = $1
          and token = $2
      `,
      [params.orderId, params.token, customerPhone, customerName]
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function findReusableCheckoutIntent(params: {
  productId: number;
  customerId?: number | null;
  customerPhone?: string | null;
}) {
  const phoneDigits = normalizePhoneDigits(params.customerPhone);

  if (params.customerId == null && !phoneDigits) {
    return null;
  }

  const result = await pool.query<ReusableCheckoutRow>(
    `
      select sci.order_id, sci.token
      from public.storefront_checkout_intents sci
      join public.orders o on o.id = sci.order_id
      where sci.product_id = $1
        and sci.status in ('created', 'link_created')
        and o.status in ('draft', 'pending')
        and (
          ($2::bigint is not null and o.customer_id = $2)
          or (
            $3::text is not null
            and $3 <> ''
            and regexp_replace(coalesce(sci.customer_phone, ''), '\D', '', 'g') = $3
          )
        )
      order by sci.updated_at desc, sci.id desc
      limit 1
    `,
    [params.productId, params.customerId ?? null, phoneDigits]
  );

  return result.rows[0] ?? null;
}

function buildSuccessUrl(sourceHost: string | null) {
  if (config.GALIOPAY_SUCCESS_URL) {
    return config.GALIOPAY_SUCCESS_URL;
  }

  if (!sourceHost) {
    return null;
  }

  return `https://${sourceHost}/pago/exito`;
}

function buildFailureUrl(sourceHost: string | null) {
  if (config.GALIOPAY_FAILURE_URL) {
    return config.GALIOPAY_FAILURE_URL;
  }

  if (!sourceHost) {
    return null;
  }

  return `https://${sourceHost}/pago/error`;
}

export async function createStorefrontPaymentIntent({
  productId,
  sourceHost,
  sourcePath,
  channel = "storefront",
  customerId,
  customerPhone,
  customerName,
}: CreateStorefrontPaymentIntentInput): Promise<StorefrontPaymentIntentResult> {
  const client = await pool.connect();

  try {
    await client.query("begin");

    const productResult = await client.query<{
      id: number;
      title: string;
      slug: string;
      image_url: string | null;
      delivery_days: number | null;
      currency_code: string;
      price_amount: string | number | null;
      promo_price_ars: string | number | null;
      active: boolean;
    }>(
      `
        select
          id,
          title,
          slug,
          image_url,
          delivery_days,
          currency_code,
          price_amount,
          promo_price_ars,
          active
        from public.products
        where id = $1
        limit 1
      `,
      [productId]
    );

    const product = productResult.rows[0];

    if (!product || !product.active) {
      throw new Error("Product is not available for checkout");
    }

    const publicPrice = toNumber(product.promo_price_ars) ?? toNumber(product.price_amount);
    if (publicPrice == null) {
      throw new Error("Product does not have a public ARS price");
    }

    const orderResult = await client.query<{ id: number; order_number: string }>(
      `
        insert into public.orders (
          customer_id,
          source,
          status,
          currency_code,
          subtotal_amount,
          total_amount,
          notes
        ) values ($1, $2, 'draft', $3, $4, $4, $5)
        returning id, order_number
      `,
      [
        customerId ?? null,
        orderSourceForChannel(channel),
        product.currency_code || "ARS",
        publicPrice,
        `${orderNotePrefixForChannel(channel)} for ${product.title}${sourcePath ? ` (${sourcePath})` : ""}`,
      ]
    );

    const order = orderResult.rows[0];

    await client.query(
      `
        insert into public.order_items (
          order_id,
          product_id,
          title_snapshot,
          quantity,
          unit_price_amount,
          currency_code
        ) values ($1, $2, $3, 1, $4, $5)
      `,
      [order.id, product.id, product.title, publicPrice, product.currency_code || "ARS"]
    );

    const token = createIntentToken();

    await client.query(
      `
        insert into public.storefront_checkout_intents (
          order_id,
          product_id,
          token,
          channel,
          source_host,
          customer_phone,
          customer_name,
          title_snapshot,
          unit_price_amount,
          currency_code,
          image_url_snapshot,
          delivery_days_snapshot,
          metadata
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        order.id,
        product.id,
        token,
        channel,
        sourceHost ?? null,
        customerPhone?.trim() || null,
        customerName?.trim() || null,
        product.title,
        publicPrice,
        product.currency_code || "ARS",
        product.image_url,
        product.delivery_days ?? null,
        {
          source_path: sourcePath ?? null,
          product_slug: product.slug,
        },
      ]
    );

    await writeSystemAuditLog(client, "storefront.checkout_intent.created", "order", String(order.id), {
      channel,
      product_id: product.id,
      source_host: sourceHost ?? null,
    });

    await client.query("commit");

    const whatsappMessage = buildWhatsAppMessage(order.id, token, product.title);

    return {
      order_id: order.id,
      token,
      redirect_url: buildWhatsAppRedirectUrl(whatsappMessage),
      whatsapp_message: whatsappMessage,
      product_title: product.title,
      price_amount: publicPrice,
      currency_code: product.currency_code || "ARS",
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveStorefrontCheckoutHandoff(orderId: number, token: string): Promise<StorefrontHandoffResult> {
  const client = await pool.connect();

  try {
    await client.query("begin");

    const checkout = await getCheckoutRowForUpdate(client, orderId, token);

    if (!checkout) {
      await client.query("commit");
      return { ok: false, order: null, payment: null };
    }

    let paymentUrl = checkout.galio_payment_url;
    let paymentStatus = checkout.galio_payment_status || checkout.checkout_status;

    if (checkout.checkout_status !== "paid" && !paymentUrl && hasGalioPayConfig()) {
      const referenceId = checkout.galio_reference_id || `toc-order-${checkout.order_id}-checkout-${checkout.checkout_id}`;
      const paymentLink = await createGalioPaymentLink({
        referenceId,
        title: checkout.title_snapshot,
        unitPrice: toNumber(checkout.unit_price_amount) ?? 0,
        currencyCode: checkout.currency_code,
        imageUrl: absolutePublicUrl(checkout.image_url_snapshot),
        successUrl: buildSuccessUrl(checkout.source_host),
        failureUrl: buildFailureUrl(checkout.source_host),
      });

      paymentUrl = paymentLink.url;
      paymentStatus = "link_created";

      await client.query(
        `
          update public.storefront_checkout_intents
          set
            status = 'link_created',
            galio_reference_id = $2,
            galio_payment_url = $3,
            galio_proof_token = $4,
            galio_payment_status = 'link_created',
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_galiopay_link', $5::jsonb)
          where id = $1
        `,
        [checkout.checkout_id, referenceId, paymentLink.url, paymentLink.proofToken, paymentLink.raw]
      );

      await client.query(
        `
          update public.orders
          set status = 'pending'
          where id = $1
            and status = 'draft'
        `,
        [checkout.order_id]
      );

      await writeSystemAuditLog(client, "storefront.checkout_intent.link_created", "order", String(checkout.order_id), {
        checkout_id: checkout.checkout_id,
        galio_reference_id: referenceId,
      });
    }

    await client.query("commit");

    const subtotal = toNumber(checkout.subtotal_amount) ?? 0;
    const total = toNumber(checkout.total_amount) ?? subtotal;

    return {
      ok: true,
      order: {
        id: checkout.order_id,
        order_number: checkout.order_number,
        item_count: 1,
        product_id: checkout.product_id,
        product_key: checkout.product_key,
        subtotal,
        total,
        currency_code: checkout.currency_code,
        status: checkout.order_status === "draft" && paymentUrl ? "pending" : checkout.order_status,
        title: checkout.title_snapshot,
        image_url: absolutePublicUrl(checkout.image_url_snapshot),
        delivery_days: checkout.delivery_days_snapshot,
        checkout_channel: checkout.checkout_channel,
      },
      payment: {
        ready: Boolean(paymentUrl),
        status: paymentStatus,
        url: paymentUrl,
        provider: "galiopay",
        message: paymentUrl ? "Link de pago listo para enviar por WhatsApp." : "El link de pago todavía no está listo.",
      },
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureStorefrontCheckoutHandoff({
  productId,
  sourceHost,
  sourcePath,
  channel = "api",
  customerId,
  customerPhone,
  customerName,
}: EnsureStorefrontCheckoutHandoffInput): Promise<StorefrontHandoffResult> {
  const reusable = await findReusableCheckoutIntent({
    productId,
    customerId,
    customerPhone,
  });

  if (reusable) {
    await attachCheckoutCustomerContext({
      orderId: reusable.order_id,
      token: reusable.token,
      customerId,
      customerPhone,
      customerName,
    });

    return resolveStorefrontCheckoutHandoff(reusable.order_id, reusable.token);
  }

  const created = await createStorefrontPaymentIntent({
    productId,
    sourceHost,
    sourcePath,
    channel,
    customerId,
    customerPhone,
    customerName,
  });

  return resolveStorefrontCheckoutHandoff(created.order_id, created.token);
}

function mapWebhookStatus(status: string | null) {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (normalized === "approved" || normalized === "paid") {
    return {
      checkoutStatus: "paid",
      orderStatus: "paid",
    } as const;
  }

  if (["refunded", "cancelled", "rejected", "expired", "failed"].includes(normalized)) {
    return {
      checkoutStatus: normalized === "expired" ? "expired" : "cancelled",
      orderStatus: "cancelled",
    } as const;
  }

  return {
    checkoutStatus: "link_created",
    orderStatus: "pending",
  } as const;
}

export async function handleGalioPayWebhook(payload: unknown) {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const paymentId = typeof body.id === "string" ? body.id : null;
  const referenceId = typeof body.referenceId === "string" ? body.referenceId : null;

  if (!referenceId) {
    return {
      ok: true,
      ignored: true,
      reason: "missing_reference_id",
    };
  }

  const verifiedPayment =
    paymentId && hasGalioPayConfig()
      ? await getGalioPayment(paymentId).catch(() => null)
      : null;

  const finalStatus =
    verifiedPayment?.status ||
    (typeof body.status === "string" ? body.status : null);

  const mapped = mapWebhookStatus(finalStatus);
  const client = await pool.connect();

  try {
    await client.query("begin");

    const lookup = await client.query<{ id: number; order_id: number }>(
      `
        select id, order_id
        from public.storefront_checkout_intents
        where galio_reference_id = $1
        limit 1
        for update
      `,
      [referenceId]
    );

    const checkout = lookup.rows[0];

    if (!checkout) {
      await client.query("commit");
      return {
        ok: true,
        ignored: true,
        reason: "checkout_not_found",
      };
    }

    await client.query(
      `
        update public.storefront_checkout_intents
        set
          status = $2,
          galio_payment_id = coalesce($3, galio_payment_id),
          galio_payment_status = $4,
          paid_at = case when $2 = 'paid' then coalesce(paid_at, now()) else paid_at end,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'last_galiopay_webhook', $5::jsonb,
            'last_galiopay_payment', $6::jsonb
          )
        where id = $1
      `,
      [checkout.id, mapped.checkoutStatus, paymentId, finalStatus, body, verifiedPayment?.raw ?? null]
    );

    await client.query(
      `
        update public.orders
        set status = $2
        where id = $1
      `,
      [checkout.order_id, mapped.orderStatus]
    );

    await writeSystemAuditLog(client, "storefront.checkout_intent.payment_webhook", "order", String(checkout.order_id), {
      checkout_id: checkout.id,
      reference_id: referenceId,
      payment_id: paymentId,
      status: finalStatus,
    });

    await client.query("commit");

    return {
      ok: true,
      updated: true,
      referenceId,
      paymentId,
      status: finalStatus,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
