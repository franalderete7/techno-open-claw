import Link from "next/link";
import { getStorefrontAnalyticsOverview } from "../../lib/api";
import { GrowthExplorer } from "../components/growth-explorer";

type GrowthPageProps = {
  searchParams?: Promise<{
    days?: string;
    source?: string;
    device?: string;
    interval?: string;
  }>;
};

const DAY_OPTIONS = [7, 30, 90] as const;
const INTERVAL_OPTIONS = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
] as const;

function sourceOptionLabel(value: string) {
  switch (value) {
    case "direct":
      return "Directo";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "google":
      return "Google";
    case "whatsapp":
      return "WhatsApp";
    case "telegram":
      return "Telegram";
    case "youtube":
      return "YouTube";
    case "x":
      return "X";
    default:
      return value;
  }
}

function deviceOptionLabel(value: string) {
  if (value.toLowerCase() === "unknown") return "Sin identificar";
  if (value.toLowerCase() === "desktop web") return "Desktop";
  if (value.toLowerCase() === "mobile web") return "Mobile web";
  if (value.toLowerCase() === "tablet web") return "Tablet web";
  return value;
}

function normalizeDays(rawValue: string | undefined) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.max(1, Math.min(180, Math.trunc(parsed)));
}

function normalizeInterval(rawValue: string | undefined) {
  if (rawValue === "week" || rawValue === "month") {
    return rawValue;
  }

  return "day";
}

export default async function GrowthPage({ searchParams }: GrowthPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const days = normalizeDays(resolvedSearchParams.days);
  const source = resolvedSearchParams.source?.trim() || null;
  const device = resolvedSearchParams.device?.trim() || null;
  const interval = normalizeInterval(resolvedSearchParams.interval);
  let snapshot = null as Awaited<ReturnType<typeof getStorefrontAnalyticsOverview>> | null;
  let error: string | null = null;

  try {
    snapshot = await getStorefrontAnalyticsOverview({ days, source, device, interval });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load storefront analytics";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Growth</span>
        <h2 className="hero-title">Storefront intelligence</h2>
        <p className="hero-copy">
          First-party storefront analytics reorganized for decision-making: what traffic is useful, where intent appears, and where the funnel is leaking.
        </p>
        <section className="search-toolbar growth-filter-shell">
          <div className="growth-filter-top">
            <div className="chip-row growth-range-row">
              {DAY_OPTIONS.map((option) => (
                <Link
                  key={option}
                  href={`/growth?days=${option}&interval=${interval}${source ? `&source=${encodeURIComponent(source)}` : ""}${device ? `&device=${encodeURIComponent(device)}` : ""}`}
                  className={`chip action-link ${option === days ? "accent" : ""}`}
                >
                  Últimos {option}d
                </Link>
              ))}
            </div>
            <span className="chip mono">Generado {snapshot ? new Date(snapshot.generated_at).toLocaleString("es-AR") : "—"}</span>
          </div>

          {snapshot ? (
            <form className="purchase-toolbar-row growth-toolbar-row" method="get">
              <input type="hidden" name="days" value={String(days)} />
              <div className="purchase-toolbar-inputs growth-filter-grid">
                <label className="toolbar-control">
                  <span>Intervalo</span>
                  <select name="interval" defaultValue={snapshot.filters.applied.interval}>
                    {INTERVAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="toolbar-control">
                  <span>Fuente</span>
                  <select name="source" defaultValue={snapshot.filters.applied.source ?? ""}>
                    <option value="">Todas</option>
                    {snapshot.filters.available.sources.map((option) => (
                      <option key={option} value={option}>
                        {sourceOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="toolbar-control">
                  <span>Dispositivo</span>
                  <select name="device" defaultValue={snapshot.filters.applied.device ?? ""}>
                    <option value="">Todos</option>
                    {snapshot.filters.available.devices.map((option) => (
                      <option key={option} value={option}>
                        {deviceOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="chip-row growth-filter-actions">
                <button type="submit" className="chip action-link accent growth-filter-submit">
                  Aplicar filtros
                </button>
                <Link href={`/growth?days=${days}&interval=${interval}`} className="chip action-link">
                  Limpiar
                </Link>
              </div>
            </form>
          ) : null}
        </section>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {snapshot ? (
        <GrowthExplorer snapshot={snapshot} days={days} />
      ) : (
        <section className="panel">
          <p className="empty">{error ?? "No analytics available yet."}</p>
        </section>
      )}
    </div>
  );
}
