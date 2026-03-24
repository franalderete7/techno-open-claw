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

const groupedKeys = {
  storeInfo: new Set([
    "store_address",
    "store_hours",
    "store_location_name",
    "store_latitude",
    "store_longitude",
    "store_social_instagram",
    "store_social_facebook",
  ]),
  storePolicies: new Set([
    "store_credit_policy",
    "store_shipping_policy",
    "store_warranty_new",
    "store_warranty_used",
    "store_payment_methods",
    "store_financing_scope",
  ]),
  pricing: new Set([
    "usd_to_ars",
    "logistics_usd",
    "bancarizada_interest",
    "macro_interest",
    "cuotas_qty",
    "iphone_delivery_days",
    "pricing_default_logistics_usd",
    "pricing_default_usd_rate",
    "pricing_default_cuotas_qty",
    "pricing_bancarizada_interest",
    "pricing_macro_interest",
    "pricing_margin_band_1_max_cost_usd",
    "pricing_margin_band_1_margin_pct",
    "pricing_margin_band_2_max_cost_usd",
    "pricing_margin_band_2_margin_pct",
    "pricing_margin_band_3_max_cost_usd",
    "pricing_margin_band_3_margin_pct",
    "pricing_margin_band_4_max_cost_usd",
    "pricing_margin_band_4_margin_pct",
  ]),
  payments: new Set([
    "customer_cards_supported",
    "customer_cards_blocked",
    "customer_payment_mentions_supported",
  ]),
  automation: new Set(["bot_version"]),
} as const;

function groupTitle(group: keyof typeof groupedKeys) {
  switch (group) {
    case "storeInfo":
      return "Store Info";
    case "storePolicies":
      return "Store Policies";
    case "pricing":
      return "Pricing";
    case "payments":
      return "Payments";
    case "automation":
      return "Automation";
  }
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

  const storeSetting = items.find((item) => item.key === "store") ?? null;
  const remainingSettings = items.filter((item) => item.key !== "store");
  const groupedSettings = Object.entries(groupedKeys)
    .map(([groupKey, keys]) => ({
      key: groupKey as keyof typeof groupedKeys,
      items: remainingSettings.filter((item) => keys.has(item.key)),
    }))
    .filter((group) => group.items.length > 0);

  const usedKeys = new Set(groupedSettings.flatMap((group) => group.items.map((item) => item.key)));
  const miscSettings = remainingSettings.filter((item) => !usedKeys.has(item.key));

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
        <>
          {storeSetting ? (
            <section className="setting-feature setting-card">
              <div className="panel-header">
                <div>
                  <h3>Store</h3>
                  <p className="setting-key mono">store</p>
                  {storeSetting.description ? <p className="panel-copy">{storeSetting.description}</p> : null}
                </div>
                <p className="panel-copy">Updated {formatDate(storeSetting.updated_at)}</p>
              </div>
              <SettingView value={storeSetting.value} />
            </section>
          ) : null}

          <section className="settings-layout">
            {groupedSettings.map((group) => (
              <article key={group.key} className="setting-card setting-group">
                <div className="panel-header">
                  <div>
                    <h3>{groupTitle(group.key)}</h3>
                    <p className="panel-copy">{group.items.length} keys</p>
                  </div>
                </div>

                <div className="setting-group-list">
                  {group.items.map((setting) => (
                    <section key={setting.key} className="setting-entry">
                      <div className="setting-entry-head">
                        <div>
                          <h4>{labelize(setting.key)}</h4>
                          <p className="setting-key mono">{setting.key}</p>
                        </div>
                        <span className="setting-updated">{formatDate(setting.updated_at)}</span>
                      </div>

                      <div className="setting-entry-body">
                        <SettingView value={setting.value} />
                      </div>

                      {setting.description ? <p className="setting-caption">{setting.description}</p> : null}
                    </section>
                  ))}
                </div>
              </article>
            ))}

            {miscSettings.length > 0 ? (
              <article className="setting-card setting-group">
                <div className="panel-header">
                  <div>
                    <h3>Other</h3>
                    <p className="panel-copy">{miscSettings.length} keys</p>
                  </div>
                </div>

                <div className="setting-group-list">
                  {miscSettings.map((setting) => (
                    <section key={setting.key} className="setting-entry">
                      <div className="setting-entry-head">
                        <div>
                          <h4>{labelize(setting.key)}</h4>
                          <p className="setting-key mono">{setting.key}</p>
                        </div>
                        <span className="setting-updated">{formatDate(setting.updated_at)}</span>
                      </div>

                      <div className="setting-entry-body">
                        <SettingView value={setting.value} />
                      </div>

                      {setting.description ? <p className="setting-caption">{setting.description}</p> : null}
                    </section>
                  ))}
                </div>
              </article>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
