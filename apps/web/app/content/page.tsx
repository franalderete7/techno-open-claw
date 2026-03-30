import { getContentOverview } from "../../lib/api";
import { ContentExplorer } from "../components/content-explorer";

export default async function ContentPage() {
  let snapshot = null as Awaited<ReturnType<typeof getContentOverview>> | null;
  let error: string | null = null;

  try {
    snapshot = await getContentOverview();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load content system";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Content</span>
        <h2 className="hero-title">Content system</h2>
        <p className="hero-copy">
          Source of truth for brand rules, assets, templates, planner gaps, generation jobs, approvals and publication tracking.
        </p>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {snapshot ? (
        <ContentExplorer snapshot={snapshot} />
      ) : (
        <section className="panel">
          <p className="empty">{error ?? "No content data available."}</p>
        </section>
      )}
    </div>
  );
}
