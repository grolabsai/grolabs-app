import { listTenantsForAdmin, type TenantSummary } from "@/lib/actions/users";
import { ClientesScreen } from "./ClientesScreen";

/**
 * Admin "Clientes" route. Authorization is enforced by the (admin) layout
 * (isGroLabsAdmin) and again inside listTenantsForAdmin / createCustomerAccount.
 * Per docs/policy/user-management.md §3.
 */
export default async function ClientesPage() {
  const res = await listTenantsForAdmin();
  const tenants: TenantSummary[] = res.ok ? res.tenants : [];
  return <ClientesScreen initialTenants={tenants} />;
}
