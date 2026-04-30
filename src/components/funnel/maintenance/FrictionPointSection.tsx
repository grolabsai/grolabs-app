"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FunnelFrictionPoint, FunnelStage } from "@/lib/funnel/types";

type Props = {
  frictionPoints: FunnelFrictionPoint[];
  stages: FunnelStage[];
};

/**
 * Friction-point definitions live on the shared funnel_friction_point
 * table — RLS allows only service_role to write. The maintenance UI
 * surfaces them as read-only with a note about platform-level
 * management. Editing is intentionally not exposed here.
 */
export function FrictionPointSection({ frictionPoints, stages }: Props) {
  const t = useTranslations("funnel.maintenance.frictionPoints");
  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.funnel_stage_id, s])),
    [stages],
  );

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 text-sm font-bold text-slate-900">
          {t("title")}
        </div>
        <p className="mb-3 text-xs text-slate-500">
          {t("platformManagedNote")}
        </p>
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.stage")}
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.name")}
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.category")}
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.description")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {frictionPoints.map((fp) => (
                <TableRow key={fp.funnel_friction_point_id}>
                  <TableCell className="text-xs text-slate-600">
                    {stageById.get(fp.funnel_stage_id)?.label ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-slate-900">
                    {fp.name}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {fp.category ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {fp.description ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
