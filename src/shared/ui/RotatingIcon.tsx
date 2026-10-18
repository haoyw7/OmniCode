import { motion, type MotionProps } from "motion/react";
import type { ComponentType } from "react";
import type { IconComponent, IconProps as ChromeIconProps } from "./icons";
import { panelTransition, immediateTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
type IconProps = Omit<ChromeIconProps, keyof MotionProps> & MotionProps;
const icons = new Map<IconComponent, ComponentType<IconProps>>();
/** Preserve the original SVG and accessibility props while Motion rotates it. */
export function RotatingIcon({ icon, angle, ...props }: Omit<ChromeIconProps, keyof MotionProps> & { icon: IconComponent; angle: number }) {
  const reduced = useMotionPreference();
  let Icon = icons.get(icon);
  if (!Icon) { Icon = motion.create(icon) as ComponentType<IconProps>; icons.set(icon, Icon); }
  return <Icon {...props} initial={false} animate={{ rotate: angle }} transition={reduced ? immediateTransition : panelTransition} />;
}
