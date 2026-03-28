import { getInventoryPurchaseDetail, getInventoryPurchases } from "../../lib/api";
import { PurchasesExplorer } from "../components/purchases-explorer";

export default async function PurchasesPage() {
  let items = [] as Awaited<ReturnType<typeof getInventoryPurchaseDetail>>[];
  let error: string | null = null;

  try {
    const response = await getInventoryPurchases(80);
    items = await Promise.all(response.items.map((purchase) => getInventoryPurchaseDetail(purchase.id)));
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load inventory purchases";
  }

  const stockUnitsCount = items.reduce((sum, purchase) => sum + purchase.stock_units_total, 0);
  const soldUnitsCount = items.reduce((sum, purchase) => sum + purchase.stock_units_sold, 0);
  const fundedByCount = new Set(items.flatMap((purchase) => purchase.funders.map((funder) => funder.funder_name))).size;

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Inventory</span>
        <h2 className="hero-title">Purchases</h2>
        <div className="chip-row">
          <span className="chip accent">{items.length} purchases</span>
          <span className="chip">{stockUnitsCount} linked units</span>
          <span className="chip good">{soldUnitsCount} sold</span>
          <span className="chip warn">{fundedByCount} funders active</span>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <PurchasesExplorer items={items} />
    </div>
  );
}
