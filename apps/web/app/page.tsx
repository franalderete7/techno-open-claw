import { getConversations, getCustomers, getDashboard, getProducts, getSettings } from "../lib/api";
import { getSiteMode } from "../lib/site-mode";
import { buildStorefrontProducts, buildStorefrontProfile } from "../lib/storefront";
import { DashboardSearch } from "./components/dashboard-search";
import { SettingView } from "./components/setting-view";
import { StorefrontCatalog } from "./components/storefront-catalog";

function formatDate(value: string | null) {
  if (!value) return "No activity yet";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function HomePage() {
  const siteMode = await getSiteMode();

  if (siteMode === "storefront") {
    let products = [] as Awaited<ReturnType<typeof getProducts>>["items"];
    let settings = [] as Awaited<ReturnType<typeof getSettings>>["items"];
    let error: string | null = null;

    try {
      const [productResponse, settingsResponse] = await Promise.all([getProducts(120, { active: true }), getSettings()]);
      products = productResponse.items;
      settings = settingsResponse.items;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Failed to load storefront";
    }

    const store = buildStorefrontProfile(settings);
    const storefrontProducts = buildStorefrontProducts(products);

    return error ? (
      <div className="page-stack">
        <section className="panel">
          <p className="empty">{error}</p>
        </section>
      </div>
    ) : (
      <StorefrontCatalog
        store={store}
        products={storefrontProducts}
        eyebrow="TechnoStore Salta"
        title="Celulares en Salta."
        lead="Precio final en pesos, memoria, color y entrega clara. Elegís el modelo y seguís por WhatsApp con atención humana."
      />
    );
  }

  let dashboard = null;
  let products = [] as Awaited<ReturnType<typeof getProducts>>["items"];
  let customers = [] as Awaited<ReturnType<typeof getCustomers>>["items"];
  let conversations = [] as Awaited<ReturnType<typeof getConversations>>["items"];
  let settings = [] as Awaited<ReturnType<typeof getSettings>>["items"];
  let error: string | null = null;

  try {
      const [dashboardResponse, productResponse, customerResponse, conversationResponse, settingsResponse] = await Promise.all([
      getDashboard(),
      getProducts(18),
      getCustomers(40),
      getConversations(20),
      getSettings(),
    ]);

    dashboard = dashboardResponse;
    products = productResponse.items;
    customers = customerResponse.items;
    conversations = conversationResponse.items;
    settings = settingsResponse.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load dashboard";
  }

  const storeSetting = settings.find((item) => item.key === "store");

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Overview</span>
        <h2 className="hero-title">Control room</h2>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {dashboard ? (
        <section className="stats-grid">
          <article className="stat-card">
            <span className="stat-label">Products</span>
            <strong className="stat-value">{dashboard.products}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">In Stock Units</span>
            <strong className="stat-value">{dashboard.inStockUnits}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Customers</span>
            <strong className="stat-value">{dashboard.customers}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Open Conversations</span>
            <strong className="stat-value">{dashboard.openConversations}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Orders</span>
            <strong className="stat-value">{dashboard.orders}</strong>
          </article>
        </section>
      ) : null}

      <DashboardSearch products={products} customers={customers} conversations={conversations} settings={settings} />

      <section className="split-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Recent Products</h3>
            </div>
          </div>

          {products.length === 0 ? (
            <p className="empty">No products available.</p>
          ) : (
            <div className="activity-list">
              {products.map((product) => (
                <div key={product.id} className="activity-item">
                  <strong>
                    {product.brand} {product.model}
                  </strong>
                  <div className="chip-row">
                    <span className="chip accent mono">{product.sku}</span>
                    <span className={`chip ${product.active ? "good" : ""}`}>
                      {product.active ? "Active" : "Inactive"}
                    </span>
                    <span className={`chip ${product.stock_units_available > 0 ? "good" : "warn"}`}>
                      {product.stock_units_available} available
                    </span>
                  </div>
                  <span className="muted">{product.title}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">Recent Conversations</h3>
            </div>
          </div>

          {conversations.length === 0 ? (
            <p className="empty">No conversations available.</p>
          ) : (
            <div className="activity-list">
              {conversations.map((conversation) => (
                <div key={conversation.id} className="activity-item">
                  <strong>
                    {[conversation.first_name, conversation.last_name].filter(Boolean).join(" ") || "Unknown contact"}
                  </strong>
                  <div className="chip-row">
                    <span className="chip accent">{conversation.channel}</span>
                    <span className={`chip ${conversation.status === "open" ? "good" : "warn"}`}>
                      {conversation.status}
                    </span>
                    <span className="chip mono">{conversation.channel_thread_key}</span>
                  </div>
                  <span className="muted">{formatDate(conversation.last_message_at)}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <article className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Store</h3>
          </div>
        </div>

        {storeSetting ? <SettingView value={storeSetting.value} /> : <p className="empty">No `store` setting found.</p>}
      </article>
    </div>
  );
}
