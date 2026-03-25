import { getProducts } from "../../lib/api";
import { getSettings } from "../../lib/api";
import { getSiteMode } from "../../lib/site-mode";
import { buildStorefrontProducts, buildStorefrontProfile } from "../../lib/storefront";
import { ProductsExplorer } from "../components/products-explorer";
import { StorefrontCatalog } from "../components/storefront-catalog";

export default async function ProductsPage() {
  const siteMode = await getSiteMode();

  if (siteMode === "storefront") {
    let items = [] as Awaited<ReturnType<typeof getProducts>>["items"];
    let settings = [] as Awaited<ReturnType<typeof getSettings>>["items"];
    let error: string | null = null;

    try {
      const [productResponse, settingsResponse] = await Promise.all([getProducts(120, { active: true }), getSettings()]);
      items = productResponse.items;
      settings = settingsResponse.items;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Failed to load storefront catalog";
    }

    const store = buildStorefrontProfile(settings);

    return error ? (
      <div className="page-stack">
        <section className="panel">
          <p className="empty">{error}</p>
        </section>
      </div>
    ) : (
      <StorefrontCatalog
        store={store}
        products={buildStorefrontProducts(items)}
        eyebrow="Catálogo"
        title="Modelos disponibles para compra asistida."
        lead="Elegí memoria, color y red. Después cerrás todo por WhatsApp con atención humana."
      />
    );
  }

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
