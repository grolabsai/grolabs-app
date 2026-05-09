"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { syncBatchToWoocommerce } from "@/lib/actions/pricing";

/**
 * Triggers the WooCommerce push for a single ready batch.
 *
 * The button stays disabled while the action runs. Toast surfaces both
 * the per-row breakdown and the final batch state (synced vs. back to
 * ready when there were partial failures).
 */
export function SyncBatchButton({
  batchId,
  size = "sm",
  variant = "default",
}: {
  batchId: number;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "outline";
}) {
  const t = useTranslations("pricing.syncPage");
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      const res = await syncBatchToWoocommerce(batchId);
      if (!res.ok) {
        toast.error(t("toast.error"), { description: res.error });
        return;
      }
      const r = res.result;
      if (r.failedCount === 0) {
        toast.success(
          t("toast.allOk", { n: r.succeededCount }),
        );
      } else if (r.succeededCount === 0) {
        toast.error(
          t("toast.allFailed", { n: r.failedCount }),
        );
      } else {
        toast.warning(
          t("toast.partial", { ok: r.succeededCount, fail: r.failedCount }),
        );
      }
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={onClick}
      disabled={pending}
    >
      <Icon icon={ShoppingBag} size={14} strokeWidth={2} />
      <span style={{ marginLeft: 6 }}>
        {pending ? t("button.syncing") : t("button.sync")}
      </span>
    </Button>
  );
}
