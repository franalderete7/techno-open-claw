import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

const navItems = [
  ["Products", "/products"],
  ["Stock", "/stock"],
  ["Conversations", "/conversations"],
  ["Customers", "/customers"],
  ["Settings", "/settings"],
  ["Audit", "/audit"],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>
          <header>
            <h1>TechnoStore 📱</h1>
            <p>Product catalog & inventory management</p>
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
