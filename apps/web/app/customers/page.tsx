import { getCustomers } from "../../lib/api";
import { CustomersExplorer } from "../components/customers-explorer";

export default async function CustomersPage() {
  let items = [] as Awaited<ReturnType<typeof getCustomers>>["items"];
  let error: string | null = null;

  try {
    const response = await getCustomers(120);
    items = response.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load customers";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Customers</span>
        <h2 className="hero-title">Customers</h2>
        <div className="chip-row">
          <span className="chip accent">{items.length} records</span>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <CustomersExplorer items={items} />
    </div>
  );
}
