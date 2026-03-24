import Image from "next/image";
import Link from "next/link";
import { Instrument_Sans, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const navItems = [
  ["Dashboard", "/"],
  ["Products", "/products"],
  ["Stock", "/stock"],
  ["Orders", "/orders"],
  ["Customers", "/customers"],
  ["Conversations", "/conversations"],
  ["Settings", "/settings"],
  ["Audit", "/audit"],
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable}`}>
        <main>
          <header className="masthead">
            <div className="masthead-brand">
              <div className="brand-badge" aria-hidden="true">
                <Image
                  src="/brand/logo-negro-salta.png"
                  alt="TechnoStore Salta"
                  width={716}
                  height={190}
                  className="brand-badge-image"
                  priority
                />
              </div>

              <div className="brand-copy">
                <span className="eyebrow">Open Claw</span>
                <h1 className="wordmark">TechnoStore Ops</h1>
              </div>
            </div>
            <p className="masthead-meta">Catalog, stock, customers, orders, workflows.</p>
          </header>

          <nav>
            {navItems.map(([label, href]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </nav>

          {children}
        </main>
      </body>
    </html>
  );
}
