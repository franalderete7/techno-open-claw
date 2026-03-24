import { getCustomers } from "../../lib/api";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    dateStyle: "medium",
  });
}

export default async function CustomersPage() {
  let items = [] as Awaited<ReturnType<typeof getCustomers>>["items"];
  let error: string | null = null;

  try {
    const response = await getCustomers(120);
    items = response.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load customers";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Customers</span>
        <h2 className="hero-title">Customers</h2>
        <div className="chip-row">
          <span className="chip accent">{items.length} records</span>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <section className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Directory</h3>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="empty">No customers available.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Source</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>State Notes</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <div className="value-stack">
                        <strong>
                          {[customer.first_name, customer.last_name].filter(Boolean).join(" ") || "Unnamed contact"}
                        </strong>
                        <span className="muted mono">#{customer.id}</span>
                      </div>
                    </td>
                    <td className="mono">{customer.external_ref || "-"}</td>
                    <td>{customer.phone || "-"}</td>
                    <td>{customer.email || "-"}</td>
                    <td className="mono muted">{customer.notes || "-"}</td>
                    <td>{formatDate(customer.created_at)}</td>
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
