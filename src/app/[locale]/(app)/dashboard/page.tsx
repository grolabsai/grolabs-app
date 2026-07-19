import { redirect } from "@/i18n/routing";
import { getLocale } from "next-intl/server";

/**
 * /dashboard is a tabbed surface (Signals / Overview / Traffic / Search). The
 * route itself just forwards to the default tab (Signals — the owner's
 * "are we improving?" verdict view; Overview keeps the filterable point-in-time
 * numbers); each tab owns its own URL + state.
 */
export default async function DashboardIndexPage() {
  const locale = await getLocale();
  redirect({ href: "/dashboard/signals", locale });
}
