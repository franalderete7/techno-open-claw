import { headers } from "next/headers";
import { redirect } from "next/navigation";

export type SiteMode = "admin" | "storefront";

function normalizeHost(rawHost: string | null) {
  return (rawHost ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function isAdminHostname(hostname: string) {
  if (!hostname) return true;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("admin.");
}

export async function getSiteMode(): Promise<SiteMode> {
  const headerStore = await headers();
  const host = normalizeHost(headerStore.get("x-forwarded-host") ?? headerStore.get("host"));
  return isAdminHostname(host) ? "admin" : "storefront";
}

export async function requireAdminHost() {
  if ((await getSiteMode()) !== "admin") {
    redirect("/");
  }
}
