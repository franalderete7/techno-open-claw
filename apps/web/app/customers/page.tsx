import { getCustomers } from "../../lib/api";

export default async function CustomersPage() {
  const response = await getCustomers();

  return (
    <section className="panel table-wrap">
      <h2 className="section-title">Customers</h2>
      {response.items.length === 0 ? (
        <p className="empty">No customers yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>External Ref</th>
            </tr>
          </thead>
          <tbody>
            {response.items.map((item) => (
              <tr key={String(item.id)}>
                <td>{[item.first_name, item.last_name].filter(Boolean).join(" ") || "-"}</td>
                <td>{String(item.phone ?? "-")}</td>
                <td>{String(item.email ?? "-")}</td>
                <td>{String(item.external_ref ?? "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
