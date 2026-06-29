import { redirect } from "@/i18n/routing";
import { getLocale } from "next-intl/server";

/**
 * /dashboard is a tabbed surface (Overview / Traffic / Search). The route itself
 * just forwards to the default tab (Overview — the entrepreneur summary); each
 * tab owns its own URL + state.
 */
export default async function DashboardIndexPage() {
  const locale = await getLocale();
  redirect({ href: "/dashboard/overview", locale });
}
