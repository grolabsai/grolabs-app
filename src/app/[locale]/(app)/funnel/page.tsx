import { redirect } from "@/i18n/routing";
import { getLocale } from "next-intl/server";
import { getFunnelInstancesForUser } from "@/lib/funnel/queries";

export const dynamic = "force-dynamic";

const DEFAULT_TEMPLATE_SLUG = "template_clothing";

/**
 * /funnel — landing route. Picks a default funnel_instance for the user
 * and redirects to /funnel/<slug>.
 *
 * Selection rule (per Phase 2 plan-back):
 *   1. The user's first own (non-template) instance, if any.
 *   2. Otherwise the Clothing template (instance_id = 0, slug = template_clothing).
 *   3. If even that's missing — defensive fallback to whatever shows up first.
 */
export default async function FunnelIndexPage() {
  const locale = await getLocale();
  const instances = await getFunnelInstancesForUser();

  const owned = instances.find((i) => i.instance_id !== 0);
  const clothing = instances.find((i) => i.slug === DEFAULT_TEMPLATE_SLUG);
  const fallback = instances[0];
  const target = owned ?? clothing ?? fallback;

  if (!target) {
    // No visible funnel_instance at all — surface the empty state so the
    // operator knows seed/RLS is wrong, instead of a silent redirect loop.
    return (
      <div className="s-content">
        <p style={{ color: "var(--s-text-tertiary)", fontSize: 13 }}>
          No funnel instances visible. Verify the funnel seed migration
          ran and that you&apos;re an active member of an instance.
        </p>
      </div>
    );
  }

  redirect({ href: `/funnel/${target.slug}`, locale });
}
