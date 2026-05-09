"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { createBatchFromPriceList } from "@/lib/actions/pricing";

/**
 * Per-row button on the "Listas pendientes" table that runs the calc
 * engine over a price list and redirects to the resulting batch.
 *
 * Server action does the heavy lifting (margin resolution, charm rules,
 * MAP rule filtering, status detection); this component just kicks it
 * off, surfaces errors as toasts, and navigates on success.
 */
export function CreateBatchButton({ priceListId }: { priceListId: number }) {
  const t = useTranslations("pricing.changesPage.pendingLists");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await createBatchFromPriceList(priceListId, null);
      if (!res.ok) {
        toast.error(t("toast.createError"), { description: res.error });
        return;
      }
      toast.success(t("toast.created"));
      router.push(`/pricing/changes/${res.priceBatchId}`);
    });
  }

  return (
    <Button type="button" size="sm" onClick={onClick} disabled={pending}>
      <Icon icon={Sparkles} size={14} strokeWidth={2} />
      <span style={{ marginLeft: 6 }}>
        {pending ? t("creating") : t("create")}
      </span>
    </Button>
  );
}
