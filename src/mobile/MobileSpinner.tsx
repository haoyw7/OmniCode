import { usePauseOffscreenAnimation } from "../shared/hooks/usePauseOffscreenAnimation";
import { LoaderCircle, type IconProps } from "../shared/ui/icons";

/** Only the loop pauses; its page and overlay can still finish their exit. */
export function MobileSpinner(props: IconProps) {
  const ref = usePauseOffscreenAnimation<SVGSVGElement>();
  return <LoaderCircle {...props} ref={ref} />;
}
