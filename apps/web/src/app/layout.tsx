import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PwaRegistrar } from "@/components/pwa/pwa-registrar";
import { UpdateNotice } from "@/components/pwa/update-notice";
import { brand } from "@/lib/brand";
import { localeDirection } from "@/lib/i18n/config";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator, dictionaries } from "@/lib/i18n/translate";
import "./globals.css";

// Une seule police variable (latin uniquement, toutes graisses dans un fichier) ; l'arabe utilise la police du système.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-jakarta" });

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getRequestLocale());
  return {
    title: t("meta.siteTitle"), description: t("meta.siteDescription"),
    // Icônes produites depuis public/brand/qadr-app-icon.svg (scripts/generate-pwa-icons.mjs) : onglet, puis écran d'accueil.
    icons: {
      icon: [
        { url: brand.icons.favicon32, sizes: "32x32", type: "image/png" },
        { url: brand.icons.favicon48, sizes: "48x48", type: "image/png" },
        { url: brand.icons.icon192, sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: brand.icons.appleTouch, sizes: "180x180" }],
    },
    // iOS : ouverture plein écran depuis l'écran d'accueil (Safari ne lit pas « display » du manifest partout).
    appleWebApp: { capable: true, title: "QADR OPS", statusBarStyle: "default" },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#03108e" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} dir={localeDirection[locale]} className={jakarta.variable}>
      <body>
        <I18nProvider locale={locale} messages={dictionaries[locale]}>
          <AnalyticsProvider>{children}</AnalyticsProvider>
          <UpdateNotice />
        </I18nProvider>
        <PwaRegistrar />
      </body>
    </html>
  );
}
