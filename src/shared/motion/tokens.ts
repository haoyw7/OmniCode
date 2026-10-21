import type { Transition } from "motion/react";

export const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const duration = { msg: 0.18, pop: 0.2, panel: 0.24, collapse: 0.2 } as const;
export const msgTransition = { duration: duration.msg, ease } satisfies Transition;
export const popTransition = { duration: duration.pop, ease } satisfies Transition;
export const panelTransition = { duration: duration.panel, ease } satisfies Transition;
export const collapseTransition = { duration: duration.collapse, ease } satisfies Transition;
export const defaultTransition = panelTransition;
export const immediateTransition = { duration: 0 } satisfies Transition;
export const springs = {
  sheet: { type: "spring", stiffness: 400, damping: 38 },
  drawer: { type: "spring", stiffness: 380, damping: 36 },
  press: { type: "spring", stiffness: 600, damping: 30 },
} as const satisfies Record<string, Transition>;
export const motionDistance = { pop: 8, page: 32, msg: 8 } as const;
export const motionGeometry = {
  outlineBarWidth: 11, outlineBarLiftedWidth: 24, outlineBarOpacityIdle: 0.15, outlineBarOpacityLit: 0.85,
  sendKickStart: 0.92, sendKickPeak: 1.04,
  switchTravel: 14, switchSmallTravel: 12,
  pageSubtle: 10, pageHomePercent: 30, pageSlidePercent: 100,
  disclosureAngle: 90, flipAngle: 180,
  toggleTravel: 16, toggleCompactTravel: 12, selectAngle: 180, copyCheckScale: 0.65, copyHiddenScale: 0.55, copyTilt: 12,
  linkedPanelPercent: 100, clockPercent: 100,
  headerOpacity: 0.4, popScale: 0.97, dialogScale: 0.96,
  sheetExitGap: 24,
  mobileSwitchTravel: 20,
} as const;
export const popInitial = { opacity: 0, y: motionDistance.pop, scale: motionGeometry.popScale };
export const popAnimate = { opacity: 1, y: 0, scale: 1 };
export const popExit = popInitial;

export const msgInitial = { opacity: 0, y: motionDistance.msg };
export const msgAnimate = { opacity: 1, y: 0 };
export const msgExit = { opacity: 0, y: -motionDistance.msg };

export const outlineRippleStep = duration.msg / 10;
