import Link from "next/link";
import { getConversations, getCustomers, getDashboard } from "../lib/api";
import { getSiteMode } from "../lib/site-mode";

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
    return (
      <div className="page-stack">
        <section className="panel">
          <h2 className="hero-title">TechnoStore</h2>
          <p className="empty">
            Storefront is disabled in this deployment. Contact the store on WhatsApp for catalog and prices.
          </p>
        </section>
      </div>
    );
  }

  let dashboard = null as Awaited<ReturnType<typeof getDashboard>> | null;
  let customers = [] as Awaited<ReturnType<typeof getCustomers>>["items"];
  let conversations = [] as Awaited<ReturnType<typeof getConversations>>["items"];
  let error: string | null = null;

  try {
    const [dashboardResponse, customerResponse, conversationResponse] = await Promise.all([
      getDashboard(),
      getCustomers(40),
      getConversations(20),
    ]);
    dashboard = dashboardResponse;
    customers = customerResponse.items;
    conversations = conversationResponse.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load dashboard";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">TechnoStore Ops</span>
        <h2 className="hero-title">Dashboard</h2>
        <p className="masthead-meta">Customers, conversations, and WhatsApp thread history.</p>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {dashboard ? (
        <section className="panel">
          <div className="chip-row">
            <span className="chip accent">{dashboard.customers} customers</span>
            <span className="chip good">{dashboard.openConversations} open threads</span>
            <span className="chip">{dashboard.messages} messages</span>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h3>Recent customers</h3>
          <Link className="link" href="/customers">
            View all
          </Link>
        </div>
        <ul className="list-plain">
          {customers.slice(0, 6).map((customer) => (
            <li key={customer.id} className="list-row">
              <div>
                <strong>
                  {customer.first_name || customer.last_name
                    ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim()
                    : "Unnamed"}
                </strong>
                <div className="muted small">{customer.phone || customer.email || "No contact"}</div>
              </div>
              <span className="muted small">{formatDate(customer.updated_at)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Recent conversations</h3>
          <Link className="link" href="/conversations">
            View all
          </Link>
        </div>
        <ul className="list-plain">
          {conversations.slice(0, 6).map((conversation) => (
            <li key={conversation.id} className="list-row">
              <div>
                <Link className="link" href={`/conversations/${conversation.id}`}>
                  {conversation.channel_thread_key}
                </Link>
                <div className="muted small">
                  {conversation.first_name || conversation.phone || "Unknown customer"}
                </div>
              </div>
              <span className="muted small">{formatDate(conversation.last_message_at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
