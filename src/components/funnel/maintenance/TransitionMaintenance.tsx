"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";
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
import { Badge } from "@/components/ui/badge";
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
  createFunnelTransition,
  deleteFunnelTransition,
  updateFunnelTransition,
  type CreateFunnelTransitionInput,
} from "@/lib/actions/funnel";
import type {
  FunnelStage,
  FunnelTransition,
  FunnelTransitionType,
} from "@/lib/funnel/types";

type Props = {
  funnelFlowId: number;
  stages: FunnelStage[];
  transitions: FunnelTransition[];
};

const TRANSITION_TYPES: FunnelTransitionType[] = [
  "forward",
  "dropoff",
  "backward",
];

const blankForm = (
  funnelFlowId: number,
  stages: FunnelStage[],
): CreateFunnelTransitionInput => {
  const first = stages[0]?.funnel_stage_id ?? 0;
  const second = stages[1]?.funnel_stage_id ?? 0;
  return {
    funnel_flow_id: funnelFlowId,
    source_stage_id: first,
    target_stage_id: second,
    slug: "",
    transition_type: "forward",
    is_active: true,
  };
};

export function TransitionMaintenance({
  funnelFlowId,
  stages,
  transitions,
}: Props) {
  const t = useTranslations("funnel.maintenance.transitions");
  const tA = useTranslations("funnel.maintenance.actions");
  const tT = useTranslations("funnel.maintenance.toasts");
  const tDS = useTranslations("funnel.dataStructure");

  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.funnel_stage_id, s])),
    [stages],
  );

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CreateFunnelTransitionInput>(
    blankForm(funnelFlowId, stages),
  );
  const [pending, startTransition] = useTransition();

  function openNew() {
    setEditingId(null);
    setForm(blankForm(funnelFlowId, stages));
    setOpen(true);
  }

  function openEdit(tr: FunnelTransition) {
    setEditingId(tr.funnel_transition_id);
    setForm({
      funnel_flow_id: tr.funnel_flow_id,
      source_stage_id: tr.source_stage_id,
      target_stage_id: tr.target_stage_id,
      slug: tr.slug,
      transition_type: tr.transition_type,
      is_active: tr.is_active,
    });
    setOpen(true);
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = editingId
        ? await updateFunnelTransition({
            ...form,
            funnel_transition_id: editingId,
          })
        : await createFunnelTransition(form);
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
      const result = await deleteFunnelTransition(editingId);
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
                  {tDS("transition")}
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.transitionType")}
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.slug")}
                </TableHead>
                <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.isActive")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transitions.map((tr) => {
                const source = stageById.get(tr.source_stage_id);
                const target = stageById.get(tr.target_stage_id);
                const tone =
                  tr.transition_type === "dropoff"
                    ? "destructive"
                    : tr.transition_type === "backward"
                      ? "outline"
                      : "secondary";
                return (
                  <TableRow
                    key={tr.funnel_transition_id}
                    onClick={() => openEdit(tr)}
                    className="cursor-pointer"
                  >
                    <TableCell className="text-xs">
                      <span className="text-slate-700">
                        {source?.label ?? tr.source_stage_id}
                      </span>
                      <span className="mx-1 text-slate-400">→</span>
                      <span className="text-slate-700">
                        {target?.label ?? tr.target_stage_id}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={tone}>
                        {t(`types.${tr.transition_type}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {tr.slug}
                    </TableCell>
                    <TableCell>
                      {tr.is_active ? (
                        <Badge variant="secondary">✓</Badge>
                      ) : (
                        <Badge variant="outline">✗</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
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
              <div>
                <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.source")}
                </Label>
                <Select
                  value={String(form.source_stage_id)}
                  onValueChange={(v) =>
                    setForm({ ...form, source_stage_id: Number(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem
                        key={s.funnel_stage_id}
                        value={String(s.funnel_stage_id)}
                      >
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.target")}
                </Label>
                <Select
                  value={String(form.target_stage_id)}
                  onValueChange={(v) =>
                    setForm({ ...form, target_stage_id: Number(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem
                        key={s.funnel_stage_id}
                        value={String(s.funnel_stage_id)}
                      >
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <FloatingLabelInput
                id="transition-slug"
                label={t("fields.slug")}
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                disabled={pending}
                wrapperClassName="col-span-2"
              />

              <div>
                <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.transitionType")}
                </Label>
                <Select
                  value={form.transition_type}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      transition_type: v as FunnelTransitionType,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSITION_TYPES.map((tt) => (
                      <SelectItem key={tt} value={tt}>
                        {t(`types.${tt}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Label className="flex items-center gap-2">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                  disabled={pending}
                />
                <span className="text-sm">{t("fields.isActive")}</span>
              </Label>
            </div>

            {editingId !== null && (
              <p className="mt-3 text-xs text-amber-700">
                {t("deleteWarning")}
              </p>
            )}

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
