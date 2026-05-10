"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchToInstance } from "@/lib/actions/instance";
import { CreateInstanceDialog } from "./CreateInstanceDialog";

export type InstanceListItem = {
  instanceId: number;
  name: string;
  isCurrent: boolean;
};

/**
 * Topbar instance switcher. Lists every active membership the user has, marks
 * the current one with a checkmark, and exposes a "+ Nueva instancia" entry
 * that opens the creation dialog. Per docs/policy/instance-management.md §5.
 *
 * Switching and creation both call server actions which revalidate the layout;
 * a local router.refresh() reconciles client state on the same tick.
 */
export function InstanceSwitcher({
  instances,
  currentInstanceId,
}: {
  instances: InstanceListItem[];
  currentInstanceId: number | null;
}) {
  const t = useTranslations("shell.instanceSwitcher");
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const current =
    instances.find((i) => i.instanceId === currentInstanceId) ?? null;
  const triggerLabel = current?.name ?? t("noInstance");

  function handleSwitch(instanceId: number) {
    if (instanceId === currentInstanceId) {
      setMenuOpen(false);
      return;
    }
    setPendingId(instanceId);
    setMenuOpen(false);
    startTransition(async () => {
      const result = await switchToInstance(instanceId);
      setPendingId(null);
      if (!result.ok) {
        toast.error(t("switchFailed"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("triggerLabel")}
            className="inline-flex items-center gap-1.5 rounded-[var(--s-radius-md)] px-2 py-1 text-[13px] hover:bg-[var(--s-surface-alt)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--s-border-strong)]"
            style={{ color: "var(--s-text)" }}
          >
            <span className="truncate max-w-[200px]">
              {pendingId !== null ? t("switching") : triggerLabel}
            </span>
            <Icon icon={ChevronDown} size={12} />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="min-w-[220px]"
          style={{
            background: "var(--s-surface)",
            border: "0.5px solid var(--s-border)",
            borderRadius: "var(--s-radius-md)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
        >
          {instances.map((inst) => {
            const isCurrent = inst.instanceId === currentInstanceId;
            return (
              <DropdownMenuItem
                key={inst.instanceId}
                onSelect={(e) => {
                  e.preventDefault();
                  handleSwitch(inst.instanceId);
                }}
                className="cursor-pointer text-[13px] gap-2"
                style={{ color: "var(--s-text)" }}
              >
                <span className="flex h-3 w-3 items-center justify-center">
                  {isCurrent ? <Icon icon={Check} size={12} /> : null}
                </span>
                <span className="flex-1 truncate">{inst.name}</span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              setCreateOpen(true);
            }}
            className="cursor-pointer text-[13px] gap-2"
            style={{ color: "var(--s-text-secondary)" }}
          >
            <Icon icon={Plus} size={12} />
            {t("createEntry")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateInstanceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
