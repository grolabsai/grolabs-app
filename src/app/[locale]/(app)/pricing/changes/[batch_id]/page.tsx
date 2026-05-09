import { notFound, redirect } from "next/navigation";
import { currentInstanceId } from "@/lib/instance";
import { getBatchDetail } from "@/lib/actions/pricing";
import { WorksheetClient } from "@/components/pricing/worksheet/WorksheetClient";

/**
 * Editable worksheet — `/pricing/changes/[batch_id]`.
 *
 * Server component just loads the batch + dependencies via getBatchDetail
 * and hands off to WorksheetClient. Everything interactive (filters,
 * inline editing, bulk actions, status transitions, recompute) lives in
 * the client; this file stays small so re-renders after server actions
 * are quick.
 */

export const dynamic = "force-dynamic";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ batch_id: string }>;
}) {
  const { batch_id: idParam } = await params;
  const batchId = Number(idParam);
  if (!Number.isFinite(batchId)) notFound();

  const instanceId = await currentInstanceId();
  if (instanceId === null) redirect("/login");

  const res = await getBatchDetail(batchId);
  if (!res.ok) notFound();

  return <WorksheetClient batch={res.batch} />;
}
