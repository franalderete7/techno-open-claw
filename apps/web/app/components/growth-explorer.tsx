import type { StorefrontAnalyticsOverviewResponse } from "../../lib/api";

type GrowthExplorerProps = {
  snapshot: StorefrontAnalyticsOverviewResponse;
  days: number;
};

function asNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : 0;
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("es-AR").format(asNumber(value));
}

function formatMoney(value: number | null | undefined, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(asNumber(value));
}

function formatPct(value: number | null | undefined) {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDateLabel(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("es-AR", {
    month: "short",
    day: "numeric",
  });
}

function eventLabel(value: string) {
  switch (value) {
    case "page_view":
      return "PageView";
    case "view_content":
      return "ViewContent";
    case "contact":
      return "Contact";
    case "initiate_checkout":
      return "InitiateCheckout";
    case "purchase":
      return "Purchase";
    default:
      return value;
  }
}

function eventTone(value: string) {
  switch (value) {
    case "purchase":
      return "good";
    case "initiate_checkout":
      return "accent";
    case "contact":
      return "warn";
    case "view_content":
      return "";
    case "page_view":
    default:
      return "";
  }
}

function buildLinePath(values: number[], width: number, height: number, padding = 18) {
  const max = Math.max(1, ...values);
  const drawableWidth = width - padding * 2;
  const drawableHeight = height - padding * 2;

  return values
    .map((value, index) => {
      const x = padding + (values.length <= 1 ? drawableWidth / 2 : (index / (values.length - 1)) * drawableWidth);
      const y = padding + drawableHeight - (value / max) * drawableHeight;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function ActivityChart({
  daily,
  days,
}: {
  daily: StorefrontAnalyticsOverviewResponse["daily"];
  days: number;
}) {
  const width = 740;
  const height = 260;
  const series = [
    { key: "page_views", label: "Page views", color: "#b68f7a" },
    { key: "view_contents", label: "Product views", color: "#bf6f4d" },
    { key: "contacts", label: "Contacts", color: "#8a6c2c" },
    { key: "checkout_starts", label: "Checkout", color: "#4d698d" },
    { key: "purchases", label: "Purchases", color: "#3e6a2f" },
  ] as const;

  const max = Math.max(1, ...daily.flatMap((point) => series.map((item) => point[item.key])));
  const guideValues = [0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio));
  const labels = daily.length <= 8 ? daily : daily.filter((_, index) => index === 0 || index === daily.length - 1 || index % 4 === 0);

  return (
    <div className="growth-chart-card">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">Ritmo de actividad</h3>
          <p className="panel-copy">Tendencia diaria de visitas, intención y compras en los últimos {days} días.</p>
        </div>
      </div>

      <div className="growth-legend">
        {series.map((item) => (
          <span key={item.key} className="chip">
            <span className="growth-legend-dot" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      <div className="growth-chart-shell">
        <div className="growth-chart-guides">
          {guideValues.reverse().map((value) => (
            <span key={value}>{formatNumber(value)}</span>
          ))}
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="growth-chart" role="img" aria-label="Event timeline chart">
          {guideValues.map((value, index) => {
            const y = 18 + (height - 36) - (value / max) * (height - 36);
            return (
              <line
                key={`${value}-${index}`}
                x1="18"
                x2={width - 18}
                y1={y}
                y2={y}
                stroke="rgba(20,20,19,0.08)"
                strokeDasharray="4 6"
              />
            );
          })}
          {series.map((item) => (
            <path
              key={item.key}
              d={buildLinePath(
                daily.map((point) => point[item.key]),
                width,
                height
              )}
              fill="none"
              stroke={item.color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>

      <div className="growth-chart-labels">
        {labels.map((point) => (
          <span key={point.date}>{formatDateLabel(point.date)}</span>
        ))}
      </div>
    </div>
  );
}

function FunnelPanel({ funnel }: { funnel: StorefrontAnalyticsOverviewResponse["funnel"] }) {
  const max = Math.max(1, ...funnel.map((item) => item.count));

  return (
    <article className="panel growth-panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">Funnel</h3>
          <p className="panel-copy">Cómo cae el recorrido desde visita hasta compra.</p>
        </div>
      </div>

      <div className="growth-funnel">
        {funnel.map((step) => (
          <div key={step.key} className="growth-funnel-row">
            <div className="growth-funnel-head">
              <div>
                <strong>{step.label}</strong>
                <span className="muted">
                  {formatPct(step.conversion_from_previous_pct)} desde el paso anterior
                </span>
              </div>
              <strong>{formatNumber(step.count)}</strong>
            </div>
            <div className="growth-funnel-bar">
              <div className={`growth-funnel-fill is-${step.key}`} style={{ width: `${(step.count / max) * 100}%` }} />
            </div>
            <span className="muted"> {formatPct(step.conversion_from_sessions_pct)} de las sesiones</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function SourcePanel({ sources }: { sources: StorefrontAnalyticsOverviewResponse["sources"] }) {
  const max = Math.max(1, ...sources.map((item) => item.sessions));

  return (
    <article className="panel growth-panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">De dónde llegan</h3>
          <p className="panel-copy">La primera fuente detectada por sesión con resultado downstream.</p>
        </div>
      </div>

      <div className="growth-source-list">
        {sources.length === 0 ? <p className="empty">Todavía no hay fuentes registradas.</p> : null}
        {sources.map((source) => (
          <div key={source.source} className="growth-source-row">
            <div className="growth-source-head">
              <div>
                <strong>{source.source}</strong>
                <div className="chip-row">
                  <span className="chip accent">{source.sessions} sesiones</span>
                  <span className="chip">{source.visitors} visitors</span>
                  {source.top_campaign ? <span className="chip warn">{source.top_campaign}</span> : null}
                </div>
              </div>
              <strong>{formatMoney(source.revenue_ars)}</strong>
            </div>
            <div className="growth-source-bar">
              <div className="growth-source-fill" style={{ width: `${(source.sessions / max) * 100}%` }} />
            </div>
            <div className="growth-source-meta">
              <span>{formatNumber(source.view_contents)} views</span>
              <span>{formatNumber(source.contacts)} contacts</span>
              <span>{formatNumber(source.checkout_starts)} checkouts</span>
              <span>{formatNumber(source.purchases)} purchases</span>
              {source.landing_page ? <span className="mono">{source.landing_page}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export function GrowthExplorer({ snapshot, days }: GrowthExplorerProps) {
  return (
    <div className="page-stack">
      {snapshot.warnings.length > 0 ? (
        <section className="panel growth-warning-panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Notas del sistema</h3>
              <p className="panel-copy">Señales rápidas para que marketing y producto sepan qué mirar primero.</p>
            </div>
          </div>

          <div className="growth-warning-list">
            {snapshot.warnings.map((warning) => (
              <p key={warning} className="growth-warning-item">
                {warning}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <section className="stats-grid">
        <article className="stat-card">
          <span className="stat-label">Visitors</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.visitors)}</strong>
          <span className="stat-note">{formatNumber(snapshot.totals.sessions)} sesiones</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Product Views</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.view_contents)}</strong>
          <span className="stat-note">{formatNumber(snapshot.totals.page_views)} pageviews</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">WhatsApp Contacts</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.contacts)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.contact_rate_pct)} of sessions</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Checkout Starts</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.checkout_starts)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.checkout_rate_pct)} of sessions</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Purchases</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.purchases)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.purchase_rate_pct)} of sessions</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Revenue</span>
          <strong className="stat-value">{formatMoney(snapshot.totals.revenue_ars)}</strong>
          <span className="stat-note">{formatNumber(snapshot.totals.events)} total events</span>
        </article>
      </section>

      <section className="split-grid growth-top-grid">
        <ActivityChart daily={snapshot.daily} days={days} />
        <FunnelPanel funnel={snapshot.funnel} />
      </section>

      <section className="split-grid growth-top-grid">
        <SourcePanel sources={snapshot.sources} />

        <article className="panel growth-panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Landing pages</h3>
              <p className="panel-copy">Qué URLs abren la relación y cuáles convierten mejor.</p>
            </div>
          </div>

          <div className="growth-source-list">
            {snapshot.landing_pages.length === 0 ? <p className="empty">Todavía no hay landings atribuidas.</p> : null}
            {snapshot.landing_pages.map((landing) => (
              <div key={landing.path} className="growth-source-row">
                <div className="growth-source-head">
                  <div>
                    <strong className="mono">{landing.path}</strong>
                    <div className="chip-row">
                      <span className="chip accent">{landing.sessions} sesiones</span>
                      <span className="chip">{landing.visitors} visitors</span>
                    </div>
                  </div>
                  <strong>{formatMoney(landing.revenue_ars)}</strong>
                </div>
                <div className="growth-source-meta">
                  <span>{formatNumber(landing.view_contents)} views</span>
                  <span>{formatNumber(landing.contacts)} contacts</span>
                  <span>{formatNumber(landing.checkout_starts)} checkouts</span>
                  <span>{formatNumber(landing.purchases)} purchases</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Top products</h3>
            <p className="panel-copy">Qué equipos atraen atención, conversación y ventas dentro de la ventana seleccionada.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Views</th>
                <th>Contacts</th>
                <th>Checkouts</th>
                <th>Purchases</th>
                <th>Revenue</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">No product-level events yet.</td>
                </tr>
              ) : null}
              {snapshot.products.map((product) => (
                <tr key={product.product_id ?? product.sku ?? product.title}>
                  <td>
                    <div className="value-stack">
                      <strong>{product.title}</strong>
                      <span className="chip-row">
                        {product.sku ? <span className="chip accent mono">{product.sku}</span> : null}
                        {product.brand ? <span className="chip">{product.brand}</span> : null}
                      </span>
                    </div>
                  </td>
                  <td>{formatNumber(product.view_contents)}</td>
                  <td>{formatNumber(product.contacts)}</td>
                  <td>{formatNumber(product.checkout_starts)}</td>
                  <td>{formatNumber(product.purchases)}</td>
                  <td>{formatMoney(product.revenue_ars)}</td>
                  <td>{formatDateTime(product.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">People and journeys</h3>
            <p className="panel-copy">Visitors aggregated by browser identity, stitched forward when a real customer becomes known.</p>
          </div>
        </div>

        <div className="growth-people-grid">
          {snapshot.people.length === 0 ? <p className="empty">No visitor journeys yet.</p> : null}
          {snapshot.people.map((person) => (
            <article key={person.visitor_id} className="record-card growth-person-card">
              <div className="panel-header growth-person-header">
                <div>
                  <h4 className="growth-person-title">{person.label}</h4>
                  <p className="panel-copy mono">{person.visitor_id}</p>
                </div>
                <span className="chip accent">{person.source}</span>
              </div>

              <div className="record-meta-grid">
                <div>
                  <dt>First seen</dt>
                  <dd>{formatDateTime(person.first_seen)}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{formatDateTime(person.last_seen)}</dd>
                </div>
                <div>
                  <dt>Landing</dt>
                  <dd className="mono">{person.landing_page ?? "—"}</dd>
                </div>
                <div>
                  <dt>Last product</dt>
                  <dd>{person.last_product ?? "—"}</dd>
                </div>
              </div>

              <div className="chip-row">
                <span className="chip">{person.sessions} sessions</span>
                <span className="chip">{person.page_views} pageviews</span>
                <span className="chip">{person.view_contents} views</span>
                <span className="chip warn">{person.contacts} contacts</span>
                <span className="chip accent">{person.checkout_starts} checkouts</span>
                <span className="chip good">{person.purchases} purchases</span>
              </div>

              <div className="record-meta-grid">
                <div>
                  <dt>Customer</dt>
                  <dd>{person.identified_customer ?? "Anonymous"}</dd>
                </div>
                <div>
                  <dt>Revenue</dt>
                  <dd>{formatMoney(person.revenue_ars)}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{person.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{person.email ?? "—"}</dd>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Recent event feed</h3>
            <p className="panel-copy">The latest tracked storefront actions, ordered newest first.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Source</th>
                <th>Page</th>
                <th>Product</th>
                <th>Person</th>
                <th>Order</th>
                <th>Value</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.recent_events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">No events captured yet.</td>
                </tr>
              ) : null}
              {snapshot.recent_events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <span className={`chip ${eventTone(event.event_name)}`}>{eventLabel(event.event_name)}</span>
                    <div className="muted">{event.received_from}</div>
                  </td>
                  <td>
                    <div className="value-stack">
                      <strong>{event.source}</strong>
                      {event.campaign ? <span className="muted">{event.campaign}</span> : null}
                    </div>
                  </td>
                  <td className="mono">{event.page_path ?? "—"}</td>
                  <td>{event.product ?? "—"}</td>
                  <td>
                    <div className="value-stack">
                      <strong>{event.person ?? "Anonymous"}</strong>
                      <span className="muted mono">{event.visitor ?? "—"}</span>
                    </div>
                  </td>
                  <td>{event.order_number ?? "—"}</td>
                  <td>
                    {event.value_amount != null ? formatMoney(event.value_amount, event.currency_code || "ARS") : "—"}
                  </td>
                  <td>{formatDateTime(event.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
