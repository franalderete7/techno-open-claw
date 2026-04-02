import Link from "next/link";
import { getStorefrontAnalyticsOverview } from "../../lib/api";
import { GrowthExplorer } from "../components/growth-explorer";

type GrowthPageProps = {
  searchParams?: Promise<{
    days?: string;
  }>;
};

const DAY_OPTIONS = [7, 30, 90] as const;

function normalizeDays(rawValue: string | undefined) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.max(1, Math.min(180, Math.trunc(parsed)));
}

export default async function GrowthPage({ searchParams }: GrowthPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const days = normalizeDays(resolvedSearchParams.days);
  let snapshot = null as Awaited<ReturnType<typeof getStorefrontAnalyticsOverview>> | null;
  let error: string | null = null;

  try {
    snapshot = await getStorefrontAnalyticsOverview({ days });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load storefront analytics";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Growth</span>
        <h2 className="hero-title">Storefront intelligence</h2>
        <p className="hero-copy">
          First-party traffic, funnel, source and visitor analytics built from the storefront itself, not only Meta’s processed reporting.
        </p>
        <div className="chip-row growth-range-row">
          {DAY_OPTIONS.map((option) => (
            <Link
              key={option}
              href={`/growth?days=${option}`}
              className={`chip action-link ${option === days ? "accent" : ""}`}
            >
              Last {option}d
            </Link>
          ))}
          <span className="chip mono">Generated {snapshot ? new Date(snapshot.generated_at).toLocaleString("es-AR") : "—"}</span>
        </div>
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
