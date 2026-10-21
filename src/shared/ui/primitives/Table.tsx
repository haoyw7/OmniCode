import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

function Table({
  className,
  containerProps,
  ...props
}: ComponentProps<"table"> & {
  containerProps?: ComponentProps<"div">;
}) {
  return (
    <div
      {...containerProps}
      data-ui="table-container"
      data-slot="table-container"
      className={cn(
        "relative w-full overflow-x-auto",
        containerProps?.className,
      )}
    >
      <table
        data-ui="table"
        data-slot="table"
        className={cn("w-full caption-bottom text-ui-base", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      data-ui="table-header"
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody
      data-ui="table-body"
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-ui="table-footer"
      data-slot="table-footer"
      className={cn(
        "border-t border-border bg-hover font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      data-ui="table-row"
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors hover:bg-hover has-aria-expanded:bg-hover data-[state=selected]:bg-selection motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      data-ui="table-head"
      data-slot="table-head"
      scope="col"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      data-ui="table-cell"
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return (
    <caption
      data-ui="table-caption"
      data-slot="table-caption"
      className={cn("mt-4 text-ui-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
