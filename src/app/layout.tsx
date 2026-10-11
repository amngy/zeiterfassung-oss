import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { BRAND } from "@/config/brand";
import "./globals.css";

// next/font self-hosts the font files at build time — no runtime request to
// Google is made, which keeps the deployment DSGVO-clean (no CDN data leak).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: BRAND.appName,
    template: `%s · ${BRAND.appName}`,
  },
  description: BRAND.description,
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" className={inter.variable}>
      <body className="min-h-full bg-white font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
