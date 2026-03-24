import Image from "next/image";
import { getSettings } from "../../lib/api";
import { SettingView } from "../../components/setting-view";

function labelize(value: string) {
  return value.replace(/[_-]+/g, " ");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function getSettingCardClass(setting: { key: string; value: unknown }) {
  const classes = ["setting-card"];

  if (setting.key === "store") {
    classes.push("setting-card-featured");
  } else if (
    isPlainRecord(setting.value) ||
    (typeof setting.value === "string" && setting.value.length > 110) ||
    setting.key.includes("policy") ||
    setting.key.includes("payment_methods")
  ) {
    classes.push("setting-card-wide");
  }

  return classes.join(" ");
}

export default async function SettingsPage() {
  let items = [] as Awaited<ReturnType<typeof getSettings>>["items"];
  let error: string | null = null;

  try {
    const response = await getSettings();
    items = response.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load settings";
  }

  const orderedItems = [...items].sort((left, right) => {
    if (left.key === "store") return -1;
    if (right.key === "store") return 1;
    return left.key.localeCompare(right.key);
  });

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

      {items.length === 0 ? (
        <section className="panel">
          <p className="empty">No settings available.</p>
        </section>
      ) : (
        <section className="settings-layout">
          {orderedItems.map((setting) => (
            <article key={setting.key} className={getSettingCardClass(setting)}>
              <div className="panel-header setting-card-header">
                <div>
                  {setting.key === "store" ? (
                    <div className="setting-brand-chip" aria-hidden="true">
                      <Image src="/brand/logo-negro-salta.png" alt="" width={716} height={190} className="setting-brand-image" />
                    </div>
                  ) : null}
                  <h3>{labelize(setting.key)}</h3>
                  <p className="setting-key mono">{setting.key}</p>
                </div>
                <p className="panel-copy">Updated {formatDate(setting.updated_at)}</p>
              </div>

              <div className="setting-entry-body setting-card-body">
                <SettingView value={setting.value} />
              </div>

              {setting.description ? <p className="setting-caption">{setting.description}</p> : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
