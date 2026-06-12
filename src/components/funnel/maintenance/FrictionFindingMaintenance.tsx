"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/agent-toast";
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
import {
  createFrictionFinding,
  deleteFrictionFinding,
  updateFrictionFinding,
} from "@/lib/actions/funnel";
import type {
  FunnelFrictionFinding,
  FunnelFrictionPoint,
  FunnelSeverity,
} from "@/lib/funnel/types";

const SEVERITIES: FunnelSeverity[] = ["low", "medium", "high", "critical"];

const SEVERITY_TONE: Record<FunnelSeverity, "default" | "secondary" | "destructive" | "outline"> =
  {
    low: "outline",
    medium: "secondary",
    high: "default",
    critical: "destructive",
  };

type Props = {
  funnelInstanceId: number;
  frictionPoints: FunnelFrictionPoint[];
  frictionFindings: FunnelFrictionFinding[];
  readOnly: boolean;
};

type FormState = {
  funnel_friction_point_id: number;
  slug: string;
  severity: FunnelSeverity;
  evidence: string;
  source_system: string;
  observed_at: string;
};

const blankForm = (firstFpId: number): FormState => ({
  funnel_friction_point_id: firstFpId,
  slug: "",
  severity: "medium",
  evidence: "",
  source_system: "",
  observed_at: "",
});

export function FrictionFindingMaintenance({
  funnelInstanceId,
  frictionPoints,
  frictionFindings,
  readOnly,
}: Props) {
  const t = useTranslations("funnel.maintenance.frictionFindings");
  const tA = useTranslations("funnel.maintenance.actions");
  const tT = useTranslations("funnel.maintenance.toasts");
  const tSeverity = useTranslations("funnel.severity");

  const fpById = useMemo(
    () => new Map(frictionPoints.map((fp) => [fp.funnel_friction_point_id, fp])),
    [frictionPoints],
  );

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(
    blankForm(frictionPoints[0]?.funnel_friction_point_id ?? 0),
  );
  const [pending, startTransition] = useTransition();

  function openNew() {
    setEditingId(null);
    setForm(blankForm(frictionPoints[0]?.funnel_friction_point_id ?? 0));
    setOpen(true);
  }

  function openEdit(ff: FunnelFrictionFinding) {
    setEditingId(ff.funnel_friction_finding_id);
    setForm({
      funnel_friction_point_id: ff.funnel_friction_point_id,
      slug: ff.slug ?? "",
      severity: ff.severity,
      evidence: ff.evidence,
      source_system: ff.source_system ?? "",
      observed_at: ff.observed_at ?? "",
    });
    setOpen(true);
  }

  function handleSubmit() {
    const payload = {
      funnel_instance_id: funnelInstanceId,
      funnel_friction_point_id: form.funnel_friction_point_id,
      slug: form.slug.trim() || null,
      severity: form.severity,
      evidence: form.evidence,
      source_system: form.source_system.trim() || null,
      observed_at: form.observed_at.trim() || null,
    };

    startTransition(async () => {
      const result = editingId
        ? await updateFrictionFinding({
            ...payload,
            funnel_friction_finding_id: editingId,
          })
        : await createFrictionFinding(payload);
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
      const result = await deleteFrictionFinding(editingId);
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
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              onClick={openNew}
              disabled={frictionPoints.length === 0}
            >
              {t("add")}
            </Button>
          )}
        </div>

        {readOnly && (
          <p className="mb-3 text-xs text-amber-700">{t("templateReadOnly")}</p>
        )}

        {frictionFindings.length === 0 ? (
          <p className="text-xs text-slate-500">—</p>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("fields.frictionPoint")}
                  </TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("fields.severity")}
                  </TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("fields.evidence")}
                  </TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t("fields.observedAt")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {frictionFindings.map((ff) => (
                  <TableRow
                    key={ff.funnel_friction_finding_id}
                    onClick={() => !readOnly && openEdit(ff)}
                    className={readOnly ? "" : "cursor-pointer"}
                  >
                    <TableCell className="text-xs text-slate-700">
                      {fpById.get(ff.funnel_friction_point_id)?.name ?? ""}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_TONE[ff.severity]}>
                        {tSeverity(ff.severity)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700 max-w-[420px] truncate">
                      {ff.evidence}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums">
                      {ff.observed_at ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editingId ? t("editTitle") : t("newTitle")}
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="col-span-2">
                <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.frictionPoint")}
                </Label>
                <Select
                  value={String(form.funnel_friction_point_id)}
                  onValueChange={(v) =>
                    setForm({ ...form, funnel_friction_point_id: Number(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {frictionPoints.map((fp) => (
                      <SelectItem
                        key={fp.funnel_friction_point_id}
                        value={String(fp.funnel_friction_point_id)}
                      >
                        {fp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {t("fields.severity")}
                </Label>
                <Select
                  value={form.severity}
                  onValueChange={(v) =>
                    setForm({ ...form, severity: v as FunnelSeverity })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {tSeverity(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <FloatingLabelInput
                id="ff-slug"
                label={t("fields.slug")}
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                disabled={pending}
              />

              <FloatingLabelInput
                id="ff-evidence"
                label={t("fields.evidence")}
                value={form.evidence}
                onChange={(e) => setForm({ ...form, evidence: e.target.value })}
                disabled={pending}
                wrapperClassName="col-span-2"
              />

              <FloatingLabelInput
                id="ff-source-system"
                label={t("fields.sourceSystem")}
                value={form.source_system}
                onChange={(e) =>
                  setForm({ ...form, source_system: e.target.value })
                }
                disabled={pending}
              />

              <FloatingLabelInput
                id="ff-observed"
                label={t("fields.observedAt")}
                value={form.observed_at}
                onChange={(e) =>
                  setForm({ ...form, observed_at: e.target.value })
                }
                disabled={pending}
              />
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
