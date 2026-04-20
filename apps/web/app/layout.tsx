import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { Instrument_Sans, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { getSiteMode } from "../lib/site-mode";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://technostoresalta.com"),
  title: "TechnoStore Salta",
  description: "Smartphones, iPhone y catálogo con precio final, WhatsApp y atención directa en Salta.",
  openGraph: {
    type: "website",
    url: "https://technostoresalta.com",
    title: "TechnoStore Salta",
    description: "Smartphones, iPhone y catálogo con precio final, WhatsApp y atención directa en Salta.",
    siteName: "TechnoStore Salta",
    images: [
      {
        url: "/brand/logo-negro-salta.png",
        alt: "TechnoStore Salta",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TechnoStore Salta",
    description: "Smartphones, iPhone y catálogo con precio final, WhatsApp y atención directa en Salta.",
    images: ["/brand/logo-negro-salta.png"],
  },
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/apple-icon.png",
  },
};

const DATAFAST_WEBSITE_ID = "dfid_0FS4Ry9BtGqWZVGm695Zg";
const DATAFAST_DOMAIN = "technostoresalta.com";
const metaPixelId = process.env.META_PIXEL_ID?.trim() || "";

const navItems = [
  ["Dashboard", "/"],
  ["Customers", "/customers"],
  ["Conversations", "/conversations"],
] as const;

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export default async function RootLayout({ children }: { children: ReactNode }) {
  const siteMode = await getSiteMode();

  return (
    <html lang="en">
      <head>
        {siteMode === "storefront" ? (
          <>
            {metaPixelId ? (
              <Script id="meta-pixel-base" strategy="afterInteractive">
                {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
                n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');fbq('init', '${metaPixelId}');fbq('track', 'PageView');`}
              </Script>
            ) : null}
            <Script id="datafast-queue" strategy="beforeInteractive">
              {`window.datafast=window.datafast||function(){window.datafast.q=window.datafast.q||[];window.datafast.q.push(arguments);};`}
            </Script>
            <Script
              id="datafast-script"
              strategy="afterInteractive"
              src="/js/script.js"
              data-api-url="/datafast-events"
              data-website-id={DATAFAST_WEBSITE_ID}
              data-domain={DATAFAST_DOMAIN}
            />
          </>
        ) : null}
      </head>
      <body className={`${sans.variable} ${serif.variable}`}>
        {siteMode === "admin" ? (
          <main>
            <header className="masthead">
              <div className="brand-copy">
                <span className="eyebrow">Open Claw</span>
                <h1 className="wordmark">TechnoStore Ops</h1>
              </div>
              <p className="masthead-meta">Customers and WhatsApp conversations (minimal ops).</p>
            </header>

            <nav>
              <Link key="brand" href="/" className="nav-brand" aria-label="TechnoStore Ops">
                <Image
                  src="/brand/logo-negro-salta.png"
                  alt=""
                  width={64}
                  height={17}
                  className="nav-brand-image"
                  priority
                />
              </Link>
              {navItems.map(([label, href]) => (
                <Link key={href} href={href}>
                  {label}
                </Link>
              ))}
            </nav>

            {children}
          </main>
        ) : (
          <main className="storefront-main">{children}</main>
        )}
      </body>
    </html>
  );
}
