/**
 * Shared types for the Prospectos diagnostic runner.
 *
 * The runner reads active checks from `diagnostic_check`, dispatches each
 * to a scorer function based on `check_code`, and writes `finding` rows.
 * Checks without a registered scorer are skipped with result_status='na'
 * — this matches the "DB is the source of truth" pattern: rows can exist
 * in the catalog before code lands, they just won't score until they do.
 */

import type { PdpSignals, SiteSignals } from "@/lib/glpim";
import type { BrowserProbeResult } from "./browser-probe";

export type FindingStatus = "pass" | "fail" | "partial" | "na" | "error";

export type Evidence = Record<string, unknown>;

export type ScoringResult = {
  result_status: FindingStatus;
  score: number | null;
  evidence: Evidence;
  notes?: string | null;
};

export type SiteWideContext = {
  rootUrl: string;
  llmsTxt: { present: boolean; status: number | null; bodyExcerpt: string | null };
  robotsTxt: { present: boolean; status: number | null; bodyExcerpt: string | null; aiBotPolicy: "allow" | "block" | "unmentioned" };
  sitemap: { present: boolean; status: number | null; urlCount: number | null };
};

export type PdpContext = {
  url: string;
  signals: PdpSignals | null;
  fetchError: string | null;
};

export type SiteSignalsContext = {
  signals: SiteSignals | null;
  fetchError: string | null;
};

export type BrowserContext = {
  probe: BrowserProbeResult | null;
  enabled: boolean;
};

export type RunContext = {
  site: SiteWideContext;
  pdp: PdpContext;
  siteSignals: SiteSignalsContext;
  browser: BrowserContext;
};

export type CheckScorer = (ctx: RunContext) => ScoringResult;
