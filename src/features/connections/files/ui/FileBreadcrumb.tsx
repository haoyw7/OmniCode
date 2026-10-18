import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { Button } from "../../../../shared/ui/forms/Button";
import { Popover } from "../../../../shared/ui/Popover";
import { useSurfaceVisibility } from "../../../../shared/ui/SurfaceVisibility";
import { fitFileBreadcrumb, fileBreadcrumbSegments, type FileBreadcrumbLayout, type FileBreadcrumbSegment } from "../model/fileBreadcrumb";
import { FileTree } from "./FileTree";

export function FileBreadcrumb({ path, cwd, onOpenFile, children }: {
  path: string;
  cwd: string;
  onOpenFile?: (path: string) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const nav = useRef<HTMLElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => fileBreadcrumbSegments(path, cwd), [path, cwd]);
  const [layout, setLayout] = useState<FileBreadcrumbLayout>({ headCount: 0, tailStart: 0, showEllipsis: false });
  useLayoutEffect(() => {
    const container = nav.current;
    const ruler = measure.current;
    if (!container || !ruler) return;
    const fit = () => {
      if (!container.clientWidth) return;
      const labels = ruler.querySelectorAll<HTMLElement>("[data-breadcrumb-label]");
      const separator = ruler.querySelector<HTMLElement>("[data-breadcrumb-separator]")!;
      const ellipsis = ruler.querySelector<HTMLElement>("[data-breadcrumb-ellipsis]")!;
      const next = fitFileBreadcrumb(
        segments.map((segment, i) => ({ label: segment.label, width: labels[i].getBoundingClientRect().width })),
        container.clientWidth,
        separator.getBoundingClientRect().width,
        ellipsis.getBoundingClientRect().width,
        parseFloat(getComputedStyle(container).columnGap) || 0,
      );
      setLayout(previous =>
        previous.headCount === next.headCount &&
        previous.tailStart === next.tailStart &&
        previous.showEllipsis === next.showEllipsis ? previous : next,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    observer.observe(ruler);
    return () => observer.disconnect();
  }, [segments]);
  const tailStart = Math.min(layout.tailStart, segments.length - 1);
  const head = Math.min(layout.headCount, tailStart);
  const hidden = segments.slice(head, tailStart);
  const showEllipsis = layout.showEllipsis && hidden.length > 0;
  const shown = [...segments.slice(0, head), ...(showEllipsis ? [{ ...hidden[0], label: "…", selected: "" }] : []), ...segments.slice(tailStart)];
  return <div data-file-label className="desktop-file-breadcrumb">
    <nav ref={nav} aria-label={t("File path")} className="desktop-file-breadcrumb-path">
      {shown.map((segment, index) => <Fragment key={`${path}:${showEllipsis && index === head ? "ellipsis" : segment.path}`}>
        {index > 0 && shown[index - 1].label !== "/" ? <span aria-hidden="true" className="desktop-file-breadcrumb-separator">/</span> : null}
        <BreadcrumbSegment segment={segment} current={index === shown.length - 1} hidden={showEllipsis && index === head ? hidden : undefined} onOpenFile={onOpenFile} />
      </Fragment>)}
    </nav>
    <div ref={measure} aria-hidden="true" className="desktop-file-breadcrumb-measure">
      {segments.map(segment => <span key={segment.path} data-breadcrumb-label>{segment.label}</span>)}
      <span data-breadcrumb-separator>/</span>
      <span data-breadcrumb-ellipsis>…</span>
    </div>
    {children}
  </div>;
}

function BreadcrumbSegment({ segment, current, hidden, onOpenFile }: {
  segment: FileBreadcrumbSegment;
  current: boolean;
  hidden?: FileBreadcrumbSegment[];
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const target = hidden?.at(-1) ?? segment;
  const directory = hidden ? target.path : target.directory;
  const selected = current ? target.selected : directory;
  const label = hidden ? t("Hidden folders") : segment.label;
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);
  return <div className={`desktop-file-breadcrumb-segment${current ? " desktop-file-breadcrumb-current" : ""}`}>
    <Button
      ref={trigger}
      variant="ghost"
      size="sm"
      data-breadcrumb-trigger
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={!onOpenFile || !visible}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
      }}
    >
      <span aria-current={current ? "page" : undefined} title={hidden ? hidden.map(item => item.path).join("\n") : segment.path}>{segment.label}</span>
    </Button>
    <Popover
      open={open && visible}
      anchor={trigger}
      width={360}
      maxHeight={480}
      role="dialog"
      aria-label={t("{value0} files", { value0: label })}
      className="desktop-file-breadcrumb-menu"
      onDismiss={reason => {
        setOpen(false);
        if (reason === "escape") trigger.current?.focus({ preventScroll: true });
      }}
    >
      <FileTree
        key={directory}
        cwd={directory}
        compact
        navigationOnly
        activePath={selected}
        onOpenFile={path => {
          setOpen(false);
          onOpenFile?.(path);
        }}
      />
    </Popover>
  </div>;
}
