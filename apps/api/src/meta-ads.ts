import { config } from "./config.js";

type GraphListResponse<T> = {
  data?: T[];
};

type GraphErrorPayload = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
  };
};

export type MetaAdAccountRecord = {
  id: string;
  account_id?: string | null;
  name?: string | null;
  account_status?: number | null;
  currency?: string | null;
  timezone_name?: string | null;
  timezone_offset_hours_utc?: number | null;
  balance?: string | null;
  amount_spent?: string | null;
  disable_reason?: number | null;
  created_time?: string | null;
};

export type MetaAccountInsightsRecord = {
  account_currency?: string | null;
  spend?: string | null;
  impressions?: string | null;
  reach?: string | null;
  clicks?: string | null;
  ctr?: string | null;
  cpc?: string | null;
  cpm?: string | null;
  date_start?: string | null;
  date_stop?: string | null;
};

export type MetaInstagramAccountRecord = {
  id: string;
  username?: string | null;
  profile_pic?: string | null;
};

export type MetaCampaignRecord = {
  id: string;
  name?: string | null;
  objective?: string | null;
  status?: string | null;
  effective_status?: string | null;
  buying_type?: string | null;
  bid_strategy?: string | null;
  daily_budget?: string | null;
  lifetime_budget?: string | null;
  start_time?: string | null;
  stop_time?: string | null;
  updated_time?: string | null;
};

export type MetaAdSetRecord = {
  id: string;
  name?: string | null;
  campaign_id?: string | null;
  status?: string | null;
  effective_status?: string | null;
  optimization_goal?: string | null;
  billing_event?: string | null;
  bid_strategy?: string | null;
  daily_budget?: string | null;
  lifetime_budget?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  updated_time?: string | null;
};

export type MetaAdRecord = {
  id: string;
  name?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  status?: string | null;
  effective_status?: string | null;
  updated_time?: string | null;
  creative?: {
    id?: string | null;
    name?: string | null;
  } | null;
};

export type MetaBusinessRecord = {
  id: string;
  name?: string | null;
  verification_status?: string | null;
  created_time?: string | null;
};

export type MetaBusinessAdAccountRecord = {
  id: string;
  account_id?: string | null;
  name?: string | null;
  account_status?: number | null;
  currency?: string | null;
  timezone_name?: string | null;
};

export type MetaBusinessPageRecord = {
  id: string;
  name?: string | null;
  link?: string | null;
  instagram_business_account?: {
    id?: string | null;
    username?: string | null;
  } | null;
};

export type MetaAdsOverview = {
  configured: {
    app_id: boolean;
    app_secret: boolean;
    access_token: boolean;
    ad_account_id: boolean;
    business_id: boolean;
    api_version: string;
    base_url: string;
    missing_required: string[];
    missing_optional: string[];
  };
  fetched_at: string;
  warnings: string[];
  ads_manager: {
    account: MetaAdAccountRecord | null;
    insights_window_days: number;
    insights: MetaAccountInsightsRecord | null;
    instagram_accounts: MetaInstagramAccountRecord[];
    campaigns: MetaCampaignRecord[];
    ad_sets: MetaAdSetRecord[];
    ads: MetaAdRecord[];
  };
  business_suite: {
    business: MetaBusinessRecord | null;
    owned_ad_accounts: MetaBusinessAdAccountRecord[];
    pages: MetaBusinessPageRecord[];
  };
};

type MetaOverviewOptions = {
  days?: number;
  limit?: number;
};

