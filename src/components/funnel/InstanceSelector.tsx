"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FunnelInstanceListItem } from "@/lib/funnel/queries";

type Props = {
  instances: FunnelInstanceListItem[];
  selectedSlug: string;
};

/**
 * Dropdown for switching between visible funnel_instances. Templates
 * (instance_id = 0) are grouped under a "Plantillas" label so users
 * can tell their own scenarios apart from the read-only benchmarks.
 *
 * Selecting an option navigates to /funnel/<slug>. We use the locale-aware
 * router so URL switching respects the current locale prefix rules.
 */
export function InstanceSelector({ instances, selectedSlug }: Props) {
  const router = useRouter();
  const t = useTranslations("funnel.instanceSelector");

  const owned = instances.filter((i) => i.instance_id !== 0);
  const templates = instances.filter((i) => i.instance_id === 0);

  function handleChange(slug: string) {
    if (slug === selectedSlug) return;
    router.push(`/funnel/${slug}`);
  }

  return (
    <Select value={selectedSlug} onValueChange={handleChange}>
      <SelectTrigger style={{ minWidth: 280 }}>
        <SelectValue placeholder={t("placeholder")} />
      </SelectTrigger>
      <SelectContent>
        {owned.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("ownGroup")}</SelectLabel>
            {owned.map((instance) => (
              <SelectItem key={instance.slug} value={instance.slug}>
                {instance.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {templates.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("templateGroup")}</SelectLabel>
            {templates.map((instance) => (
              <SelectItem key={instance.slug} value={instance.slug}>
                {instance.name}
                {instance.industry ? ` · ${instance.industry}` : ""}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
