import type { LucideIcon, LucideProps } from "lucide-react";

type IconProps = LucideProps & {
  icon: LucideIcon;
};

export function Icon({
  icon: IconComponent,
  size = 16,
  strokeWidth = 1.5,
  ...props
}: IconProps) {
  return <IconComponent size={size} strokeWidth={strokeWidth} {...props} />;
}
