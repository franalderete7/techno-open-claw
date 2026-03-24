import { getOrders } from "../../lib/api";

function formatMoney(amount: number | null, currency: string) {
  if (amount == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function OrdersPage() {
  let items = [] as Awaited<ReturnType<typeof getOrders>>["items"];
  let error: string | null = null;

  try {
    const response = await getOrders(80);
    items = response.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load orders";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Orders</span>
        <h2 className="hero-title">Orders</h2>
        <div className="chip-row">
          <span className="chip accent">{items.length} records</span>
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
          <p className="empty">No orders available.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="value-stack">
                        <strong>{item.order_number}</strong>
                        <span className="muted mono">#{item.id}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`pill ${item.status === "paid" || item.status === "fulfilled" ? "good" : ""}`}>
                        {item.status}
                      </span>
                    </td>
                    <td>{item.source}</td>
                    <td>
                      <div className="value-stack">
                        <strong>{[item.first_name, item.last_name].filter(Boolean).join(" ") || "No customer"}</strong>
                        <span className="muted">{item.phone || "-"}</span>
                      </div>
                    </td>
                    <td>{formatMoney(item.total_amount, item.currency_code)}</td>
                    <td>{formatDate(item.created_at)}</td>
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
