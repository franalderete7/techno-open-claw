import { getStock } from "../../lib/api";

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" });
}

export default async function StockPage() {
  let items = [] as Awaited<ReturnType<typeof getStock>>["items"];
  let error: string | null = null;

  try {
    const response = await getStock(150);
    items = response.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load stock";
  }

  const inStockCount = items.filter((item) => item.status === "in_stock").length;
  const reservedCount = items.filter((item) => item.status === "reserved").length;
  const soldCount = items.filter((item) => item.status === "sold").length;

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Stock</span>
        <h2 className="hero-title">Units</h2>
        <div className="chip-row">
          <span className="chip accent">{items.length} units</span>
          <span className="chip good">{inStockCount} in stock</span>
          <span className="chip warn">{reservedCount} reserved</span>
          <span className="chip">{soldCount} sold</span>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <section className="table-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Inventory</h3>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="empty">No stock units available.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Product</th>
                  <th>Serial</th>
                  <th>Condition Notes</th>
                  <th>Status</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {items.map((unit) => (
                  <tr key={unit.id}>
                    <td>
                      <div className="value-stack">
                        <strong>#{unit.id}</strong>
                        <span className="muted">Acquired {formatDate(unit.acquired_at)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="value-stack">
                        <strong>
                          {unit.brand} {unit.model}
                        </strong>
                        <span className="muted mono">{unit.sku}</span>
                        <span className="muted">{unit.title}</span>
                      </div>
                    </td>
                    <td className="mono">{unit.serial_number || "-"}</td>
                    <td>
                      <div className="chip-row">
                        <span className="chip">{unit.color || "No color"}</span>
                        <span className={`chip ${unit.battery_health && unit.battery_health >= 85 ? "good" : ""}`}>
                          {unit.battery_health == null ? "Battery -" : `${unit.battery_health}% battery`}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`pill ${
                          unit.status === "in_stock"
                            ? "good"
                            : unit.status === "reserved"
                              ? "warn"
                              : unit.status === "damaged"
                                ? "danger"
                                : ""
                        }`}
                      >
                        {unit.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>
                      <div className="value-stack">
                        <strong>{unit.location_code || "-"}</strong>
                        <span className="muted">Sold {formatDate(unit.sold_at)}</span>
                      </div>
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
