"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/routing";
import { Icon } from "@/components/ui/icon";
import { Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { createProduct } from "@/lib/actions/product";

/**
 * "+ Nuevo producto" trigger + the drawer it opens.
 *
 * Lives on /catalog/products. Slides in from the right (shadcn Sheet's
 * default), exposes a single name field, and on Crear navigates to
 * /catalog/products/[new id] for the rest of the editing.
 */
export function NewProductDrawer() {
  const t = useTranslations("product");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const r = await createProduct({ name: trimmed });
      if ("error" in r) {
        toast.error(t("create.error"), { description: r.error });
        return;
      }
      toast.success(t("create.success"));
      setName("");
      setOpen(false);
      router.push(`/catalog/products/${r.productId}`);
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <>
      <button
        className="s-btn s-btn-primary"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Icon icon={Plus} size={12} />
        {t("list.newProduct")}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col" style={{ maxWidth: 420 }}>
          <SheetHeader>
            <SheetTitle>{t("create.title")}</SheetTitle>
            <SheetDescription>{t("create.subhead")}</SheetDescription>
          </SheetHeader>

          <div style={{ marginTop: 24 }}>
            <FloatingLabelInput
              id="new-product-name"
              label={t("create.nameLabel")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKey}
              autoFocus
              disabled={pending}
            />
          </div>

          <SheetFooter style={{ marginTop: "auto", display: "flex", gap: 8 }}>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("create.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={pending || !name.trim()}
            >
              {t("create.submit")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
