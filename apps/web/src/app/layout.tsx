import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { localeDirection } from "@/lib/i18n/config";
import { getRequestLocale } from "@/lib/i18n/server";
import "./globals.css";

// Une seule police variable (latin uniquement, toutes graisses dans un fichier) ; l'arabe utilise la police du système.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-jakarta" });

export const metadata: Metadata = {
  title: "QADR OPS — Suivez vos ventes, votre stock et votre caisse",
  description:
    "QADR OPS est un projet de gestion commerciale conçu pour les commerces de proximité. Chaque entreprise disposera de son propre espace.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1b1a2e" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} dir={localeDirection[locale]} className={jakarta.variable}>
      <body>
        <I18nProvider locale={locale}>
          <AnalyticsProvider>{children}</AnalyticsProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
