import type { SVGProps } from "react";
import { cn } from "../../lib/cn";
import { usePauseOffscreenAnimation } from "../../hooks/usePauseOffscreenAnimation";
import { OMI_ARTWORK, OMI_SHAPES, type OmiExpression, type OmiShape } from "./omiArtwork";
import "./omi.css";

type Props = Omit<SVGProps<SVGSVGElement>, "children" | "ref" | "dangerouslySetInnerHTML"> & {
  expression?: OmiExpression;
  shape?: OmiShape;
  variant?: "outline" | "filled";
  animated?: boolean;
  compact?: boolean;
};

// React rewrites innerHTML whenever this prop object changes, which replaces
// the artwork and restarts its animation on every parent render (a ticking
// live footer blinks once a second). Reuse one object per markup.
const innerHtml = new Map<string, { __html: string }>();
function markupProp(markup: string) {
  let prop = innerHtml.get(markup);
  if (!prop) innerHtml.set(markup, (prop = { __html: markup }));
  return prop;
}

/** Presentation-only artwork; consumers own status, project identity and color. */
export function Omi({ expression = "ready", shape = "original", variant = "outline", animated = false, compact = false, className, ...props }: Props) {
  const pauseOffscreen = usePauseOffscreenAnimation<SVGSVGElement>();
  const artwork = OMI_ARTWORK[expression];
  const contour = OMI_SHAPES[shape];
  let markup = (compact ? artwork.compactMarkup : artwork.markup).replace(OMI_SHAPES.original.outline, contour.outline);
  let face: string = artwork.faceMarkup;
  if (variant === "filled") {
    // Fill implicitly closes the interior; the open stroke retains Omi's notch.
    markup = markup.replace(/<path\b[^>]*>/, path => path.replace('fill="none"', 'fill="currentColor"'));
    const ink = "var(--omi-face-color, var(--color-omi-face))";
    face = face.replace("<g ", `<g fill="${ink}" stroke="${ink}" `);
  }
  if (contour.faceTransform) face = `<g transform="${contour.faceTransform}">${face}</g>`;
  markup = markup.replace(artwork.faceMarkup, face);
  return (
    <svg
      aria-hidden={props["aria-label"] ? undefined : true}
      role={props["aria-label"] ? "img" : undefined}
      {...props}
      ref={animated ? pauseOffscreen : undefined}
      data-ui="omi"
      data-expression={expression}
      data-shape={shape}
      data-variant={variant}
      data-animated={animated || undefined}
      viewBox={compact ? shape === "original" ? "32 32 256 256" : "24 24 272 272" : "0 0 320 320"}
      className={cn(artwork.className, className)}
      // Only generated, repository-owned SVG paths. No user/provider markup.
      dangerouslySetInnerHTML={markupProp(markup)}
    />
  );
}
