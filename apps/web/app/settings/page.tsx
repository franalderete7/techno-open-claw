import { getSettings } from "../../lib/api";
import { SettingsExplorer } from "../components/settings-explorer";

export default async function SettingsPage() {
  let items = [] as Awaited<ReturnType<typeof getSettings>>["items"];
  let error: string | null = null;

  try {
    const response = await getSettings();
    items = response.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load settings";
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <span className="eyebrow">Settings</span>
        <h2 className="hero-title">Settings</h2>
        <div className="chip-row">
          <span className="chip accent">{items.length} keys</span>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <SettingsExplorer items={items} />
    </div>
  );
}
