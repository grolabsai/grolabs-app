import type { Metadata } from "next";
import { Hanken_Grotesk, Permanent_Marker } from "next/font/google";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { IntlClientProvider } from "@/components/i18n/IntlClientProvider";
import { Toaster } from "@/components/ui/sonner";
import "../globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hanken",
});

const marker = Permanent_Marker({
  subsets: ["latin"],
  display: "swap",
  weight: "400",
  variable: "--font-marker",
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

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} className={`${hanken.variable} ${marker.variable}`}>
      <body>
        <IntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster />
        </IntlClientProvider>
      </body>
    </html>
  );
}
