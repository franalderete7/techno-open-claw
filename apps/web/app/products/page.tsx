import { getProducts } from "../../lib/api";

export default async function ProductsPage() {
  const response = await getProducts();

  return (
    <section className="panel table-wrap">
      <h2 className="section-title">Products</h2>
      {response.items.length === 0 ? (
        <p className="empty">No products yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Title</th>
              <th>Brand</th>
              <th>Model</th>
              <th>Condition</th>
              <th>Price</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {response.items.map((item) => (
              <tr key={String(item.id)}>
                <td>{String(item.sku ?? "")}</td>
                <td>{String(item.title ?? "")}</td>
                <td>{String(item.brand ?? "")}</td>
                <td>{String(item.model ?? "")}</td>
                <td>{String(item.condition ?? "")}</td>
                <td>{item.price_amount == null ? "-" : String(item.price_amount)}</td>
                <td>{item.active ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
