import type { SVGProps } from "react";
import { cn } from "../../lib/cn";
import { usePauseOffscreenAnimation } from "../../hooks/usePauseOffscreenAnimation";
import { OMI_ARTWORK, type OmiExpression } from "./omiArtwork";
import "./omi.css";

type Props = Omit<SVGProps<SVGSVGElement>, "children" | "ref" | "dangerouslySetInnerHTML"> & {
  expression?: OmiExpression;
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
export function Omi({ expression = "ready", animated = false, compact = false, className, ...props }: Props) {
  const pauseOffscreen = usePauseOffscreenAnimation<SVGSVGElement>();
  const artwork = OMI_ARTWORK[expression];
  return (
    <svg
      aria-hidden={props["aria-label"] ? undefined : true}
      role={props["aria-label"] ? "img" : undefined}
      {...props}
      ref={animated ? pauseOffscreen : undefined}
      data-ui="omi"
      data-expression={expression}
      data-animated={animated || undefined}
      viewBox={compact ? "32 32 256 256" : "0 0 320 320"}
      className={cn(artwork.className, className)}
      // Only generated, repository-owned SVG paths. No user/provider markup.
      dangerouslySetInnerHTML={markupProp(compact ? artwork.compactMarkup : artwork.markup)}
    />
  );
}