function normalizeAdAccountId(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function buildMetaConfiguration() {
  const appId = config.META_APP_ID.trim();
  const appSecret = config.META_APP_SECRET.trim();
  const accessToken = config.META_ACCESS_TOKEN.trim();
  const adAccountId = normalizeAdAccountId(config.META_AD_ACCOUNT_ID);
  const businessId = config.META_BUSINESS_ID.trim();

  return {
    app_id: Boolean(appId),
    app_secret: Boolean(appSecret),
    access_token: Boolean(accessToken),
    ad_account_id: Boolean(adAccountId),
    business_id: Boolean(businessId),
    api_version: config.META_API_VERSION.trim() || "v25.0",
    base_url: config.META_GRAPH_API_BASE.trim().replace(/\/$/, "") || "https://graph.facebook.com",
    missing_required: [
      !accessToken ? "META_ACCESS_TOKEN" : null,
      !adAccountId ? "META_AD_ACCOUNT_ID" : null,
    ].filter((value): value is string => Boolean(value)),
    missing_optional: [
      !appId ? "META_APP_ID" : null,
      !appSecret ? "META_APP_SECRET" : null,
      !businessId ? "META_BUSINESS_ID" : null,
    ].filter((value): value is string => Boolean(value)),
    normalized_ad_account_id: adAccountId,
    normalized_business_id: businessId,
    access_token_value: accessToken,
  };
}

function buildDateRange(days: number) {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

async function metaGraphGet<T>(path: string, params: Record<string, string | number | undefined>, accessToken: string) {
  const url = new URL(`${config.META_GRAPH_API_BASE.replace(/\/$/, "")}/${config.META_API_VERSION.replace(/^\//, "")}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
  });

  const rawBody = await response.text();
  const parsedBody = rawBody ? (JSON.parse(rawBody) as T & GraphErrorPayload) : ({} as T & GraphErrorPayload);

  if (!response.ok) {
    const error = parsedBody.error;
    const message = error?.message ?? `Meta Graph API request failed with ${response.status}`;
    throw new Error(message);
  }

  return parsedBody;
}

async function safeLoad<T>(label: string, warnings: string[], fallback: T, callback: () => Promise<T>) {
  try {
    return await callback();
  } catch (error) {
    warnings.push(`${label}: ${error instanceof Error ? error.message : "Unknown error"}`);
    return fallback;
  }
}

export async function getMetaAdsOverview(options: MetaOverviewOptions = {}): Promise<MetaAdsOverview> {
  const configured = buildMetaConfiguration();
  const days = Math.max(1, Math.min(90, Math.trunc(options.days ?? 30) || 30));
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 80) || 80));
  const warnings: string[] = [];

  const overview: MetaAdsOverview = {
    configured: {
      app_id: configured.app_id,
      app_secret: configured.app_secret,
      access_token: configured.access_token,
      ad_account_id: configured.ad_account_id,
      business_id: configured.business_id,
      api_version: configured.api_version,
      base_url: configured.base_url,
      missing_required: configured.missing_required,
      missing_optional: configured.missing_optional,
    },
    fetched_at: new Date().toISOString(),
    warnings,
    ads_manager: {
      account: null,
      insights_window_days: days,
      insights: null,
      instagram_accounts: [],
      campaigns: [],
      ad_sets: [],
      ads: [],
    },
    business_suite: {
      business: null,
      owned_ad_accounts: [],
      pages: [],
    },
  };

  if (!configured.access_token) {
    warnings.push("META_ACCESS_TOKEN is missing. Live Meta data is unavailable.");
    return overview;
  }

  const accessToken = configured.access_token_value;

  if (configured.normalized_ad_account_id) {
    const adAccountId = configured.normalized_ad_account_id;
    const timeRange = JSON.stringify(buildDateRange(days));

    const [account, insightsRows, instagramAccounts, campaigns, adSets, ads] = await Promise.all([
      safeLoad("Ads Manager account", warnings, null, () =>
        metaGraphGet<MetaAdAccountRecord>(
          `/${adAccountId}`,
          {
            fields:
              "id,account_id,name,account_status,currency,timezone_name,timezone_offset_hours_utc,balance,amount_spent,disable_reason,created_time",
          },
          accessToken
        )
      ),
      safeLoad("Ads Manager insights", warnings, [] as MetaAccountInsightsRecord[], async () => {
        const response = await metaGraphGet<GraphListResponse<MetaAccountInsightsRecord>>(
          `/${adAccountId}/insights`,
          {
            time_range: timeRange,
            limit: 1,
            fields: "account_currency,spend,impressions,reach,clicks,ctr,cpc,cpm,date_start,date_stop",
          },
          accessToken
        );

        return response.data ?? [];
      }),
      safeLoad("Ads Manager Instagram accounts", warnings, [] as MetaInstagramAccountRecord[], async () => {
        const response = await metaGraphGet<GraphListResponse<MetaInstagramAccountRecord>>(
          `/${adAccountId}/instagram_accounts`,
          {
            limit,
            fields: "id,username,profile_pic",
          },
          accessToken
        );

        return response.data ?? [];
      }),
      safeLoad("Campaigns", warnings, [] as MetaCampaignRecord[], async () => {
        const response = await metaGraphGet<GraphListResponse<MetaCampaignRecord>>(
          `/${adAccountId}/campaigns`,
          {
            limit,
            fields:
              "id,name,objective,status,effective_status,buying_type,bid_strategy,daily_budget,lifetime_budget,start_time,stop_time,updated_time",
          },
          accessToken
        );

        return response.data ?? [];
      }),
      safeLoad("Ad sets", warnings, [] as MetaAdSetRecord[], async () => {
        const response = await metaGraphGet<GraphListResponse<MetaAdSetRecord>>(
          `/${adAccountId}/adsets`,
          {
            limit,
            fields:
              "id,name,campaign_id,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,updated_time",
          },
          accessToken
        );

        return response.data ?? [];
      }),
      safeLoad("Ads", warnings, [] as MetaAdRecord[], async () => {
        const response = await metaGraphGet<GraphListResponse<MetaAdRecord>>(
          `/${adAccountId}/ads`,
          {
            limit,
            fields: "id,name,campaign_id,adset_id,status,effective_status,updated_time,creative{id,name}",
          },
          accessToken
        );

        return response.data ?? [];
      }),
    ]);

    overview.ads_manager.account = account;
    overview.ads_manager.insights = insightsRows[0] ?? null;
    overview.ads_manager.instagram_accounts = instagramAccounts;
    overview.ads_manager.campaigns = campaigns;
    overview.ads_manager.ad_sets = adSets;
    overview.ads_manager.ads = ads;
  } else {
    warnings.push("META_AD_ACCOUNT_ID is missing. Ads Manager data could not be loaded.");
  }

  if (configured.normalized_business_id) {
    const businessId = configured.normalized_business_id;

    const [business, ownedAdAccounts, pages] = await Promise.all([
      safeLoad("Business Suite summary", warnings, null, () =>
        metaGraphGet<MetaBusinessRecord>(
          `/${businessId}`,
          {
            fields: "id,name,verification_status,created_time",
          },
          accessToken
        )
      ),
      safeLoad("Business Suite ad accounts", warnings, [] as MetaBusinessAdAccountRecord[], async () => {
        const response = await metaGraphGet<GraphListResponse<MetaBusinessAdAccountRecord>>(
          `/${businessId}/owned_ad_accounts`,
          {
            limit,
            fields: "id,account_id,name,account_status,currency,timezone_name",
          },
          accessToken
        );

        return response.data ?? [];
      }),
      safeLoad("Business Suite pages", warnings, [] as MetaBusinessPageRecord[], async () => {
        const response = await metaGraphGet<GraphListResponse<MetaBusinessPageRecord>>(
          `/${businessId}/owned_pages`,
          {
            limit,
            fields: "id,name,link,instagram_business_account{id,username}",
          },
          accessToken
        );

        return response.data ?? [];
      }),
    ]);

    overview.business_suite.business = business;
    overview.business_suite.owned_ad_accounts = ownedAdAccounts;
    overview.business_suite.pages = pages;
  } else {
    warnings.push("META_BUSINESS_ID is missing. Business Suite data could not be loaded.");
  }

  return overview;
}
