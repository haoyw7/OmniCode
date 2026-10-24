import { Folder, type IconComponent } from "./icons";

/** Presentation only; the project feature resolves and refreshes local URLs. */
export function ProjectLogoIcon({
  src,
  className = "size-3.5 shrink-0",
  imageClassName,
  fallback: Fallback = Folder,
  fallbackStrokeWidth = 1.5,
}: {
  src?: string | null;
  className?: string;
  imageClassName?: string;
  fallback?: IconComponent;
  fallbackStrokeWidth?: number;
}) {
  if (src) {
    return (
      <img
        key={src}
        src={src}
        alt=""
        className={`rounded-sm object-cover ${className} ${imageClassName ?? ""}`}
      />
    );
  }
  return <Fallback className={className} strokeWidth={fallbackStrokeWidth} />;
}
