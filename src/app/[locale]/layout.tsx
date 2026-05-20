import type { Metadata } from "next";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { Hanken_Grotesk, Caveat } from "next/font/google";
import { routing } from "@/i18n/routing";
import { IntlClientProvider } from "@/components/i18n/IntlClientProvider";
import { Toaster } from "@/components/ui/sonner";
import "../globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hanken",
});

const caveat = Caveat({
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
  variable: "--font-caveat",
});

export const metadata: Metadata = {
  title: "GroLabs · Administración de catálogo",
  description:
    "GroLabs — administración multi-tenant de catálogos de comercio electrónico.",
};

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * Locale root layout. Provides:
 *   - <html lang> set from the active locale
 *   - NextIntlClientProvider with the locale's message bundle
 *
 * This is the outermost layout that renders html/body; the thin
 * app/layout.tsx above it satisfies Next.js's root-layout requirement
 * without re-wrapping html/body.
 */
export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  // Guard: if somehow an unknown locale segment reaches this layout, 404.
  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }

  // getMessages() reads from the request config (src/i18n/request.ts).
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${hanken.variable} ${caveat.variable}`}>
      <body>
        <IntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster />
        </IntlClientProvider>
      </body>
    </html>
  );
}
