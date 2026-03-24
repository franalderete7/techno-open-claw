import { getStock } from "../../lib/api";

export default async function StockPage() {
  const response = await getStock();

  return (
    <section className="panel table-wrap">
      <h2 className="section-title">Stock</h2>
      {response.items.length === 0 ? (
        <p className="empty">No stock units yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Product</th>
              <th>Serial</th>
              <th>Color</th>
              <th>Battery</th>
              <th>Status</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {response.items.map((item) => (
              <tr key={String(item.id)}>
                <td>{String(item.id)}</td>
                <td>{String(item.title ?? "")}</td>
                <td>{String(item.serial_number ?? "-")}</td>
                <td>{String(item.color ?? "-")}</td>
                <td>{item.battery_health == null ? "-" : `${String(item.battery_health)}%`}</td>
                <td>
                  <span className="pill">{String(item.status ?? "")}</span>
                </td>
                <td>{String(item.location_code ?? "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
