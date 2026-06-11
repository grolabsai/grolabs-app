import { notFound } from "next/navigation";
import { getTenantDetailForAdmin } from "@/lib/actions/users";
import { TenantUsersScreen } from "./TenantUsersScreen";

/**
 * Admin "Clientes" detail route — GroLabs staff view + edit the users of one
 * tenant. Authorization is enforced by the (admin) layout (isGroLabsAdmin) and
 * again inside getTenantDetailForAdmin + every mutation action. Per
 * docs/policy/user-management.md §3.
 */
export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId: raw } = await params;
  const tenantId = Number(raw);
  if (!Number.isInteger(tenantId) || tenantId < 0) notFound();

  const res = await getTenantDetailForAdmin(tenantId);
  if (!res.ok) notFound();

  return <TenantUsersScreen tenant={res.tenant} initialUsers={res.users} />;
}
