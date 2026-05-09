export type AttributeRow = {
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  description: string | null;
  parsing_hint: string | null;
  data_type: string | null;
  dimension: string | null;
  is_multivalue: boolean;
  is_filterable: boolean;
  is_searchable: boolean;
  is_active: boolean;
};

export type OptionRow = {
  value_id: number;
  value: string;
  value_code: string | null;
  sort_order: number | null;
  is_active: boolean;
};
