import type { Metadata } from "next";
import { Familjen_Grotesk } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const grotesk = Familjen_Grotesk({ subsets: ["latin"], variable: "--font-label" });

export const metadata: Metadata = {
  title: "Driftwood Supply",
  description: "Small-batch objects for the home. A fictional demo shop for Leakproof.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={grotesk.variable}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Driftwood Supply</Link>
          <nav aria-label="Main">
            <Link href="/">Shop</Link>
            <Link href="/login">Sign in</Link>
            <Link href="/checkout">Checkout</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">Driftwood Supply is a fictional shop, built as a Leakproof demo. Nothing here is for sale.</footer>
      </body>
    </html>
  );
}
