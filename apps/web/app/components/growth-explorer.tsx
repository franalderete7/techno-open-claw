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

function buildGrowthHref(
  days: number,
  applied: { source: string | null; device: string | null; interval: "day" | "week" | "month" },
  overrides: Partial<{ source: string | null; device: string | null; interval: "day" | "week" | "month" | null }>
) {
  const params = new URLSearchParams();
  params.set("days", String(days));

  const source = overrides.source !== undefined ? overrides.source : applied.source;
  const device = overrides.device !== undefined ? overrides.device : applied.device;
  const interval = overrides.interval !== undefined ? overrides.interval : applied.interval;

  if (source) params.set("source", source);
  if (device) params.set("device", device);
  if (interval) params.set("interval", interval);
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
  copy?: string;
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
          {copy ? <p className="panel-copy">{copy}</p> : null}
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

function GrowthTableCard({
  title,
  copy,
  children,
}: {
  title: string;
  copy?: string;
  children: ReactNode;
}) {
  return (
    <article className="table-card growth-table-card">
      <div className="panel-header growth-table-card-head">
        <div>
          <h4 className="panel-title">{title}</h4>
          {copy ? <p className="panel-copy">{copy}</p> : null}
        </div>
      </div>
      <div className="table-wrap">{children}</div>
    </article>
  );
}

function truncateText(value: string, max = 96) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
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
  const productViewStep = snapshot.journey.find((step) => step.key === "view_content");
  const topSearch = snapshot.searches[0] ?? null;

  return (
    <div className="page-stack">
      {snapshot.warnings.length > 0 ? (
        <section className="panel growth-warning-panel">
          <div className="panel-header growth-warning-head">
            <h3 className="panel-title">Alertas</h3>
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
          <span className="stat-note">{formatPct(productViewStep?.conversion_from_sessions_pct)} a PDP</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Búsquedas</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.searches)}</strong>
          <span className="stat-note">{topSearch ? topSearch.query : formatDuration(snapshot.totals.avg_session_duration_seconds)}</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">WhatsApp</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.contacts)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.contact_rate_pct)} sesiones</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Checkout</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.checkout_starts)}</strong>
          <span className="stat-note">{formatPct(snapshot.totals.checkout_rate_pct)} sesiones</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Compras</span>
          <strong className="stat-value">{formatNumber(snapshot.totals.purchases)}</strong>
          <span className="stat-note">{formatMoney(snapshot.totals.revenue_ars)}</span>
        </article>
      </section>

      <GrowthSection
        title="Adquisición y demanda"
        copy="Fuentes, dispositivos y búsquedas."
        badges={[
          { label: `${snapshot.sources.length} fuentes` },
          { label: `${snapshot.devices.length} dispositivos` },
          deviceCoveragePct != null ? { label: `${formatPct(deviceCoveragePct)} detección útil`, tone: deviceCoveragePct >= 70 ? "good" : "warn" } : null,
        ].filter((badge): badge is GrowthSummaryBadge => badge != null)}
      >
        <div className="growth-table-grid">
          <GrowthTableCard title="Fuentes">
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

          <GrowthTableCard title="Dispositivos">
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
          <GrowthTableCard title="Lo que buscan">
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

          <GrowthTableCard title="URLs de entrada">
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
        title="Productos"
        badges={[
          { label: `${snapshot.products.length} productos` },
          { label: `${productUrls.length} URLs`, tone: "accent" },
        ]}
      >
        <div className="growth-table-grid">
          <GrowthTableCard title="URLs de producto (por vistas)">
            <table className="table is-compact growth-table-dense">
              <thead>
                <tr>
                  <th>Ruta</th>
                  <th>Vistas</th>
                  <th>WA</th>
                  <th>CO</th>
                  <th>Compra</th>
                  <th>Última</th>
                </tr>
              </thead>
              <tbody>
                {productUrls.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">Sin URLs con actividad.</td>
                  </tr>
                ) : null}
                {productUrls.map((product) => (
                  <tr key={product.sku ?? product.url_path ?? product.title}>
                    <td className="growth-cell-product">
                      <code className="growth-path-clip" title={product.url_path ?? ""}>
                        {truncateText(String(product.url_path ?? ""), 44)}
                      </code>
                      {product.title ? (
                        <details className="growth-row-details">
                          <summary>Ver título</summary>
                          <span className="muted growth-row-details-body">{product.title}</span>
                        </details>
                      ) : null}
                    </td>
                    <td>{formatNumber(product.view_contents)}</td>
                    <td>{formatNumber(product.contacts)}</td>
                    <td>{formatNumber(product.checkout_starts)}</td>
                    <td>{formatNumber(product.purchases)}</td>
                    <td className="growth-cell-nowrap">{formatDateTime(product.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GrowthTableCard>

          <GrowthTableCard title="Top productos">
            <table className="table is-compact growth-table-dense">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Vistas</th>
                  <th>WA</th>
                  <th>CO</th>
                  <th>Compra</th>
                  <th>$</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.products.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">Sin eventos por producto.</td>
                  </tr>
                ) : null}
                {snapshot.products.map((product) => {
                  const metaBits = [product.sku, product.brand, product.url_path].filter(Boolean);
                  const metaLine = metaBits.join(" · ");
                  return (
                    <tr key={product.product_id ?? product.sku ?? product.title}>
                      <td className="growth-cell-product">
                        <strong className="growth-product-name">{truncateText(product.title, 56)}</strong>
                        {metaLine ? (
                          <details className="growth-row-details">
                            <summary>SKU / marca / ruta</summary>
                            <span className="muted growth-row-details-body mono">{metaLine}</span>
                          </details>
                        ) : null}
                      </td>
                      <td>{formatNumber(product.view_contents)}</td>
                      <td>{formatNumber(product.contacts)}</td>
                      <td>{formatNumber(product.checkout_starts)}</td>
                      <td>{formatNumber(product.purchases)}</td>
                      <td className="growth-cell-nowrap">{formatMoney(product.revenue_ars)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </GrowthTableCard>
        </div>
      </GrowthSection>

      <GrowthSection
        title="Personas y recorridos"
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
        title="Feed de eventos"
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
