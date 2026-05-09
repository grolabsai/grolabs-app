"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Upload } from "lucide-react";
import { PriceListImportDialog } from "@/components/pricing/PriceListImportDialog";

/**
 * Client-side trigger for the price-list import wizard. Lives separately
 * from the server-rendered Pricing Overview so the page can stay async/RSC
 * while the dialog state stays on the client.
 *
 * The variant prop lets the caller swap between the header button and the
 * empty-state CTA without duplicating the dialog wiring.
 */
export function ImportListButton({
  variant = "default",
}: {
  variant?: "default" | "outline";
}) {
  const t = useTranslations("pricing.actions");
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Icon icon={Upload} size={16} strokeWidth={2} />
        <span style={{ marginLeft: 8 }}>{t("importList")}</span>
      </Button>
      <PriceListImportDialog
        open={open}
        onOpenChange={setOpen}
        onImported={() => router.refresh()}
      />
    </>
  );
}
