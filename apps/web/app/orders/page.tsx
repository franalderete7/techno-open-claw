import { getOrders } from "../../lib/api";

export default async function OrdersPage() {
  const response = await getOrders();

  return (
    <section className="panel table-wrap">
      <h2 className="section-title">Orders</h2>
      {response.items.length === 0 ? (
        <p className="empty">No orders yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Status</th>
              <th>Source</th>
              <th>Total</th>
              <th>Customer</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {response.items.map((item) => (
              <tr key={String(item.id)}>
                <td>{String(item.order_number ?? "")}</td>
                <td>
                  <span className="pill">{String(item.status ?? "")}</span>
                </td>
                <td>{String(item.source ?? "")}</td>
                <td>{String(item.total_amount ?? "")}</td>
                <td>{[item.first_name, item.last_name].filter(Boolean).join(" ") || "-"}</td>
                <td>{String(item.phone ?? "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
