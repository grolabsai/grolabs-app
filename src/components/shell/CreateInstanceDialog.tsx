"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { createInstance } from "@/lib/actions/instance";
import { deriveSlug } from "@/lib/instanceSlug";

export function CreateInstanceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("shell.instanceSwitcher.modal");
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = name.trim();
  const slugPreview = deriveSlug(trimmed);
  const canSubmit = !isPending && trimmed.length > 0 && slugPreview.length > 0;

  function reset() {
    setName("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await createInstance(trimmed);
      if (!result.ok) {
        if (result.error === "invalid_name") {
          setError(t("errors.invalidName"));
        } else {
          setError(t("errors.saveFailed"));
        }
        return;
      }
      toast.success(trimmed);
      reset();
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <FloatingLabelInput
              id="instance-name"
              label={t("nameLabel")}
              placeholder={t("namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
              autoComplete="off"
              disabled={isPending}
            />
            <FloatingLabelInput
              id="instance-slug-preview"
              label={t("slugLabel")}
              placeholder={t("slugPlaceholder")}
              value={slugPreview}
              readOnly
              disabled
              className="font-mono text-xs"
            />
            {error ? (
              <p
                className="text-xs"
                style={{ color: "var(--s-text-error, #b91c1c)" }}
              >
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isPending ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
