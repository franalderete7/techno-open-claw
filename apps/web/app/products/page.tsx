import { getProducts } from "../../lib/api";
import { ProductsExplorer } from "../components/products-explorer";

export default async function ProductsPage() {
  let items = [] as Awaited<ReturnType<typeof getProducts>>["items"];
  let error: string | null = null;

  try {
    const response = await getProducts(120);
    items = response.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load products";
  }

  const activeCount = items.filter((item) => item.active).length;
  const totalAvailable = items.filter((item) => item.in_stock).length;

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Products</span>
        <h2 className="hero-title">Catalog</h2>
        <div className="chip-row">
          <span className="chip accent">{items.length} products</span>
          <span className="chip good">{activeCount} active</span>
          <span className="chip warn">{totalAvailable} in stock</span>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {items.length === 0 ? (
        <section className="panel">
          <p className="empty">No products available.</p>
        </section>
      ) : (
        <ProductsExplorer items={items} />
      )}
    </div>
  );
}
