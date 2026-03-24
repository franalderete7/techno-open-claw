import { getProducts } from "../../lib/api";

function formatMoney(amount: number | null, currency: string) {
  if (amount == null) return "Price not loaded";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    dateStyle: "medium",
  });
}

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
        <section className="product-list">
          {items.map((product) => (
            <article key={product.id} className="product-card">
              <div className="product-thumb">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.title} />
                ) : (
                  <div className="product-placeholder">{product.brand.slice(0, 2).toUpperCase()}</div>
                )}
              </div>

              <div className="product-main">
                <div>
                  <p className="catalog-kicker">{product.brand}</p>
                  <h3 className="product-heading">{product.title}</h3>
                  <p className="product-subline">{product.model}</p>
                </div>

                <div className="chip-row">
                  <span className="chip accent mono">{product.sku}</span>
                  <span className={`chip ${product.active ? "good" : "warn"}`}>
                    {product.active ? "Active" : "Inactive"}
                  </span>
                  <span className={`chip ${product.in_stock ? "good" : "danger"}`}>
                    {product.in_stock ? "In stock" : "Out"}
                  </span>
                  {product.ram_gb ? <span className="chip">{product.ram_gb}GB RAM</span> : null}
                  {product.storage_gb ? <span className="chip">{product.storage_gb}GB</span> : null}
                  {product.network ? <span className="chip">{product.network.toUpperCase()}</span> : null}
                  {product.color ? <span className="chip">{product.color}</span> : null}
                  {product.delivery_days != null ? (
                    <span className="chip">{product.delivery_days === 0 ? "Immediate" : `${product.delivery_days} days`}</span>
                  ) : null}
                </div>

                {product.description ? <p className="product-copy">{product.description}</p> : null}
              </div>

              <div className="product-side">
                <div className="price-stack">
                  <span>Promo</span>
                  <strong>{formatMoney(product.promo_price_ars ?? product.price_amount, product.currency_code)}</strong>
                  {product.promo_price_ars && product.price_amount && product.promo_price_ars !== product.price_amount ? (
                    <span className="price-note">List {formatMoney(product.price_amount, product.currency_code)}</span>
                  ) : (
                    <span className="price-note">Updated {formatDate(product.updated_at)}</span>
                  )}
                </div>

                <div className="metric-grid">
                  <div className="metric">
                    <span className="metric-label">Available</span>
                    <strong className="metric-value">{product.stock_units_available}</strong>
                  </div>
                  <div className="metric">
                    <span className="metric-label">Total</span>
                    <strong className="metric-value">{product.stock_units_total}</strong>
                  </div>
                  <div className="metric">
                    <span className="metric-label">Sold</span>
                    <strong className="metric-value">{product.stock_units_sold}</strong>
                  </div>
                  <div className="metric">
                    <span className="metric-label">USD</span>
                    <strong className="metric-value">{product.price_usd == null ? "-" : `$${product.price_usd}`}</strong>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
