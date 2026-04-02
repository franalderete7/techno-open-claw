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

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
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
      return "Page view";
    case "search":
      return "Búsqueda";
    case "view_content":
      return "Vista producto";
    case "contact":
      return "WhatsApp";
    case "initiate_checkout":
      return "Checkout";
    case "purchase":
      return "Compra";
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
    default:
      return "";
  }
}

function sourceLabel(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "Directo";
  if (normalized === "direct") return "Directo";
  if (normalized === "instagram") return "Instagram";
  if (normalized === "facebook") return "Facebook";
  if (normalized === "google") return "Google";
  if (normalized === "whatsapp") return "WhatsApp";
  if (normalized === "telegram") return "Telegram";
  if (normalized === "youtube") return "YouTube";
  if (normalized === "x") return "X";
  return value ?? "Directo";
}

function deviceLabel(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "unknown") return "Sin identificar";
  if (normalized === "desktop web") return "Desktop web";
  if (normalized === "iphone") return "iPhone";
  if (normalized === "ipad") return "iPad";
  if (normalized === "android") return "Android";
  if (normalized === "mac") return "Mac";
  if (normalized === "windows") return "Windows";
  if (normalized === "linux") return "Linux";
  return value ?? "Sin identificar";
}

function browserLabel(value: string | null | undefined) {
  if (!value) return null;
  if (value === "Unknown") return null;
  return value;
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

function barWidth(value: number, max: number) {
  if (max <= 0 || value <= 0) return "0%";
  return `${Math.max(8, (value / max) * 100)}%`;
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
    { key: "searches", label: "Búsquedas", color: "#9366cc" },
    { key: "view_contents", label: "Vistas producto", color: "#bf6f4d" },
    { key: "contacts", label: "Contactos", color: "#8a6c2c" },
    { key: "checkout_starts", label: "Checkout", color: "#4d698d" },
    { key: "purchases", label: "Compras", color: "#3e6a2f" },
  ] as const;

  const max = Math.max(1, ...daily.flatMap((point) => series.map((item) => point[item.key])));
  const guideValues = [0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio));
  const labels = daily.length <= 8 ? daily : daily.filter((_, index) => index === 0 || index === daily.length - 1 || index % 4 === 0);

  return (
    <div className="growth-chart-card">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">Ritmo de actividad</h3>
          <p className="panel-copy">Tendencia diaria de visitas, búsqueda, intención y compra en los últimos {days} días.</p>
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
        <svg viewBox={`0 0 ${width} ${height}`} className="growth-chart" role="img" aria-label="Tendencia diaria de eventos">
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
          <h3 className="panel-title">Funnel por sesión</h3>
          <p className="panel-copy">Cada paso muestra cuántas sesiones alcanzaron ese hito dentro de la ventana elegida.</p>
        </div>
      </div>

      <div className="growth-funnel">
        {funnel.map((step) => (
          <div key={step.key} className="growth-funnel-row">
            <div className="growth-funnel-head">
              <div>
                <strong>{step.label}</strong>
                <span className="muted">
                  {step.conversion_from_previous_pct == null ? "Base" : `${formatPct(step.conversion_from_previous_pct)} desde el paso anterior`}
                </span>
              </div>
              <strong>{formatNumber(step.count)}</strong>
            </div>
            <div className="growth-funnel-bar">
              <div className={`growth-funnel-fill is-${step.key}`} style={{ width: barWidth(step.count, max) }} />
            </div>
            <span className="muted">{formatPct(step.conversion_from_sessions_pct)} del total de sesiones</span>
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
          <h3 className="panel-title">Fuentes</h3>
          <p className="panel-copy">De dónde llega la sesión inicial. Las autorreferencias del sitio ya se tratan como tráfico directo.</p>
        </div>
      </div>

      <div className="growth-source-list">
        {sources.length === 0 ? <p className="empty">Todavía no hay fuentes registradas.</p> : null}
        {sources.map((source) => (
          <div key={source.source} className="growth-source-row">
            <div className="growth-source-head">
              <div>
                <strong>{sourceLabel(source.source)}</strong>
                <div className="chip-row">
                  <span className="chip accent">{formatNumber(source.sessions)} sesiones</span>
                  <span className="chip">{formatNumber(source.visitors)} visitantes</span>
                  <span className="chip">{formatPct(source.contacts > 0 ? (source.contacts / Math.max(source.sessions, 1)) * 100 : 0)} contacto</span>
                  {source.top_campaign ? <span className="chip warn">{source.top_campaign}</span> : null}
                </div>
              </div>
              <strong>{formatMoney(source.revenue_ars)}</strong>
            </div>
            <div className="growth-source-bar">
              <div className="growth-source-fill" style={{ width: barWidth(source.sessions, max) }} />
            </div>
            <div className="growth-source-meta">
              <span>{formatNumber(source.searches)} búsquedas</span>
              <span>{formatNumber(source.view_contents)} vistas producto</span>
              <span>{formatNumber(source.contacts)} contactos</span>
              <span>{formatNumber(source.checkout_starts)} checkouts</span>
              <span>{formatNumber(source.purchases)} compras</span>
              {source.landing_page ? <span className="mono">{source.landing_page}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function DevicePanel({ devices }: { devices: StorefrontAnalyticsOverviewResponse["devices"] }) {
  const max = Math.max(1, ...devices.map((item) => item.sessions));

  return (
    <article className="panel growth-panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">Dispositivos</h3>
          <p className="panel-copy">Familias de equipo detectadas desde navegador, sistema operativo y user agent.</p>
        </div>
      </div>

      <div className="growth-source-list">
        {devices.length === 0 ? <p className="empty">Todavía no hay datos de dispositivos.</p> : null}
        {devices.map((device) => (
          <div key={`${device.device_family}-${device.browser_name ?? "browser"}`} className="growth-source-row">
            <div className="growth-source-head">
              <div>
                <strong>{deviceLabel(device.device_family)}</strong>
                <div className="chip-row">
                  <span className="chip accent">{formatNumber(device.sessions)} sesiones</span>
                  <span className="chip">{device.device_type === "unknown" ? "tipo sin identificar" : device.device_type}</span>
                  {device.os_name ? <span className="chip">{device.os_name}</span> : null}
                  {browserLabel(device.browser_name) ? <span className="chip">{browserLabel(device.browser_name)}</span> : null}
                </div>
              </div>
              <strong>{formatMoney(device.revenue_ars)}</strong>
            </div>
            <div className="growth-source-bar">
              <div className="growth-source-fill" style={{ width: barWidth(device.sessions, max) }} />
            </div>
            <div className="growth-source-meta">
              <span>{formatNumber(device.searches)} búsquedas</span>
              <span>{formatNumber(device.view_contents)} vistas producto</span>
              <span>{formatNumber(device.contacts)} contactos</span>
              <span>{formatNumber(device.checkout_starts)} checkouts</span>
              <span>{formatNumber(device.purchases)} compras</span>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function SearchPanel({ searches }: { searches: StorefrontAnalyticsOverviewResponse["searches"] }) {
  const max = Math.max(1, ...searches.map((item) => item.searches));

  return (
    <article className="panel growth-panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">Lo que buscan</h3>
          <p className="panel-copy">Consultas consolidadas desde la caja de búsqueda. Las refinaciones rápidas se agrupan para no ensuciar la lectura.</p>
        </div>
      </div>

      <div className="growth-source-list">
        {searches.length === 0 ? <p className="empty">Todavía no hay búsquedas registradas.</p> : null}
        {searches.map((search) => (
          <div key={search.query} className="growth-source-row">
            <div className="growth-source-head">
              <div>
                <strong className="mono">{search.query}</strong>
                <div className="chip-row">
                  <span className="chip accent">{formatNumber(search.searches)} búsquedas</span>
                  <span className="chip">{formatNumber(search.sessions)} sesiones</span>
                  <span className="chip">{formatNumber(search.visitors)} visitantes</span>
                </div>
              </div>
              <strong>{search.avg_results_count != null ? `${search.avg_results_count} resultados` : "—"}</strong>
            </div>
            <div className="growth-source-bar">
              <div className="growth-source-fill" style={{ width: barWidth(search.searches, max) }} />
            </div>
            <div className="growth-source-meta">
              {search.top_source ? <span>{sourceLabel(search.top_source)}</span> : null}
              {search.top_device ? <span>{deviceLabel(search.top_device)}</span> : null}
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
          <span className="stat-label">Visitantes</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.visitors)}</strong>
          <span className="stat-note">{formatNumber(snapshot.totals.sessions)} sesiones</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Vistas producto</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.view_contents)}</strong>
          <span className="stat-note">{formatNumber(snapshot.totals.page_views)} page views</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Búsquedas</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.searches)}</strong>
          <span className="stat-note">{formatDuration(snapshot.totals.avg_session_duration_seconds)} promedio por sesión</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Contactos WhatsApp</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.contacts)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.contact_rate_pct)} de sesiones</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Inicios de checkout</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.checkout_starts)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.checkout_rate_pct)} de sesiones</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Compras</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.purchases)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.purchase_rate_pct)} de sesiones</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Revenue</span>
          <strong className="stat-value">{formatMoney(snapshot.totals.revenue_ars)}</strong>
          <span className="stat-note">{formatNumber(snapshot.totals.events)} eventos totales</span>
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
              <h3 className="panel-title">URLs de entrada</h3>
              <p className="panel-copy">Ordenadas por vistas de producto dentro de la ventana elegida, no por revenue ni por sesiones.</p>
            </div>
          </div>

          <div className="growth-source-list">
            {snapshot.landing_pages.length === 0 ? <p className="empty">Todavía no hay landings atribuidas.</p> : null}
            {snapshot.landing_pages.map((landing, index) => (
              <div key={landing.path} className="growth-source-row">
                <div className="growth-source-head">
                  <div>
                    <strong className="mono">{landing.path}</strong>
                    <div className="chip-row">
                      <span className="chip accent">#{index + 1}</span>
                      <span className="chip">{formatNumber(landing.view_contents)} vistas producto</span>
                      <span className="chip">{formatNumber(landing.sessions)} sesiones</span>
                      <span className="chip">{formatNumber(landing.visitors)} visitantes</span>
                    </div>
                  </div>
                  <strong>{formatMoney(landing.revenue_ars)}</strong>
                </div>
                <div className="growth-source-bar">
                  <div
                    className="growth-source-fill"
                    style={{ width: barWidth(landing.view_contents || landing.page_views || landing.sessions, Math.max(1, ...snapshot.landing_pages.map((item) => item.view_contents || item.page_views || item.sessions))) }}
                  />
                </div>
                <div className="growth-source-meta">
                  <span>{formatNumber(landing.page_views)} page views</span>
                  <span>{formatNumber(landing.contacts)} contactos</span>
                  <span>{formatNumber(landing.checkout_starts)} checkouts</span>
                  <span>{formatNumber(landing.purchases)} compras</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="split-grid growth-top-grid">
        <DevicePanel devices={snapshot.devices} />
        <SearchPanel searches={snapshot.searches} />
      </section>

      <section className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Productos más vistos</h3>
            <p className="panel-copy">Ordenados por vistas de producto por defecto, con contacto y checkout al lado para ver intención real.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Vistas</th>
                <th>Contactos</th>
                <th>Checkouts</th>
                <th>Compras</th>
                <th>Revenue</th>
                <th>Última señal</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">Todavía no hay eventos a nivel producto.</td>
                </tr>
              ) : null}
              {snapshot.products.map((product) => (
                <tr key={product.product_id ?? product.sku ?? product.title}>
                  <td>
                    <div className="value-stack">
                      <strong>{product.title}</strong>
                      <span className="chip-row">
                        {product.sku ? <span className="chip accent mono">{product.sku}</span> : null}
                        {product.url_path ? <span className="chip mono">{product.url_path}</span> : null}
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
            <h3 className="panel-title">Personas y recorridos</h3>
            <p className="panel-copy">Visitantes agregados por identidad técnica, luego enriquecidos cuando aparece un cliente real.</p>
          </div>
        </div>

        <div className="growth-people-grid">
          {snapshot.people.length === 0 ? <p className="empty">Todavía no hay recorridos de visitantes.</p> : null}
          {snapshot.people.map((person) => (
            <article key={person.visitor_id} className="record-card growth-person-card">
              <div className="panel-header growth-person-header">
                <div>
                  <h4 className="growth-person-title">{person.label}</h4>
                  <p className="panel-copy mono">{person.visitor_id}</p>
                </div>
                <span className="chip accent">{sourceLabel(person.source)}</span>
              </div>

              <div className="record-meta-grid">
                <div>
                  <dt>Primera vez</dt>
                  <dd>{formatDateTime(person.first_seen)}</dd>
                </div>
                <div>
                  <dt>Última vez</dt>
                  <dd>{formatDateTime(person.last_seen)}</dd>
                </div>
                <div>
                  <dt>Entrada</dt>
                  <dd className="mono">{person.landing_page ?? "—"}</dd>
                </div>
                <div>
                  <dt>Último producto</dt>
                  <dd>{person.last_product ?? "—"}</dd>
                </div>
                <div>
                  <dt>Dispositivo</dt>
                  <dd>{deviceLabel(person.device_family)}</dd>
                </div>
              </div>

              <div className="chip-row">
                <span className="chip">{person.sessions} sesiones</span>
                <span className="chip">{person.page_views} page views</span>
                <span className="chip">{person.view_contents} vistas</span>
                <span className="chip warn">{person.contacts} contactos</span>
                <span className="chip accent">{person.checkout_starts} checkouts</span>
                <span className="chip good">{person.purchases} compras</span>
              </div>

              <div className="record-meta-grid">
                <div>
                  <dt>Cliente</dt>
                  <dd>{person.identified_customer ?? "Anónimo"}</dd>
                </div>
                <div>
                  <dt>Revenue</dt>
                  <dd>{formatMoney(person.revenue_ars)}</dd>
                </div>
                <div>
                  <dt>Teléfono</dt>
                  <dd>{person.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{person.email ?? "—"}</dd>
                </div>
                <div>
                  <dt>Promedio sesión</dt>
                  <dd>{formatDuration(person.avg_session_duration_seconds)}</dd>
                </div>
                <div>
                  <dt>Navegador</dt>
                  <dd>{browserLabel(person.browser_name) ?? person.os_name ?? "—"}</dd>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Feed reciente de eventos</h3>
            <p className="panel-copy">Las últimas acciones registradas en storefront, ordenadas de más nueva a más vieja.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Evento</th>
                <th>Fuente</th>
                <th>Página</th>
                <th>Producto o búsqueda</th>
                <th>Persona</th>
                <th>Orden</th>
                <th>Valor</th>
                <th>Cuándo</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.recent_events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">Todavía no hay eventos capturados.</td>
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
                      <strong>{sourceLabel(event.source)}</strong>
                      {event.campaign ? <span className="muted">{event.campaign}</span> : null}
                    </div>
                  </td>
                  <td className="mono">{event.page_path ?? "—"}</td>
                  <td>{event.search_query ? `search: ${event.search_query}` : event.product ?? "—"}</td>
                  <td>
                    <div className="value-stack">
                      <strong>{event.person ?? "Anónimo"}</strong>
                      <span className="muted mono">
                        {event.visitor ?? "—"}
                        {event.device_family ? ` · ${deviceLabel(event.device_family)}` : ""}
                      </span>
                    </div>
                  </td>
                  <td>{event.order_number ?? "—"}</td>
                  <td>{event.value_amount != null ? formatMoney(event.value_amount, event.currency_code || "ARS") : "—"}</td>
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
