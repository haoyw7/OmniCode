import { motion } from "motion/react";
import type { ComponentProps } from "react";
import { immediateTransition, motionGeometry, collapseTransition } from "../motion/tokens";
import { useMotionPreference } from "../motion/useMotionPreference";
import { ChevronDown, ChevronRight } from "./icons";

const MotionChevron = motion.create(ChevronRight);
const MotionChevronDown = motion.create(ChevronDown);

export function DisclosureChevron({ expanded, direction = "right", ...props }: ComponentProps<typeof ChevronRight> & { expanded: boolean; direction?: "right" | "down" }) {
  const reduced = useMotionPreference();
  const Icon = direction === "down" ? MotionChevronDown : MotionChevron;
  return <Icon {...props as ComponentProps<typeof MotionChevron>} data-expanded={expanded || undefined} initial={false} animate={{ rotate: expanded ? (direction === "down" ? motionGeometry.selectAngle : motionGeometry.disclosureAngle) : 0 }} transition={reduced ? immediateTransition : collapseTransition} />;
}
