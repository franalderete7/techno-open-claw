import { getStock } from "../../lib/api";
import { StockExplorer } from "../components/stock-explorer";

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

      <StockExplorer items={items} />
    </div>
  );
}
