"use client";

import { useState, useTransition } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createFunnelStage,
  deleteFunnelStage,
  updateFunnelStage,
  type CreateFunnelStageInput,
} from "@/lib/actions/funnel";
import type { FunnelStage } from "@/lib/funnel/types";

type Props = {
  funnelFlowId: number;
  stages: FunnelStage[];
};

const blankForm = (funnelFlowId: number): CreateFunnelStageInput => ({
  funnel_flow_id: funnelFlowId,
  slug: "",
  label: "",
  stage_order: null,
  color: null,
  position_x: 0,
  position_y: 0,
  icon_key: null,
  is_terminal: false,
  is_dropoff: false,
});

export function StageMaintenance({ funnelFlowId, stages }: Props) {
  const t = useTranslations("funnel.maintenance.stages");
  const tDS = useTranslations("funnel.dataStructure");
  const tA = useTranslations("funnel.maintenance.actions");
  const tT = useTranslations("funnel.maintenance.toasts");

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CreateFunnelStageInput>(blankForm(funnelFlowId));
  const [pending, startTransition] = useTransition();

  function openNew() {
    setEditingId(null);
    setForm(blankForm(funnelFlowId));
    setOpen(true);
  }

  function openEdit(stage: FunnelStage) {
    setEditingId(stage.funnel_stage_id);
    setForm({
      funnel_flow_id: stage.funnel_flow_id,
      slug: stage.slug,
      label: stage.label,
      stage_order: stage.stage_order,
      color: stage.color,
      position_x: stage.position_x,
      position_y: stage.position_y,
      icon_key: stage.icon_key,
      is_terminal: stage.is_terminal,
      is_dropoff: stage.is_dropoff,
    });
    setOpen(true);
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = editingId
        ? await updateFunnelStage({ ...form, funnel_stage_id: editingId })
        : await createFunnelStage(form);
      if ("error" in result) {
        toast.error(tT("error"), { description: result.error });
        return;
      }
      toast.success(tT("saved"));
      setOpen(false);
    });
  }

  function handleDelete() {
    if (!editingId) return;
    if (!window.confirm(tA("confirmDelete"))) return;
    startTransition(async () => {
      const result = await deleteFunnelStage(editingId);
      if ("error" in result) {
        toast.error(tT("error"), { description: result.error });
        return;
      }
      toast.success(tT("deleted"));
      setOpen(false);
    });
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">{t("title")}</div>
          <Button type="button" size="sm" onClick={openNew}>
            {t("add")}
          </Button>
        </div>
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {tDS("stageId")}
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {tDS("stageLabel")}
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Icon
                </TableHead>
                <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  X
                </TableHead>
                <TableHead className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Y
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stages.map((stage) => (
                <TableRow
                  key={stage.funnel_stage_id}
                  onClick={() => openEdit(stage)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-mono text-xs text-slate-600">
                    {stage.slug}
                  </TableCell>
                  <TableCell>{stage.label}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">
                    {stage.icon_key ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {stage.position_x}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">
                    {stage.position_y}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editingId ? t("editTitle") : t("newTitle")}
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <FloatingLabelInput
                id="stage-slug"
                label={t("fields.slug")}
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                disabled={pending}
              />
              <FloatingLabelInput
                id="stage-label"
                label={t("fields.label")}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                disabled={pending}
              />
              <FloatingLabelInput
                id="stage-order"
                label={t("fields.stageOrder")}
                type="number"
                value={form.stage_order ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    stage_order:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                disabled={pending}
              />
              <FloatingLabelInput
                id="stage-color"
                label={t("fields.color")}
                value={form.color ?? ""}
                onChange={(e) =>
                  setForm({ ...form, color: e.target.value || null })
                }
                disabled={pending}
              />
              <FloatingLabelInput
                id="stage-x"
                label={t("fields.positionX")}
                type="number"
                value={form.position_x}
                onChange={(e) =>
                  setForm({ ...form, position_x: Number(e.target.value) || 0 })
                }
                disabled={pending}
              />
              <FloatingLabelInput
                id="stage-y"
                label={t("fields.positionY")}
                type="number"
                value={form.position_y}
                onChange={(e) =>
                  setForm({ ...form, position_y: Number(e.target.value) || 0 })
                }
                disabled={pending}
              />
              <FloatingLabelInput
                id="stage-icon"
                label={t("fields.iconKey")}
                value={form.icon_key ?? ""}
                onChange={(e) =>
                  setForm({ ...form, icon_key: e.target.value || null })
                }
                wrapperClassName="col-span-2"
                disabled={pending}
              />
              <div className="col-span-2 flex items-center gap-6">
                <Label className="flex items-center gap-2">
                  <Switch
                    checked={form.is_terminal}
                    onCheckedChange={(v) =>
                      setForm({ ...form, is_terminal: v })
                    }
                    disabled={pending}
                  />
                  <span className="text-sm">{t("fields.isTerminal")}</span>
                </Label>
                <Label className="flex items-center gap-2">
                  <Switch
                    checked={form.is_dropoff}
                    onCheckedChange={(v) =>
                      setForm({ ...form, is_dropoff: v })
                    }
                    disabled={pending}
                  />
                  <span className="text-sm">{t("fields.isDropoff")}</span>
                </Label>
              </div>
            </div>

            <DialogFooter className="mt-4 gap-2">
              {editingId !== null && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={pending}
                >
                  {pending ? tA("deleting") : tA("delete")}
                </Button>
              )}
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
