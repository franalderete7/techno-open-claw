import { getOrders } from "../../lib/api";
import { OrdersExplorer } from "../components/orders-explorer";

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

      <OrdersExplorer items={items} />
    </div>
  );
}
