"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Props = {
  diagram: React.ReactNode;
  dataStructure: React.ReactNode;
  maintenance: React.ReactNode;
};

export function FunnelTabs({ diagram, dataStructure, maintenance }: Props) {
  const t = useTranslations("funnel.tabs");

  return (
    <Tabs defaultValue="diagram" className="w-full">
      <TabsList>
        <TabsTrigger value="diagram">{t("diagram")}</TabsTrigger>
        <TabsTrigger value="dataStructure">{t("dataStructure")}</TabsTrigger>
        <TabsTrigger value="maintenance">{t("maintenance")}</TabsTrigger>
      </TabsList>

      <TabsContent value="diagram">{diagram}</TabsContent>
      <TabsContent value="dataStructure">{dataStructure}</TabsContent>
      <TabsContent value="maintenance">{maintenance}</TabsContent>
    </Tabs>
  );
}
