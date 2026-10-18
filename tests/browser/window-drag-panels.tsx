import { useRef, useState } from "react";
import { Popover } from "../../src/shared/ui/Popover";
import { Modal } from "../../src/shared/ui/Modal";
import { ImageLightbox } from "../../src/shared/ui/ImageLightbox";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { MenuPanel } from "../../src/shared/ui/primitives/MenuPanel";
import * as RadixPopover from "../../src/shared/ui/primitives/Popover";
import * as Dropdown from "../../src/shared/ui/primitives/DropdownMenu";
import * as Select from "../../src/shared/ui/forms/Select";
import { AppViewDialog } from "../../src/features/workspace/ui/AppViewDialog";
import { QuickOpen } from "../../src/features/search/ui/QuickOpen";
import { SwitchBranchDialog } from "../../src/features/source-control/ui/SwitchBranchDialog";
import { RemoveProjectDialog } from "../../src/features/projects/ui/RemoveProjectDialog";
import { BotMemoryDialog } from "../../src/features/bots/ui/BotMemoryDialog";
import { AddRemoteProjectDialog } from "../../src/features/connections/ui/AddRemoteProjectDialog";

/** Actual shared surfaces and independent backdrop implementations, with inert data. */
export function PanelExample({ kind, topInset }: { kind: string; topInset: number }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("one");
  const anchor = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  const trigger = <button ref={anchor} onClick={() => setOpen(true)}>Open panel</button>;
  const content = <div data-check-panel><input aria-label="Panel input" /></div>;
  const options = [{ value: "one", label: "One" }, { value: "two", label: "Two" }];
  if (kind === "searchable") return <SearchableSelect label="Open panel" value={value} options={options} onChange={setValue} />;
  if (kind === "select") return (
    <Select.Select open={open} onOpenChange={setOpen} value={value} onValueChange={setValue}>
      <Select.SelectTrigger aria-label="Open panel"><Select.SelectValue /></Select.SelectTrigger>
      <Select.SelectContent position="popper">
        {options.map((option) => <Select.SelectItem key={option.value} value={option.value}>{option.label}</Select.SelectItem>)}
      </Select.SelectContent>
    </Select.Select>
  );
  if (kind === "radix-popover") return (
    <RadixPopover.Popover open={open} onOpenChange={setOpen}>
      <RadixPopover.PopoverTrigger asChild>{trigger}</RadixPopover.PopoverTrigger>
      <RadixPopover.PopoverContent>{content}</RadixPopover.PopoverContent>
    </RadixPopover.Popover>
  );
  if (kind === "dropdown") return (
    <Dropdown.DropdownMenu open={open} onOpenChange={setOpen}>
      <Dropdown.DropdownMenuTrigger asChild><button>Open panel</button></Dropdown.DropdownMenuTrigger>
      <Dropdown.DropdownMenuContent>
        <Dropdown.DropdownMenuItem onSelect={close}>Choose option</Dropdown.DropdownMenuItem>
      </Dropdown.DropdownMenuContent>
    </Dropdown.DropdownMenu>
  );
  return <>{trigger}{open && (
    kind === "popover" ? <Popover anchor={anchor} onDismiss={close}>{content}</Popover>
      : kind === "menu" ? <MenuPanel anchor={anchor} onDismiss={close} autoFocus tabIndex={-1}>{content}</MenuPanel>
      : kind === "modal" ? <Modal title="Panel" onClose={close}>{content}</Modal>
      : kind === "nested" ? <Modal title="Parent panel" onClose={close}><SearchableSelect label="Nested options" value={value} options={options} onChange={setValue} /></Modal>
      : kind === "app-dialog" ? <AppViewDialog title="Settings panel" onClose={close} topInset={topInset}>{content}</AppViewDialog>
      : kind === "lightbox" ? <ImageLightbox alt="Preview" onClose={close} src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='blue'/%3E%3C/svg%3E" />
      : kind === "quick-open" ? <QuickOpen open cwd="" initialQuery=">" onOpenFile={() => {}} onRunCommand={() => {}} onClose={close} />
      : kind === "switch-branch" ? <SwitchBranchDialog cwd="" branch="example" busy={null} onCancel={close} onCommit={() => {}} onStash={() => {}} />
      : kind === "remove-project" ? <RemoveProjectDialog name="Example" path="/example" onCancel={close} onConfirm={() => {}} />
      : kind === "remote-project" ? <AddRemoteProjectDialog onCancel={close} onOpen={close} />
      : kind === "bot-memory" ? <BotMemoryDialog open text="Remember this fact" meta="Example" busy={false} onClose={close} onSave={() => {}} onForget={() => {}} />
      : null
  )}</>;
}
