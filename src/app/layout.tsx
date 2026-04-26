/**
 * Minimal root layout required by Next.js App Router.
 *
 * html/body are rendered by app/[locale]/layout.tsx so that the lang
 * attribute can be set dynamically from the active locale. This file
 * exists only to satisfy Next.js's root-layout requirement.
 *
 * See: https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
