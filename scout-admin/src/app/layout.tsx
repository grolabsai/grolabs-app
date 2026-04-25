import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scout · Administración de catálogo",
  description:
    "Scout — administración multi-tenant de catálogos de comercio electrónico.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
