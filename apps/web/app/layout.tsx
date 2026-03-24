import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

const navItems = [
  ["Dashboard", "/"],
  ["Products", "/products"],
  ["Stock", "/stock"],
  ["Orders", "/orders"],
  ["Customers", "/customers"],
  ["Conversations", "/conversations"],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>
          <header>
            <h1>Techno Open Claw</h1>
            <p>
              Read-only operations view for products, stock, orders, customers, and conversations. All write
              actions stay in Telegram/OpenClaw.
            </p>
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
