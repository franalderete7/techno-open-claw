import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProducts, getSettings } from "../../lib/api";
import { getSiteMode } from "../../lib/site-mode";
import { buildStorefrontPageMetadata } from "../../lib/storefront-metadata";
import { buildStorefrontProducts, buildStorefrontProfile } from "../../lib/storefront";
import { AppleStorefrontCatalog } from "../components/apple-storefront-catalog";

export const metadata: Metadata = buildStorefrontPageMetadata({
  title: "iPhone | TechnoStore Apple",
  description: "Catálogo de iPhone nuevos con precio final, cuotas visibles, envíos a todo el país y atención directa por WhatsApp.",
  path: "/iphone",
  storefrontUrl: "https://technostoresalta.com",
  siteName: "TechnoStore Apple",
  imageUrl: "/brand/logo-blanco-salta.png",
});

export default async function AppleStorefrontPage() {
  if ((await getSiteMode()) !== "storefront") {
    notFound();
  }

  let products = [] as Awaited<ReturnType<typeof getProducts>>["items"];
  let settings = [] as Awaited<ReturnType<typeof getSettings>>["items"];
  let error: string | null = null;

  try {
    const [productResponse, settingsResponse] = await Promise.all([getProducts(200, { active: true }), getSettings()]);
    products = productResponse.items;
    settings = settingsResponse.items;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load Apple storefront";
  }

  if (error) {
    return (
      <div className="page-stack">
        <section className="panel">
          <p className="empty">{error}</p>
        </section>
      </div>
    );
  }

  const store = buildStorefrontProfile(settings);
  const appleProducts = buildStorefrontProducts(products).filter(
    (product) => product.brand.trim().toLowerCase() === "apple" && product.condition.toLowerCase() === "new"
  );

  return <AppleStorefrontCatalog store={{ ...store, name: "TechnoStore Apple" }} products={appleProducts} />;
}
