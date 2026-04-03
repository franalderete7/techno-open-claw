import Link from "next/link";
import type { ReactNode } from "react";
import type { StorefrontAnalyticsOverviewResponse } from "../../lib/api";

type GrowthExplorerProps = {
  snapshot: StorefrontAnalyticsOverviewResponse;
  days: number;
};

type GrowthSummaryBadge = {
  label: string;
  tone?: "accent" | "good" | "warn";
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
      return "Visita";
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
  if (!normalized || normalized === "direct") return "Directo";
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
  if (normalized === "desktop web") return "Desktop";
  if (normalized === "mobile web") return "Mobile web";
  if (normalized === "tablet web") return "Tablet web";
  if (normalized === "iphone") return "iPhone";
  if (normalized === "ipad") return "iPad";
  if (normalized === "android") return "Android";
  if (normalized === "mac") return "Mac";
  if (normalized === "windows") return "Windows";
  if (normalized === "linux") return "Linux";
  return value ?? "Sin identificar";
}

function browserLabel(value: string | null | undefined) {
  if (!value || value === "Unknown") return null;
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
  return `${Math.max(6, (value / max) * 100)}%`;
}

function buildGrowthHref(
  days: number,
  applied: { source: string | null; device: string | null },
  overrides: Partial<{ source: string | null; device: string | null }>
) {
  const params = new URLSearchParams();
  params.set("days", String(days));

  const source = overrides.source !== undefined ? overrides.source : applied.source;
  const device = overrides.device !== undefined ? overrides.device : applied.device;

  if (source) params.set("source", source);
  if (device) params.set("device", device);
  return `/growth?${params.toString()}`;
}

function isUnknownishDevice(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === "unknown";
}

