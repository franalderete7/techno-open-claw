import { getDashboard } from "../lib/api";

export default async function HomePage() {
  const dashboard = await getDashboard();

  return (
    <section className="grid cards">
      <article className="card">
        <span>Products</span>
        <strong>{dashboard.products}</strong>
      </article>
      <article className="card">
        <span>In Stock Units</span>
        <strong>{dashboard.inStockUnits}</strong>
      </article>
      <article className="card">
        <span>Customers</span>
        <strong>{dashboard.customers}</strong>
      </article>
      <article className="card">
        <span>Open Conversations</span>
        <strong>{dashboard.openConversations}</strong>
      </article>
      <article className="card">
        <span>Orders</span>
        <strong>{dashboard.orders}</strong>
      </article>
    </section>
  );
}
