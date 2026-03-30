import Link from "next/link";
import { getOrderDetail } from "../../../lib/api";

type OrderDetailPageProps = {
  params: Promise<{
    orderId: string;
  }>;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
}

function formatMoney(amount: number | null, currency: string) {
  if (amount == null) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function summarizeCustomer(firstName: string | null, lastName: string | null) {
  return [firstName, lastName].filter(Boolean).join(" ") || "No customer";
}

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { orderId: rawOrderId } = await params;
  const orderId = Number(rawOrderId);

  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new Error("Invalid order id");
  }

  let data = null as Awaited<ReturnType<typeof getOrderDetail>> | null;
  let error: string | null = null;

  try {
    data = await getOrderDetail(orderId);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load order";
  }

  const order = data?.order ?? null;
  const items = data?.items ?? [];
  const checkoutIntents = data?.checkout_intents ?? [];
  const audit = data?.audit ?? [];
  const customerLabel = order
    ? order.customer_name || summarizeCustomer(order.first_name, order.last_name)
    : `Order #${orderId}`;

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Orders</span>
        <h2 className="hero-title">{order?.order_number || `Order #${orderId}`}</h2>
        <div className="chip-row">
          <span className="chip accent">#{orderId}</span>
          {order ? <span className="chip">{order.source}</span> : null}
          {order ? (
            <span className={`chip ${order.status === "paid" || order.status === "fulfilled" ? "good" : "warn"}`}>
              {order.status}
            </span>
          ) : null}
          <span className="chip">{items.length} items</span>
          <span className="chip">{checkoutIntents.length} checkout intents</span>
        </div>
        <div className="meta-row">
          <Link href="/orders" className="chip action-link">
            Back to orders
          </Link>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {order ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Order Summary</h3>
                <p className="panel-copy">{customerLabel}</p>
              </div>
            </div>

            <dl className="record-meta-grid">
              <div>
                <dt>Order number</dt>
                <dd>{order.order_number}</dd>
              </div>
              <div>
                <dt>Customer ID</dt>
                <dd>{order.customer_id ?? "-"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{order.phone || "-"}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{order.email || "-"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{order.source}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{order.status}</dd>
              </div>
              <div>
                <dt>Subtotal</dt>
                <dd>{formatMoney(order.subtotal_amount, order.currency_code)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{formatMoney(order.total_amount, order.currency_code)}</dd>
              </div>
              <div>
                <dt>Currency</dt>
                <dd>{order.currency_code}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(order.created_at)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatDate(order.updated_at)}</dd>
              </div>
              <div>
                <dt>Notes</dt>
                <dd>{order.notes || "-"}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Order Items</h3>
                <p className="panel-copy">Commercial line items linked to this order.</p>
              </div>
            </div>

            {items.length === 0 ? (
              <p className="empty">No order items were found.</p>
            ) : (
              <div className="record-grid">
                {items.map((item) => (
                  <article key={item.id} className="record-card">
                    <div className="record-header">
                      <div>
                        <p className="catalog-kicker">{item.sku || "manual item"}</p>
                        <h3 className="record-title">{item.title_snapshot}</h3>
                        <p className="record-subtitle">
                          {[item.brand, item.model].filter(Boolean).join(" ") || item.product_title || "No linked product"}
                        </p>
                      </div>
                      <span className="pill">{item.quantity} unit{item.quantity === 1 ? "" : "s"}</span>
                    </div>

                    <dl className="record-meta-grid">
                      <div>
                        <dt>Product ID</dt>
                        <dd>{item.product_id ?? "-"}</dd>
                      </div>
                      <div>
                        <dt>Stock unit ID</dt>
                        <dd>{item.stock_unit_id ?? "-"}</dd>
                      </div>
                      <div>
                        <dt>Unit price</dt>
                        <dd>{formatMoney(item.unit_price_amount, item.currency_code)}</dd>
                      </div>
                      <div>
                        <dt>Serial</dt>
                        <dd>{item.serial_number || "-"}</dd>
                      </div>
                      <div>
                        <dt>IMEI 1</dt>
                        <dd>{item.imei_1 || "-"}</dd>
                      </div>
                      <div>
                        <dt>IMEI 2</dt>
                        <dd>{item.imei_2 || "-"}</dd>
                      </div>
                      <div>
                        <dt>Stock status</dt>
                        <dd>{item.stock_status || "-"}</dd>
                      </div>
                      <div>
                        <dt>Location</dt>
                        <dd>{item.location_code || "-"}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Checkout & Payment</h3>
                <p className="panel-copy">Storefront checkout intents and GalioPay state attached to this order.</p>
              </div>
            </div>

            {checkoutIntents.length === 0 ? (
              <p className="empty">No checkout-intent records were found for this order.</p>
            ) : (
              <div className="record-grid">
                {checkoutIntents.map((intent) => (
                  <article key={intent.id} className="record-card">
                    <div className="record-header">
                      <div>
                        <p className="catalog-kicker">{intent.channel}</p>
                        <h3 className="record-title">{intent.title_snapshot}</h3>
                        <p className="record-subtitle">
                          {[intent.brand, intent.model].filter(Boolean).join(" ") || intent.sku || "Checkout intent"}
                        </p>
                      </div>
                      <span className={`pill ${intent.status === "paid" ? "good" : intent.status === "failed" || intent.status === "cancelled" ? "danger" : "warn"}`}>
                        {intent.status}
                      </span>
                    </div>

                    <dl className="record-meta-grid">
                      <div>
                        <dt>Intent ID</dt>
                        <dd>{intent.id}</dd>
                      </div>
                      <div>
                        <dt>Token</dt>
                        <dd className="mono">{intent.token}</dd>
                      </div>
                      <div>
                        <dt>Customer name</dt>
                        <dd>{intent.customer_name || "-"}</dd>
                      </div>
                      <div>
                        <dt>Customer phone</dt>
                        <dd>{intent.customer_phone || "-"}</dd>
                      </div>
                      <div>
                        <dt>Unit price</dt>
                        <dd>{formatMoney(intent.unit_price_amount, intent.currency_code)}</dd>
                      </div>
                      <div>
                        <dt>Delivery days</dt>
                        <dd>{intent.delivery_days_snapshot ?? "-"}</dd>
                      </div>
                      <div>
                        <dt>Payment provider</dt>
                        <dd>{intent.payment_provider || (intent.galio_payment_id || intent.galio_reference_id ? "galiopay" : "-")}</dd>
                      </div>
                      <div>
                        <dt>Payment reference</dt>
                        <dd className="mono">{intent.payment_reference_id || intent.galio_reference_id || "-"}</dd>
                      </div>
                      <div>
                        <dt>Payment ID</dt>
                        <dd className="mono">{intent.payment_id || intent.galio_payment_id || "-"}</dd>
                      </div>
                      <div>
                        <dt>Payment status</dt>
                        <dd>{intent.payment_status || intent.galio_payment_status || "-"}</dd>
                      </div>
                      <div>
                        <dt>Paid at</dt>
                        <dd>{formatDate(intent.paid_at)}</dd>
                      </div>
                      <div>
                        <dt>Expires at</dt>
                        <dd>{formatDate(intent.expires_at)}</dd>
                      </div>
                      <div>
                        <dt>Source host</dt>
                        <dd>{intent.source_host || "-"}</dd>
                      </div>
                    </dl>

                    {intent.image_url_snapshot ? (
                      <div className="message-asset">
                        <a className="message-link mono" href={intent.image_url_snapshot} target="_blank" rel="noreferrer">
                          {intent.image_url_snapshot}
                        </a>
                      </div>
                    ) : null}

                    {(intent.payment_url || intent.galio_payment_url) ? (
                      <div className="message-asset">
                        <a
                          className="message-link mono"
                          href={intent.payment_url || intent.galio_payment_url || "#"}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {intent.payment_url || intent.galio_payment_url}
                        </a>
                      </div>
                    ) : null}

                    <pre className="json-block">{JSON.stringify(intent.metadata || {}, null, 2)}</pre>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Audit Trail</h3>
                <p className="panel-copy">System and operator events recorded against this order.</p>
              </div>
            </div>

            {audit.length === 0 ? (
              <p className="empty">No audit events were found for this order.</p>
            ) : (
              <div className="activity-list">
                {audit.map((entry) => (
                  <article key={entry.id} className="activity-item">
                    <div className="message-meta">
                      <div className="chip-row">
                        <span className="chip accent mono">#{entry.id}</span>
                        <span className="chip">{entry.actor_type}</span>
                        <span className="chip">{entry.action}</span>
                        {entry.actor_id ? <span className="chip mono">{entry.actor_id}</span> : null}
                      </div>
                      <span className="muted">{formatDate(entry.created_at)}</span>
                    </div>
                    <pre className="json-block">{JSON.stringify(entry.metadata ?? {}, null, 2)}</pre>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
