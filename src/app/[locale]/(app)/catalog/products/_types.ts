export type ProductListRow = {
  product_id: number;
  product_name: string;
  slug: string;
  is_active: boolean;
  is_consignment: boolean;
  updated_at: string;
  product_type: { product_type_id: number; type_name: string; type_code: string; kind: string } | null;
  brand: { brand_id: number; brand_name: string } | null;
  product_variant: Array<{
    variant_id: number;
    is_active: boolean;
    product_pricing: Array<{ list_price: string | null; channel: string }>;
  }>;
};

export type ProductDetail = {
  product_id: number;
  product_name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  manufacturer: string | null;
  is_active: boolean;
  is_consignment: boolean;
  track_inventory: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  wazudb1_id: string | null;
  product_type: { product_type_id: number; type_name: string; type_code: string; kind: string } | null;
  brand: { brand_id: number; brand_name: string } | null;
  product_variant: VariantRow[];
  product_attribute_value: AttributeValueRow[];
  product_category_link: Array<{
    id: number;
    is_primary: boolean;
    category: { category_id: number; category_name: string; slug: string } | null;
  }>;
};

export type VariantRow = {
  variant_id: number;
  variant_name: string | null;
  variant_label: string | null;
  sku: string | null;
  barcode: string | null;
  weight_grams: string | null;
  is_active: boolean;
  image_url: string | null;
  product_pricing: Array<{
    pricing_id: number;
    list_price: string | null;
    cost_price: string | null;
    channel: string;
  }>;
};

export type VariantDetail = {
  variant_id: number;
  product_id: number;
  variant_name: string | null;
  variant_label: string | null;
  sku: string | null;
  barcode: string | null;
  upc: string | null;
  weight_grams: string | null;
  is_active: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  product_variant_attribute: Array<{
    attribute_id: number;
    value_id: number | null;
    value_text: string | null;
    value_number: number | null;
    unit_id: number | null;
    product_attribute: { attribute_name: string; attribute_code: string; data_type: string | null } | null;
    product_attribute_option: { value: string } | null;
  }>;
  product_pricing: Array<{
    pricing_id: number;
    channel: string;
    currency: string;
    list_price: string;
    cost_price: string | null;
    is_active: boolean;
    min_quantity: number;
  }>;
};

export type AttributeValueRow = {
  attribute_id: number;
  product_attribute: { attribute_name: string; attribute_code: string } | null;
  value_id: number | null;
  value_text: string | null;
  value_number: number | null;
  product_attribute_option: { value: string } | null;
};

export type CategoryOption = {
  category_id: number;
  category_name: string;
  parent_category_id: number | null;
  level: number;
};

export type ProductTypeOption = {
  product_type_id: number;
  type_name: string;
  type_code: string;
};

export type BrandOption = {
  brand_id: number;
  brand_name: string;
};

// Resolved variant axis after the inheritance walk
export type AxisDef = {
  attribute_id: number;
  attribute_code: string;
  attribute_name: string;
  data_type: string | null;
  dimension: string | null;
  variant_axis_order: number;
  from_category_id: number;
  from_category_name: string;
  options: { value_id: number; value: string }[];
};