function GrowthSection({
  title,
  copy,
  badges,
  defaultOpen = true,
  children,
}: {
  title: string;
  copy: string;
  badges?: GrowthSummaryBadge[];
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const openProps = defaultOpen ? { open: true } : {};

  return (
    <details className="panel growth-section" {...openProps}>
      <summary className="growth-section-summary">
        <div className="growth-section-heading">
          <h3 className="panel-title">{title}</h3>
          <p className="panel-copy">{copy}</p>
        </div>
        {badges?.length ? (
          <div className="chip-row growth-section-meta">
            {badges.map((badge) => (
              <span key={badge.label} className={`chip ${badge.tone ?? ""}`}>
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </summary>
      <div className="growth-section-body">{children}</div>
    </details>
  );
}

function ActivityChart({
  daily,
  days,
}: {
  daily: StorefrontAnalyticsOverviewResponse["daily"];
  days: number;
}) {
  const width = 740;
  const height = 240;
  const series = [
    { key: "page_views", label: "Visitas", color: "#b68f7a" },
    { key: "searches", label: "Búsquedas", color: "#9366cc" },
    { key: "view_contents", label: "Vistas producto", color: "#bf6f4d" },
    { key: "contacts", label: "WhatsApp", color: "#8a6c2c" },
    { key: "checkout_starts", label: "Checkout", color: "#4d698d" },
    { key: "purchases", label: "Compras", color: "#3e6a2f" },
  ] as const;

  const activeSeries = series.filter((item) => daily.some((point) => point[item.key] > 0));
  const visibleSeries = activeSeries.length > 0 ? activeSeries : series.slice(0, 1);
  const values = daily.flatMap((point) => visibleSeries.map((item) => point[item.key]));
  const max = Math.max(1, ...values);
  const guideValues = [0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio));
  const labelModulo = daily.length > 14 ? 6 : daily.length > 8 ? 4 : 2;
  const labels = daily.filter((_, index) => index === 0 || index === daily.length - 1 || index % labelModulo === 0);

  return (
    <article className="growth-chart-card">
      <div className="panel-header">
        <div>
          <h4 className="panel-title">Ritmo de actividad</h4>
          <p className="panel-copy">Tendencia diaria consolidada en los últimos {days} días.</p>
        </div>
      </div>

      <div className="growth-legend">
        {visibleSeries.map((item) => (
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
        <svg viewBox={`0 0 ${width} ${height}`} className="growth-chart" role="img" aria-label="Tendencia diaria de actividad">
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
          {visibleSeries.map((item) => (
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
    </article>
  );
}

function FunnelPanel({ funnel }: { funnel: StorefrontAnalyticsOverviewResponse["funnel"] }) {
  const max = Math.max(1, ...funnel.map((item) => item.count));

  return (
    <article className="growth-table-card">
      <div className="panel-header">
        <div>
          <h4 className="panel-title">Embudo por sesión</h4>
          <p className="panel-copy">Cuántas sesiones llegan a cada hito real del recorrido.</p>
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
            <span className="muted">{formatPct(step.conversion_from_sessions_pct)} de las sesiones</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function GrowthTableCard({
  title,
  copy,
  children,
}: {
  title: string;
  copy: string;
  children: ReactNode;
}) {
  return (
    <article className="table-card growth-table-card">
      <div className="panel-header">
        <div>
          <h4 className="panel-title">{title}</h4>
          <p className="panel-copy">{copy}</p>
        </div>
      </div>
      <div className="table-wrap">{children}</div>
    </article>
  );
}

function GrowthExplorer({ snapshot, days }: GrowthExplorerProps) {
  const productUrls = snapshot.products
    .filter((product) => product.url_path)
    .sort((a, b) => b.view_contents - a.view_contents || b.contacts - a.contacts || b.checkout_starts - a.checkout_starts)
    .slice(0, 12);

  const meaningfulEntryPages = snapshot.landing_pages.filter((landing) => landing.path !== "/" && landing.path !== "(unknown)");
  const entryPages = meaningfulEntryPages.length > 0 ? meaningfulEntryPages : snapshot.landing_pages;

  const knownDeviceSessions = snapshot.devices
    .filter((device) => !isUnknownishDevice(device.device_family))
    .reduce((sum, device) => sum + device.sessions, 0);
  const deviceSessions = snapshot.devices.reduce((sum, device) => sum + device.sessions, 0);
  const deviceCoveragePct = deviceSessions > 0 ? (knownDeviceSessions / deviceSessions) * 100 : null;

  return (
    <div className="page-stack">
      {snapshot.warnings.length > 0 ? (
        <section className="panel growth-warning-panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Alertas rápidas</h3>
              <p className="panel-copy">Señales que conviene revisar antes de sacar conclusiones de marketing.</p>
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

      <section className="stats-grid growth-kpi-grid">
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
          <span className="stat-label">WhatsApp</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.contacts)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.contact_rate_pct)} de sesiones</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Checkout</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.checkout_starts)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.checkout_rate_pct)} de sesiones</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Compras</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.purchases)}</strong>
          <span className="stat-note">{formatMoney(snapshot.totals.revenue_ars)} revenue</span>
        </article>
      </section>

      <GrowthSection
        title="Overview"
        copy="La parte que más se consulta debería quedar arriba: volumen, tendencia y embudo."
        badges={[
          { label: `${formatNumber(snapshot.totals.events)} eventos`, tone: "accent" },
          { label: `${days} días` },
          snapshot.filters.applied.source ? { label: `Fuente: ${sourceLabel(snapshot.filters.applied.source)}` } : null,
          snapshot.filters.applied.device ? { label: `Dispositivo: ${deviceLabel(snapshot.filters.applied.device)}` } : null,
        ].filter((badge): badge is GrowthSummaryBadge => badge != null)}
      >
        <section className="split-grid growth-top-grid">
          <ActivityChart daily={snapshot.daily} days={days} />
          <FunnelPanel funnel={snapshot.funnel} />
        </section>
      </GrowthSection>

      <GrowthSection
        title="Adquisición y demanda"
        copy="Fuentes, equipos y términos de búsqueda en tablas compactas, para leer la ventana rápido."
        badges={[
          { label: `${snapshot.sources.length} fuentes` },
          { label: `${snapshot.devices.length} dispositivos` },
          deviceCoveragePct != null ? { label: `${formatPct(deviceCoveragePct)} detección útil`, tone: deviceCoveragePct >= 70 ? "good" : "warn" } : null,
        ].filter((badge): badge is GrowthSummaryBadge => badge != null)}
      >
        <div className="growth-table-grid">
          <GrowthTableCard
            title="Fuentes"
            copy="Ordenadas por sesiones, con links rápidos para filtrar la vista."
          >
            <table className="table is-compact">
              <thead>
                <tr>
                  <th>Fuente</th>
                  <th>Sesiones</th>
                  <th>Visitantes</th>
                  <th>Vistas</th>
                  <th>Contactos</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.sources.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">Todavía no hay fuentes registradas.</td>
                  </tr>
                ) : null}
                {snapshot.sources.map((source) => (
                  <tr key={source.source}>
                    <td>
                      <div className="value-stack">
                        <Link
                          href={buildGrowthHref(days, snapshot.filters.applied, { source: source.source })}
                          className="growth-table-link"
                        >
                          {sourceLabel(source.source)}
                        </Link>
                        <span className="muted">
                          {source.top_campaign ? source.top_campaign : source.landing_page ?? "Sin campaña"}
                        </span>
                      </div>
                    </td>
                    <td>{formatNumber(source.sessions)}</td>
                    <td>{formatNumber(source.visitors)}</td>
                    <td>{formatNumber(source.view_contents)}</td>
                    <td>{formatNumber(source.contacts)}</td>
                    <td>{formatMoney(source.revenue_ars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GrowthTableCard>

          <GrowthTableCard
            title="Dispositivos"
            copy="Cuando no se puede identificar bien, la fila queda al final como Sin identificar."
          >
            <table className="table is-compact">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th>Sesiones</th>
                  <th>Búsquedas</th>
                  <th>Vistas</th>
                  <th>Contactos</th>
                  <th>Checkout</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.devices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">Todavía no hay datos de dispositivos.</td>
                  </tr>
                ) : null}
                {snapshot.devices.map((device) => (
                  <tr key={`${device.device_family}-${device.browser_name ?? "browser"}`}>
                    <td>
                      <div className="value-stack">
                        <Link
                          href={buildGrowthHref(days, snapshot.filters.applied, { device: device.device_family })}
                          className="growth-table-link"
                        >
                          {deviceLabel(device.device_family)}
                        </Link>
                        <span className="muted">
                          {[device.device_type === "unknown" ? null : device.device_type, device.os_name, browserLabel(device.browser_name)]
                            .filter(Boolean)
                            .join(" · ") || "Sin detalle técnico"}
                        </span>
                      </div>
                    </td>
                    <td>{formatNumber(device.sessions)}</td>
                    <td>{formatNumber(device.searches)}</td>
                    <td>{formatNumber(device.view_contents)}</td>
                    <td>{formatNumber(device.contacts)}</td>
                    <td>{formatNumber(device.checkout_starts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GrowthTableCard>
        </div>

        <div className="growth-table-grid">
          <GrowthTableCard
            title="Lo que buscan"
            copy="Consultas reales ya limpiadas para que no manden el panel al ruido."
          >
            <table className="table is-compact">
              <thead>
                <tr>
                  <th>Búsqueda</th>
                  <th>Veces</th>
                  <th>Sesiones</th>
                  <th>Resultados</th>
                  <th>Fuente</th>
                  <th>Equipo</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.searches.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">Todavía no hay búsquedas útiles registradas.</td>
                  </tr>
                ) : null}
                {snapshot.searches.map((search) => (
                  <tr key={search.query}>
                    <td className="mono">{search.query}</td>
                    <td>{formatNumber(search.searches)}</td>
                    <td>{formatNumber(search.sessions)}</td>
                    <td>{search.avg_results_count != null ? formatNumber(search.avg_results_count) : "—"}</td>
                    <td>{sourceLabel(search.top_source)}</td>
                    <td>{deviceLabel(search.top_device)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GrowthTableCard>

          <GrowthTableCard
            title="URLs de entrada"
            copy="Landings reales que abren la relación. El root se corre del foco para no ensuciar la lectura."
          >
            <table className="table is-compact">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Vistas</th>
                  <th>Sesiones</th>
                  <th>Contactos</th>
                  <th>Checkout</th>
                  <th>Compras</th>
                </tr>
              </thead>
              <tbody>
                {entryPages.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">Todavía no hay landings con señal útil.</td>
                  </tr>
                ) : null}
                {entryPages.map((landing) => (
                  <tr key={landing.path}>
                    <td className="mono">{landing.path}</td>
                    <td>{formatNumber(landing.view_contents)}</td>
                    <td>{formatNumber(landing.sessions)}</td>
                    <td>{formatNumber(landing.contacts)}</td>
                    <td>{formatNumber(landing.checkout_starts)}</td>
                    <td>{formatNumber(landing.purchases)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GrowthTableCard>
        </div>
      </GrowthSection>

      <GrowthSection
        title="Productos y URLs"
        copy="Las URLs de producto están ordenadas por vistas por defecto, y la tabla de productos conserva contacto, checkout y revenue al lado."
        badges={[
          { label: `${snapshot.products.length} productos` },
          { label: `${productUrls.length} URLs visibles`, tone: "accent" },
        ]}
      >
        <div className="growth-table-grid">
          <GrowthTableCard
            title="URLs de producto"
            copy="Ordenadas por vistas de producto para ver rápido qué PDP mueve más intención."
          >
            <table className="table is-compact">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Vistas</th>
                  <th>Contactos</th>
                  <th>Checkout</th>
                  <th>Compras</th>
                  <th>Última señal</th>
                </tr>
              </thead>
              <tbody>
                {productUrls.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">Todavía no hay URLs de producto con actividad.</td>
                  </tr>
                ) : null}
                {productUrls.map((product) => (
                  <tr key={product.sku ?? product.url_path ?? product.title}>
                    <td>
                      <div className="value-stack">
                        <strong className="mono">{product.url_path}</strong>
                        <span className="muted">{product.title}</span>
                      </div>
                    </td>
                    <td>{formatNumber(product.view_contents)}</td>
                    <td>{formatNumber(product.contacts)}</td>
                    <td>{formatNumber(product.checkout_starts)}</td>
                    <td>{formatNumber(product.purchases)}</td>
                    <td>{formatDateTime(product.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GrowthTableCard>

          <GrowthTableCard
            title="Top productos"
            copy="Misma lógica: primero vistas, después señales más profundas."
          >
            <table className="table is-compact">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Vistas</th>
                  <th>Contactos</th>
                  <th>Checkout</th>
                  <th>Compras</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.products.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">Todavía no hay eventos a nivel producto.</td>
                  </tr>
                ) : null}
                {snapshot.products.map((product) => (
                  <tr key={product.product_id ?? product.sku ?? product.title}>
                    <td>
                      <div className="value-stack">
                        <strong>{product.title}</strong>
                        <span className="muted">
                          {[product.sku, product.brand, product.url_path].filter(Boolean).join(" · ") || "Sin detalle"}
                        </span>
                      </div>
                    </td>
                    <td>{formatNumber(product.view_contents)}</td>
                    <td>{formatNumber(product.contacts)}</td>
                    <td>{formatNumber(product.checkout_starts)}</td>
                    <td>{formatNumber(product.purchases)}</td>
                    <td>{formatMoney(product.revenue_ars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GrowthTableCard>
        </div>
      </GrowthSection>

      <GrowthSection
        title="Personas y recorridos"
        copy="Queda plegado por defecto para que no invada la lectura. Abrís sólo a quien necesitás mirar."
        defaultOpen={false}
        badges={[
          { label: `${snapshot.people.length} recorridos` },
          { label: `${formatDuration(snapshot.totals.avg_session_duration_seconds)} promedio`, tone: "accent" },
        ]}
      >
        <div className="growth-people-list">
          {snapshot.people.length === 0 ? <p className="empty">Todavía no hay recorridos de visitantes.</p> : null}
          {snapshot.people.map((person) => (
            <details key={person.visitor_id} className="field-details growth-person-fold">
              <summary className="fold-summary growth-person-summary">
                <div className="growth-person-summary-main">
                  <strong>{person.label}</strong>
                  <span className="muted">
                    {sourceLabel(person.source)} · {formatNumber(person.sessions)} sesiones · {formatDateTime(person.last_seen)}
                  </span>
                </div>
                <span className="fold-meta">{person.last_product ?? person.landing_page ?? "Sin producto"}</span>
              </summary>

              <div className="record-meta-grid growth-person-body">
                <div>
                  <dt>Primera vez</dt>
                  <dd>{formatDateTime(person.first_seen)}</dd>
                </div>
                <div>
                  <dt>Última vez</dt>
                  <dd>{formatDateTime(person.last_seen)}</dd>
                </div>
                <div>
                  <dt>Landing</dt>
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
                <div>
                  <dt>Navegador</dt>
                  <dd>{browserLabel(person.browser_name) ?? person.os_name ?? "—"}</dd>
                </div>
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
              </div>

              <div className="chip-row growth-person-chips">
                <span className="chip">{formatNumber(person.page_views)} visitas</span>
                <span className="chip">{formatNumber(person.view_contents)} vistas producto</span>
                <span className="chip warn">{formatNumber(person.contacts)} contactos</span>
                <span className="chip accent">{formatNumber(person.checkout_starts)} checkouts</span>
                <span className="chip good">{formatNumber(person.purchases)} compras</span>
              </div>
            </details>
          ))}
        </div>
      </GrowthSection>

      <GrowthSection
        title="Feed reciente de eventos"
        copy="También queda plegado: sirve para inspección fina, no para la vista de gestión."
        defaultOpen={false}
        badges={[
          { label: `${snapshot.recent_events.length} eventos recientes` },
          { label: "Más nuevo primero", tone: "accent" },
        ]}
      >
        <section className="table-card growth-table-card">
          <div className="table-wrap">
            <table className="table is-compact">
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
      </GrowthSection>
    </div>
  );
}

export { GrowthExplorer };
