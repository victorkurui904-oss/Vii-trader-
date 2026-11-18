import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BurnitorTrader | Deriv Dashboard",
  description: "A Deriv-connected trading dashboard with manual trading and market tools.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
