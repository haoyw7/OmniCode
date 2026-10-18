import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { DisclosureChevron } from "./DisclosureChevron";

/** Follow the native details element without replacing its toggle behavior. */
export function DetailsChevron(props: Omit<ComponentProps<typeof DisclosureChevron>, "expanded">) {
  const ref = useRef<SVGSVGElement>(null);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const details = ref.current?.closest("details");
    if (!details) return;
    const update = () => setExpanded(details.open);
    update();
    const observer = new MutationObserver(update);
    observer.observe(details, { attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  return <DisclosureChevron {...props} ref={ref} expanded={expanded} />;
}
