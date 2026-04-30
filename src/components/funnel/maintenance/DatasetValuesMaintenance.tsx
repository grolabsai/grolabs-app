"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { upsertDatasetTransitionValue } from "@/lib/actions/funnel";
import { validateDatasetSums } from "@/lib/funnel/validation";
import type {
  FunnelDataset,
  FunnelDatasetTransitionValue,
  FunnelSourceType,
  FunnelStage,
  FunnelTransition,
} from "@/lib/funnel/types";

const SOURCE_TYPES: FunnelSourceType[] = [
  "benchmark",
  "customer_actual",
  "manual_estimate",
  "api_extraction",
];

type Props = {
  dataset: FunnelDataset | null;
  stages: FunnelStage[];
  transitions: FunnelTransition[];
  values: FunnelDatasetTransitionValue[];
};

type EditState = {
  funnel_transition_id: number;
  conversion_pct: number;
  source_type: FunnelSourceType;
  notes: string;
};

export function DatasetValuesMaintenance({
  dataset,
  stages,
  transitions,
  values,
}: Props) {
  const t = useTranslations("funnel.maintenance.datasetValues");
  const tA = useTranslations("funnel.maintenance.actions");
  const tT = useTranslations("funnel.maintenance.toasts");
  const tB = useTranslations("funnel.badges");

  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.funnel_stage_id, s])),
    [stages],
  );
  const valueByTransitionId = useMemo(
    () => new Map(values.map((v) => [v.funnel_transition_id, v])),
    [values],
  );

  // Source-stage sum lookup — surfaces a per-row tolerance badge so users
  // can see at a glance which source-stage rows are out of [99.5, 100.5].
  const sumWarningsBySourceId = useMemo(() => {
    const warnings = validateDatasetSums({ stages, transitions, values });
    return new Map(warnings.map((w) => [w.source_stage_id, w.total]));
  }, [stages, transitions, values]);

  const sumsBySourceId = useMemo(() => {
    const map = new Map<number, number>();
    for (const tr of transitions) {
      const pct = valueByTransitionId.get(tr.funnel_transition_id)?.conversion_pct ?? 0;
      map.set(tr.source_stage_id, (map.get(tr.source_stage_id) ?? 0) + pct);
    }
    return map;
  }, [transitions, valueByTransitionId]);

  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [pending, startTransition] = useTransition();

  function openEdit(tr: FunnelTransition) {
    if (!dataset) return;
    const existing = valueByTransitionId.get(tr.funnel_transition_id);
    setEdit({
      funnel_transition_id: tr.funnel_transition_id,
      conversion_pct: existing?.conversion_pct ?? 0,
      source_type: existing?.source_type ?? "manual_estimate",
      notes: existing?.notes ?? "",
    });
    setOpen(true);
  }

  function handleSubmit() {
    if (!dataset || !edit) return;
    startTransition(async () => {
      const result = await upsertDatasetTransitionValue({
        funnel_dataset_id: dataset.funnel_dataset_id,
        funnel_transition_id: edit.funnel_transition_id,
        conversion_pct: edit.conversion_pct,
        source_type: edit.source_type,
        notes: edit.notes.trim() || null,
      });
      if ("error" in result) {
        toast.error(tT("error"), { description: result.error });
        return;
      }
      toast.success(tT("saved"));
      setOpen(false);
    });
  }

  if (!dataset) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-bold text-slate-900">{t("title")}</div>
          <p className="mt-2 text-sm text-slate-500">{t("noDataset")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">{t("title")}</div>
          <span className="text-xs text-slate-500">{dataset.name}</span>
        </div>

        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("columns.transition")}
                </TableHead>
                <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.conversionPct")}
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.sourceType")}
                </TableHead>
                <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("columns.sourceSum")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transitions.map((tr) => {
                const value = valueByTransitionId.get(tr.funnel_transition_id);
                const sourceLabel =
                  stageById.get(tr.source_stage_id)?.label ?? tr.source_stage_id;
                const targetLabel =
                  stageById.get(tr.target_stage_id)?.label ?? tr.target_stage_id;
                const sourceSum = sumsBySourceId.get(tr.source_stage_id) ?? 0;
                const outOfTolerance = sumWarningsBySourceId.has(tr.source_stage_id);
                return (
                  <TableRow
                    key={tr.funnel_transition_id}
                    onClick={() => openEdit(tr)}
                    className="cursor-pointer"
                  >
                    <TableCell className="text-xs">
                      <span className="text-slate-700">{sourceLabel}</span>
                      <span className="mx-1 text-slate-400">→</span>
                      <span className="text-slate-700">{targetLabel}</span>
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {value ? `${value.conversion_pct.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {value ? tB(value.source_type) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Badge variant={outOfTolerance ? "destructive" : "secondary"}>
                        {sourceSum.toFixed(0)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("editTitle")}</DialogTitle>
            </DialogHeader>

            {edit && (
              <div className="grid gap-3 pt-2">
                <FloatingLabelInput
                  id="value-pct"
                  label={t("fields.conversionPct")}
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={edit.conversion_pct}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      conversion_pct: Number(e.target.value) || 0,
                    })
                  }
                  disabled={pending}
                />

                <div>
                  <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("fields.sourceType")}
                  </Label>
                  <Select
                    value={edit.source_type}
                    onValueChange={(v) =>
                      setEdit({ ...edit, source_type: v as FunnelSourceType })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_TYPES.map((st) => (
                        <SelectItem key={st} value={st}>
                          {tB(st)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <FloatingLabelInput
                  id="value-notes"
                  label={t("fields.notes")}
                  value={edit.notes}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                  disabled={pending}
                />
              </div>
            )}

            <DialogFooter className="mt-4 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {tA("cancel")}
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={pending}>
                {pending ? tA("saving") : tA("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
