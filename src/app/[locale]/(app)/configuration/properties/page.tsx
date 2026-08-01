import { getTranslations } from "next-intl/server";
import { NoAccess } from "@/components/auth/NoAccess";
import { getPropertiesView } from "@/lib/properties/fetch";
import { PropertiesView } from "./_view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Tenant + instance properties.
 *
 * One place to see what the database actually holds for the signed-in user's
 * tenant and each of its instances, instead of inferring it from scattered
 * screens. Read-everything; edits are limited to descriptive instance fields
 * (see actions.ts for why each excluded field is excluded).
 */
export default async function PropertiesPage() {
  const t = await getTranslations("configuration.properties");
  const view = await getPropertiesView();

  if (view.tenant === null && view.instances.length === 0) {
    return <NoAccess />;
  }

  return (
    <div className="s-content">
      <div className="s-title-row" style={{ marginBottom: 16 }}>
        <div className="s-title-inner">
          <h1 className="s-title">{t("title")}</h1>
          <p className="s-subtitle">{t("subtitle")}</p>
        </div>
      </div>
      <PropertiesView
        tenant={view.tenant}
        instances={view.instances}
        currentInstanceId={view.currentInstanceId}
        canEditInstances={view.canEditInstances}
      />
    </div>
  );
}
