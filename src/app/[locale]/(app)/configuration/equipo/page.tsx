import { notFound } from "next/navigation";
import { isCurrentTenantAdmin } from "@/lib/auth/roles";
import { listTenantMembers, type TenantMemberSummary } from "@/lib/actions/users";
import { EquipoScreen } from "./EquipoScreen";

/**
 * RRE "Equipo" route — Tenant Admins manage their tenant's users. Hidden from
 * non-admins in the nav and hard-gated here (notFound) + in every server
 * action. Per docs/policy/user-management.md §4.
 */
export default async function EquipoPage() {
  if (!(await isCurrentTenantAdmin())) {
    notFound();
  }
  const res = await listTenantMembers();
  const members: TenantMemberSummary[] = res.ok ? res.members : [];
  return <EquipoScreen initialMembers={members} />;
}
