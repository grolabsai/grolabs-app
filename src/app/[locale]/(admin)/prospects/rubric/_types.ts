export type DiagnosticStageRow = {
  diagnostic_stage_id: number;
  stage_code: string;
  stage_name: string;
  description: string | null;
  sort_order: number;
};

export type ProbeType = "search" | "pdp" | "site_wide" | "homepage" | "category";
export type ConfidenceLevel = "low" | "medium" | "high";
export type EffortLevel = "low" | "medium" | "high";
export type ImpactLevel = "low" | "medium" | "high";

export type DiagnosticCheckRow = {
  diagnostic_check_id: number;
  instance_id: number;
  check_code: string;
  check_name: string;
  description: string | null;
  diagnostic_stage_id: number;
  probe_type: ProbeType;
  weight: number;
  revenue_lever: string | null;
  default_delta_rate: number | null;
  default_confidence: ConfidenceLevel;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type FixRecommendationRow = {
  fix_recommendation_id: number;
  instance_id: number;
  diagnostic_check_id: number;
  fix_code: string;
  fix_title: string;
  fix_body_md: string;
  trigger_condition: Record<string, unknown>;
  effort: EffortLevel;
  impact: ImpactLevel;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
