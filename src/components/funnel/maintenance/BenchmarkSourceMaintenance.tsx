"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  createBenchmarkSource,
  deleteBenchmarkSource,
} from "@/lib/actions/funnel";
import type {
  FunnelBenchmarkSource,
  FunnelDatasetTransitionValue,
  FunnelStage,
  FunnelTransition,
} from "@/lib/funnel/types";

type Props = {
  benchmarks: FunnelBenchmarkSource[];
  values: FunnelDatasetTransitionValue[];
  transitions: FunnelTransition[];
  stages: FunnelStage[];
  readOnly: boolean;
};

const blankForm = (firstValueId: number) => ({
  funnel_dataset_transition_value_id: firstValueId,
  title: "",
  url: null as string | null,
  source_name: null as string | null,
  notes: null as string | null,
  observed_value: null as number | null,
  confidence_score: null as number | null,
});

export function BenchmarkSourceMaintenance({
  benchmarks,
  values,
  transitions,
  stages,
  readOnly,
}: Props) {
  const t = useTranslations("funnel.maintenance.benchmarks");
  const tA = useTranslations("funnel.maintenance.actions");
  const tT = useTranslations("funnel.maintenance.toasts");

  const transitionById = useMemo(
    () => new Map(transitions.map((tr) => [tr.funnel_transition_id, tr])),
    [transitions],
  );
  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.funnel_stage_id, s])),
    [stages],
  );
  const valueLabel = (
    v: FunnelDatasetTransitionValue,
  ): string => {
    const tr = transitionById.get(v.funnel_transition_id);
    if (!tr) return `#${v.funnel_dataset_transition_value_id}`;
    const src = stageById.get(tr.source_stage_id)?.label ?? tr.source_stage_id;
    const tgt = stageById.get(tr.target_stage_id)?.label ?? tr.target_stage_id;
    return `${src} → ${tgt}`;
  };

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(
    blankForm(values[0]?.funnel_dataset_transition_value_id ?? 0),
  );
  const [pending, startTransition] = useTransition();

  function openNew() {
    setForm(blankForm(values[0]?.funnel_dataset_transition_value_id ?? 0));
    setOpen(true);
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await createBenchmarkSource(form);
      if ("error" in result) {
        toast.error(tT("error"), { description: result.error });
        return;
      }
      toast.success(tT("saved"));
      setOpen(false);
    });
  }

  function handleDelete(id: number) {
    if (!window.confirm(tA("confirmDelete"))) return;
    startTransition(async () => {
      const result = await deleteBenchmarkSource(id);
      if ("error" in result) {
        toast.error(tT("error"), { description: result.error });
        return;
      }
      toast.success(tT("deleted"));
    });
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">{t("title")}</div>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              onClick={openNew}
              disabled={values.length === 0}
            >
              {t("add")}
            </Button>
          )}
        </div>

        {values.length === 0 ? (
          <p className="text-xs text-slate-500">{t("noValues")}</p>
        ) : benchmarks.length === 0 ? (
          <p className="text-xs text-slate-500">—</p>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("fields.transition")}
                  </TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("fields.title")}
                  </TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("fields.url")}
                  </TableHead>
                  <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("fields.observedValue")}
                  </TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {benchmarks.map((bm) => {
                  const value = values.find(
                    (v) =>
                      v.funnel_dataset_transition_value_id ===
                      bm.funnel_dataset_transition_value_id,
                  );
                  return (
                    <TableRow key={bm.funnel_benchmark_source_id}>
                      <TableCell className="text-xs text-slate-600">
                        {value ? valueLabel(value) : "—"}
                      </TableCell>
                      <TableCell>{bm.title}</TableCell>
                      <TableCell className="text-xs text-blue-700">
                        {bm.url ? (
                          <a
                            href={bm.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {bm.url}
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">
                        {bm.observed_value ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {!readOnly && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleDelete(bm.funnel_benchmark_source_id)
                            }
                            disabled={pending}
                          >
                            {tA("delete")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{t("newTitle")}</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="col-span-2">
                <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.transition")}
                </Label>
                <Select
                  value={String(form.funnel_dataset_transition_value_id)}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      funnel_dataset_transition_value_id: Number(v),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {values.map((v) => (
                      <SelectItem
                        key={v.funnel_dataset_transition_value_id}
                        value={String(v.funnel_dataset_transition_value_id)}
                      >
                        {valueLabel(v)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <FloatingLabelInput
                id="bm-title"
                label={t("fields.title")}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                disabled={pending}
                wrapperClassName="col-span-2"
              />
              <FloatingLabelInput
                id="bm-url"
                label={t("fields.url")}
                value={form.url ?? ""}
                onChange={(e) =>
                  setForm({ ...form, url: e.target.value || null })
                }
                disabled={pending}
                wrapperClassName="col-span-2"
              />
              <FloatingLabelInput
                id="bm-source-name"
                label={t("fields.sourceName")}
                value={form.source_name ?? ""}
                onChange={(e) =>
                  setForm({ ...form, source_name: e.target.value || null })
                }
                disabled={pending}
              />
              <FloatingLabelInput
                id="bm-observed"
                label={t("fields.observedValue")}
                type="number"
                step="0.1"
                value={form.observed_value ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    observed_value:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                disabled={pending}
              />
              <FloatingLabelInput
                id="bm-confidence"
                label={t("fields.confidenceScore")}
                type="number"
                min={0}
                max={1}
                step="0.05"
                value={form.confidence_score ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    confidence_score:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                disabled={pending}
              />
              <FloatingLabelInput
                id="bm-notes"
                label={t("fields.notes")}
                value={form.notes ?? ""}
                onChange={(e) =>
                  setForm({ ...form, notes: e.target.value || null })
                }
                disabled={pending}
              />
            </div>

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
