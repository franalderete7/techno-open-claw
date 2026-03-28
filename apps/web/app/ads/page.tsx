import { getMetaAdsOverview } from "../../lib/api";
import { AdsExplorer } from "../components/ads-explorer";

export default async function AdsPage() {
  let snapshot = null as Awaited<ReturnType<typeof getMetaAdsOverview>> | null;
  let error: string | null = null;

  try {
    snapshot = await getMetaAdsOverview({ days: 30, limit: 80 });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load Meta ads snapshot";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Ads</span>
        <h2 className="hero-title">Meta snapshot</h2>
        <p className="hero-copy">Read-only view of what exists in Ads Manager and Business Suite for the configured account.</p>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {snapshot ? (
        <AdsExplorer snapshot={snapshot} />
      ) : (
        <section className="panel">
          <p className="empty">{error ?? "No Meta ads data available."}</p>
        </section>
      )}
    </div>
  );
}
