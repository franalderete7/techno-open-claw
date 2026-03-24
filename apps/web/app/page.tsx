import { getConversations, getDashboard, getProducts, getSettings } from "../lib/api";
import { SettingView } from "../../components/setting-view";

function formatDate(value: string | null) {
  if (!value) return "No activity yet";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function HomePage() {
  let dashboard = null;
  let products = [] as Awaited<ReturnType<typeof getProducts>>["items"];
  let conversations = [] as Awaited<ReturnType<typeof getConversations>>["items"];
  let settings = [] as Awaited<ReturnType<typeof getSettings>>["items"];
  let error: string | null = null;

  try {
    const [dashboardResponse, productResponse, conversationResponse, settingsResponse] = await Promise.all([
      getDashboard(),
      getProducts(6),
      getConversations(5),
      getSettings(),
    ]);

    dashboard = dashboardResponse;
    products = productResponse.items;
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
