import type { Metadata, Viewport } from "next";
import { Calistoga } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { localeDirection } from "@/lib/i18n/config";
import { getRequestLocale } from "@/lib/i18n/server";
import "./globals.css";

// Seule police téléchargée (≈ 20 Ko, latin, un seul graisse) ; le texte courant utilise les polices du système.
const calistoga = Calistoga({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-calistoga" });

export const metadata: Metadata = {
  title: "QADR OPS — Suivez vos ventes, votre stock et votre caisse",
  description:
    "QADR OPS est un projet de gestion commerciale conçu pour les commerces de proximité. Chaque entreprise disposera de son propre espace.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#12314f" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} dir={localeDirection[locale]} className={calistoga.variable}>
      <body>
        <I18nProvider locale={locale}>
          <AnalyticsProvider>{children}</AnalyticsProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
