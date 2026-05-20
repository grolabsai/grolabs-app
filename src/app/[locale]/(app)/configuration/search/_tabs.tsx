"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Props = {
  configuration: ReactNode;
  analytics: ReactNode;
  emulator: ReactNode;
};

/**
 * Per docs/policy/search-foundations.md §17. Three-tab restructure of
 * /configuration/search. Server-rendered children stay server-rendered;
 * this wrapper only owns the active-tab state.
 *
 * `forceMount` is set on each `TabsContent` so the inactive panes keep
 * their client-state (analytics blocks' polling intervals, emulator
 * filters) across tab switches instead of re-mounting from scratch. The
 * hidden attribute hides inactive panes from layout + the a11y tree.
 */
export function SearchConfigTabs({ configuration, analytics, emulator }: Props) {
  const t = useTranslations("configuration.search.tabs");

  return (
    <Tabs defaultValue="configuration" className="flex flex-col gap-4">
      <TabsList className="self-start">
        <TabsTrigger value="configuration">{t("configuration")}</TabsTrigger>
        <TabsTrigger value="analytics">{t("analytics")}</TabsTrigger>
        <TabsTrigger value="emulator">{t("emulator")}</TabsTrigger>
      </TabsList>

      <TabsContent value="configuration" forceMount className="data-[state=inactive]:hidden">
        {configuration}
      </TabsContent>
      <TabsContent value="analytics" forceMount className="data-[state=inactive]:hidden">
        {analytics}
      </TabsContent>
      <TabsContent value="emulator" forceMount className="data-[state=inactive]:hidden">
        {emulator}
      </TabsContent>
    </Tabs>
  );
}
