import { getAudit } from "../../lib/api";
import { AuditExplorer } from "../components/audit-explorer";

export default async function AuditPage() {
  let items = [] as Awaited<ReturnType<typeof getAudit>>["items"];
  let error: string | null = null;

  try {
    const response = await getAudit(120);
    items = response.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load audit logs";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Audit</span>
        <h2 className="hero-title">Audit</h2>
        <div className="chip-row">
          <span className="chip accent">{items.length} entries</span>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <AuditExplorer items={items} />
    </div>
  );
}
