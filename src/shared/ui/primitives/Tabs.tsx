import { AnimatePresence, motion } from "motion/react";
import {
  panelTransition,
  immediateTransition,
  popInitial,
  popAnimate,
  popExit,
} from "../../motion/tokens";
import { useMotionPreference } from "../../motion/useMotionPreference";
import { MotionPresenceItem } from "./MotionPresenceItem";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";

const TabsMotionContext = React.createContext({ value: "", scope: "", animated: true });

function Tabs({
  className,
  orientation = "horizontal",
  value: controlledValue,
  defaultValue = "",
  onValueChange,
  animated = true,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & {
  /** Switches the indicator and panel instantly when false. */
  animated?: boolean;
}) {
  const [localValue, setLocalValue] = React.useState(defaultValue);
  const value = controlledValue ?? localValue;
  const scope = React.useId();
  return (
    <TabsMotionContext.Provider value={{ value, scope, animated }}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        className={cn("group/tabs flex data-horizontal:flex-col", className)}
        {...props}
        value={value}
        onValueChange={(next) => {
          if (controlledValue === undefined) setLocalValue(next);
          onValueChange?.(next);
        }}
      />
    </TabsMotionContext.Provider>
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const { value, scope, animated } = React.useContext(TabsMotionContext);
  const reduced = useMotionPreference() || !animated;
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-ui-base font-medium whitespace-nowrap text-foreground/60 transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:py-[calc(--spacing(1.25))] hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0  group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className,
      )}
      {...props}
    >
      {value === props.value && (
        <motion.span
          layoutId={animated ? scope : undefined}
          initial={false}
          transition={reduced ? immediateTransition : panelTransition}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] bg-background group-data-[variant=line]/tabs-list:inset-x-0 group-data-[variant=line]/tabs-list:top-auto group-data-[variant=line]/tabs-list:bottom-[-5px] group-data-[variant=line]/tabs-list:h-0.5 group-data-[variant=line]/tabs-list:bg-foreground"
        />
      )}
      <span className="relative flex items-center gap-[inherit]">
        {children}
      </span>
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  const { value, animated } = React.useContext(TabsMotionContext);
  const reduced = useMotionPreference();
  if (!animated)
    return (
      <TabsPrimitive.Content
        {...props}
        data-slot="tabs-content"
        className={cn("flex-1 text-ui-base outline-none", className)}
      >
        {children}
      </TabsPrimitive.Content>
    );
  const content = value === props.value && (
    <MotionPresenceItem key={props.value}>
      <TabsPrimitive.Content
        {...props}
        forceMount
        asChild
        data-slot="tabs-content"
        className={cn("flex-1 text-ui-base outline-none", className)}
      >
        <motion.div
          layout="position"
          initial={reduced ? false : popInitial}
          animate={popAnimate}
          exit={popExit}
          transition={reduced ? immediateTransition : panelTransition}
        >
          {children}
        </motion.div>
      </TabsPrimitive.Content>
    </MotionPresenceItem>
  );
  return <AnimatePresence>{content}</AnimatePresence>;
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
