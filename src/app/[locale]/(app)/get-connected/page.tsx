import { promises as fs } from "fs";
import path from "path";
import { getTranslations } from "next-intl/server";
import { GetConnectedClient } from "./_client";

/**
 * Get connected — the merchant-facing implementation guide.
 *
 * Content is repo markdown under docs/guides/implementation/ (source of
 * truth; edits ship with a normal git push — no CMS). The page's one job is
 * the platform decision: WordPress vs proprietary e-commerce. Everything
 * after the choice renders only the chosen track, per the guide's design —
 * a merchant should never read the other platform's instructions.
 *
 * The live onboarding checklist (per-step status + verify buttons) is a
 * planned follow-up (M3) — this page is deliberately just the guide.
 */

export const dynamic = "force-dynamic";

async function readGuide(name: string): Promise<string> {
  const file = path.join(process.cwd(), "docs", "guides", "implementation", name);
  return fs.readFile(file, "utf8");
}

export default async function GetConnectedPage() {
  const t = await getTranslations("getConnected");
  const [intro, wordpress, proprietary] = await Promise.all([
    readGuide("README.md"),
    readGuide("wordpress.md"),
    readGuide("proprietary.md"),
  ]);

  return (
    <div className="s-content" style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>{t("title")}</h1>
      <p style={{ fontSize: 13, color: "var(--gl-text-secondary)", marginBottom: 20 }}>
        {t("subtitle")}
      </p>
      <GetConnectedClient intro={intro} wordpress={wordpress} proprietary={proprietary} />
    </div>
  );
}
