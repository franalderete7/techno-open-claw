import { getConversations } from "../../lib/api";

export default async function ConversationsPage() {
  const response = await getConversations();

  return (
    <section className="panel table-wrap">
      <h2 className="section-title">Conversations</h2>
      {response.items.length === 0 ? (
        <p className="empty">No conversations yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Channel</th>
              <th>Thread Key</th>
              <th>Status</th>
              <th>Customer</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {response.items.map((item) => (
              <tr key={String(item.id)}>
                <td>{String(item.id)}</td>
                <td>{String(item.channel ?? "")}</td>
                <td>{String(item.channel_thread_key ?? "")}</td>
                <td>
                  <span className="pill">{String(item.status ?? "")}</span>
                </td>
                <td>{[item.first_name, item.last_name].filter(Boolean).join(" ") || "-"}</td>
                <td>{String(item.phone ?? "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
