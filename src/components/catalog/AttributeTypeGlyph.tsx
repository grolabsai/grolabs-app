/**
 * AttributeTypeGlyph — small visual indicator of an attribute's data_type.
 *
 * Maps schema data_type values to a colored 22px square with an icon.
 * Multivalor lists get a denser variant of the list glyph.
 *
 * Icons are intentionally simple (1.5px stroke, currentColor) so the
 * color comes from the parent's CSS class. The legend is documented in
 * Notion under Scout > UI > Attribute glyphs.
 */

export type AttributeDataType =
  | "list"
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "single_ref";

export function AttributeTypeGlyph({
  dataType,
  isMultivalue,
  size = 22,
}: {
  dataType: string | null | undefined;
  isMultivalue?: boolean;
  size?: number;
}) {
  const cls = glyphClass(dataType, isMultivalue);
  const iconSize = Math.round(size * 0.55);

  return (
    <span
      className={`s-type-glyph ${cls}`}
      style={{ width: size, height: size }}
      aria-label={ariaLabel(dataType, isMultivalue)}
      title={ariaLabel(dataType, isMultivalue)}
    >
      {renderIcon(dataType, isMultivalue, iconSize)}
    </span>
  );
}

function glyphClass(dataType?: string | null, multi?: boolean): string {
  switch (dataType) {
    case "list":
      return multi ? "list-multi" : "list";
    case "number":
      return "num";
    case "text":
      return "text-t";
    case "boolean":
      return "bool";
    case "date":
      return "date";
    case "single_ref":
      return "ref";
    default:
      return "";
  }
}

function ariaLabel(dataType?: string | null, multi?: boolean): string {
  switch (dataType) {
    case "list":
      return multi ? "Lista (multivalor)" : "Lista (selección única)";
    case "number":
      return "Número";
    case "text":
      return "Texto";
    case "boolean":
      return "Sí / No";
    case "date":
      return "Fecha";
    case "single_ref":
      return "Referencia";
    default:
      return "Tipo desconocido";
  }
}

function renderIcon(
  dataType?: string | null,
  multi?: boolean,
  size: number = 12,
): React.ReactNode {
  const stroke = "currentColor";
  const sw = "1.5";

  switch (dataType) {
    case "list":
      // Three rows; the multivalor variant fills all three bullets
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        >
          <path d="M6 4h7M6 8h7M6 12h7" />
          <circle cx="3" cy="4" r="1" fill="currentColor" />
          {multi ? (
            <>
              <circle cx="3" cy="8" r="1" fill="currentColor" />
              <circle cx="3" cy="12" r="1" fill="currentColor" />
            </>
          ) : (
            <>
              <circle cx="3" cy="8" r="1" />
              <circle cx="3" cy="12" r="1" />
            </>
          )}
        </svg>
      );
    case "number":
      return <span style={{ fontWeight: 700 }}>#</span>;
    case "text":
      return <span style={{ fontWeight: 700 }}>T</span>;
    case "boolean":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        >
          <rect x="2" y="5" width="12" height="6" rx="3" />
          <circle cx="11" cy="8" r="2" fill="currentColor" />
        </svg>
      );
    case "date":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        >
          <rect x="2" y="3" width="12" height="11" rx="1" />
          <path d="M2 6h12M5 1v3M11 1v3" />
        </svg>
      );
    case "single_ref":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        >
          <path d="M3 8l10 0M9 4l4 4-4 4" />
        </svg>
      );
    default:
      return <span>?</span>;
  }
}
