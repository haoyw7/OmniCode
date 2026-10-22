import { MotionPresenceItem } from "./MotionPresenceItem";
import { AnimatePresence, motion } from "motion/react";
import {
  immediateTransition,
  popAnimate,
  popExit,
  popInitial,
  popTransition,
} from "../../motion/tokens";
import { useMotionPreference } from "../../motion/useMotionPreference";
import { MenuHover } from "../MenuHover";
import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";

const DropdownMenuMotionContext = React.createContext(false);

function DropdownMenu({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  return (
    <DropdownMenuMotionContext.Provider value={open}>
      <DropdownMenuPrimitive.Root
        data-slot="dropdownmenu"
        {...props}
        open={open}
        onOpenChange={(next) => {
          if (controlledOpen === undefined) setLocalOpen(next);
          onOpenChange?.(next);
        }}
      />
    </DropdownMenuMotionContext.Provider>
  );
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  );
}

// 圆角规范迁移：旧菜单沿用 xl/lg，统一为独立外壳 lg、内部选项 md；子菜单重新起算。
function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 2,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const open = React.useContext(DropdownMenuMotionContext);
  const reduced = useMotionPreference();
  const presence = (
    <AnimatePresence>
      {open && (
        <MotionPresenceItem key="content">
          <DropdownMenuPrimitive.Content
            forceMount
            asChild
            data-slot="dropdown-menu-content"
            sideOffset={sideOffset}
            align={align}
            className={cn(
              // 共享菜单栈需要行距，且与 tooltip 同层时不能被辅助提示覆盖。
              // 宽度不能用 w-(...) 绑定触发器宽度变量 --radix-dropdown-menu-trigger-width：图标按钮触发器只有
              // ~28px，实际宽度被 min-w-32 卡死在 128px，「恢复 User 默认」等较长菜单项被迫折行，
              // 全仓 40+ 处调用因此各自传 w-*/min-w-* 兜底。菜单不是 Select，宽度应按内容撑开
              // （Radix popper 外层是 min-width:max-content），只保留 min-w-32 下限，并用可用宽度
              // 变量做上限，窄屏 Web 端长文案才回退折行而不是撑出视口。
              "z-[60] flex flex-col gap-0.5 max-h-(--radix-dropdown-menu-content-available-height) max-w-(--radix-dropdown-menu-content-available-width) min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-popover-border panel-menu p-1 text-foreground !shadow-md      data-[state=closed]:overflow-hidden      ",
              className,
            )}
            {...props}
          >
            <motion.div
              initial={reduced ? false : popInitial}
              animate={popAnimate}
              exit={popExit}
              transition={reduced ? immediateTransition : popTransition}
            >
              <div data-menu-gutter>{props.children}</div>
            </motion.div>
          </DropdownMenuPrimitive.Content>
        </MotionPresenceItem>
      )}
    </AnimatePresence>
  );
  return (
    <DropdownMenuPrimitive.Portal forceMount>
      {presence}
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  children,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 py-1 text-ui-base/relaxed text-foreground outline-hidden select-none data-[highlighted]:bg-menu-hover data-[highlighted]:text-foreground data-inset:pl-7.5 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive data-[variant=destructive]:data-[highlighted]:text-destructive-foreground data-disabled:pointer-events-none data-disabled:text-foreground-subtlest data-disabled:opacity-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-current data-[variant=destructive]:data-[highlighted]:*:[svg]:text-destructive-foreground",
        className,
      )}
      {...props}
    >
      {props.asChild ? children : <><MenuHover />{children}</>}
    </DropdownMenuPrimitive.Item>
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
};
