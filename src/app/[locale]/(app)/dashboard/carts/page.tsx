import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getCartLive } from "@/lib/analytics/carts-live";
import { DashboardTabs } from "../_dashboard-tabs";
import { CartLivePanel } from "@/components/dashboard/carts/cart-live";
import "@/components/dashboard/carts/cart-live.css";

// Realtime view — never statically rendered or cached.
export const dynamic = "force-dynamic";

export default async function CartsDashboardPage() {
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("dashboard.carts");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase
    .from("instance_member")
    .select("instance_id")
    .eq("user_id", user.id)
    .eq("is_current", true)
    .maybeSingle();
  if (!membership) redirect("/login");

  const initial = await getCartLive(membership.instance_id);

  return (
    <div className="s-page-content" style={{ maxWidth: "none" }}>
      <div className="s-page-header" style={{ marginBottom: 20 }}>
        <h1 className="s-page-title">{t("title")}</h1>
      </div>
      <div style={{ marginBottom: 24 }}>
        <DashboardTabs />
      </div>

      <div style={{ marginBottom: 16 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--t3)",
          }}
        >
          {tc("subtitle")}
        </span>
      </div>

      <CartLivePanel initial={initial} />
    </div>
  );
}
