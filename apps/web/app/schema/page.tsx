import { getSchema } from "../../lib/api";
import { SchemaExplorer } from "../components/schema-explorer";

export default async function SchemaPage() {
  let tables = [] as Awaited<ReturnType<typeof getSchema>>["tables"];
  let relationships = [] as Awaited<ReturnType<typeof getSchema>>["relationships"];
  let error: string | null = null;

  try {
    const response = await getSchema();
    tables = response.tables;
    relationships = response.relationships;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load schema";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Schema</span>
        <h2 className="hero-title">Database</h2>
        <p className="hero-copy">Read-only map of tables, columns, and relationships in the public schema.</p>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <SchemaExplorer tables={tables} relationships={relationships} />
    </div>
  );
}
