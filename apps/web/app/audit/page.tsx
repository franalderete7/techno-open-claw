import { getAudit } from "../../lib/api";

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

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

      <section className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Latest</h3>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="empty">No audit entries available.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDate(item.created_at)}</td>
                    <td>
                      <div className="value-stack">
                        <strong>{item.actor_type}</strong>
                        <span className="muted mono">{item.actor_id || "-"}</span>
                      </div>
                    </td>
                    <td className="mono">{item.action}</td>
                    <td>
                      <div className="value-stack">
                        <strong>{item.entity_type}</strong>
                        <span className="muted mono">{item.entity_id}</span>
                      </div>
                    </td>
                    <td className="mono muted">
                      {item.metadata == null ? "-" : JSON.stringify(item.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
