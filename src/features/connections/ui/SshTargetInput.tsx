import { RotatingIcon } from "../../../shared/ui/RotatingIcon";
import { motionGeometry } from "../../../shared/motion/tokens";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { invoke } from "@tauri-apps/api/core";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { cn } from "../../../shared/lib/cn";
import { Input, type InputProps } from "../../../shared/ui/forms/Input";
import { Button } from "../../../shared/ui/forms/Button";
import { ChevronDown } from "../../../shared/ui/icons";
import { LAYER } from "../../../shared/lib/layers";
import { Popover } from "../../../shared/ui/Popover";

type SshConfigHost = {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
};

function detail(host: SshConfigHost): string {
  const target = host.hostName ?? "";
  const user = host.user ? `${host.user}@` : "";
  const port = host.port ? `:${host.port}` : "";
  return target || user || port ? `${user}${target}${port}` : "";
}

/** SSH address field that suggests the hosts in ~/.ssh/config and accepts any user@host. */
export function SshTargetInput({
  value,
  onChange,
  disabled,
  className,
  inputRef,
  ...inputProps
}: Pick<InputProps, "id" | "onBlur" | "aria-invalid" | "aria-describedby"> & {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  const hostsQuery = useQuery(
    {
      queryKey: ["ssh-config-hosts"],
      queryFn: async () => {
        const hosts = await invoke<SshConfigHost[]>("remote_ssh_config_hosts");
        return Array.isArray(hosts) ? hosts : [];
      },
      refetchOnWindowFocus: false,
    },
    queryClient,
  );
  // An unreadable config must still allow entering an arbitrary SSH address.
  const hosts = hostsQuery.data ?? [];
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const ignoreId = useId().replace(/:/g, "");

  const query = filtering ? value.trim().toLocaleLowerCase() : "";
  const options = useMemo(
    () =>
      query
        ? hosts.filter((host) =>
            `${host.alias}\n${detail(host)}`
              .toLocaleLowerCase()
              .includes(query),
          )
        : hosts,
    [hosts, query],
  );
  const shown = open && !disabled && options.length > 0;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, options.length - 1)));
  }, [options.length]);

  const show = (filter: boolean) => {
    setFiltering(filter);
    setActive(0);
    setOpen(true);
  };
  const pick = (host: SshConfigHost) => {
    onChange(host.alias);
    setOpen(false);
    input.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!shown) {
        show(false);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + options.length) % options.length);
    } else if (event.key === "Enter" && shown && options[active]) {
      event.preventDefault();
      pick(options[active]);
    } else if (event.key === "Escape" && shown) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={root} className="relative" data-ssh-target={ignoreId}>
      <Input
        {...inputProps}
        ref={(node) => {
          input.current = node;
          if (typeof inputRef === "function") inputRef(node);
          else if (inputRef) inputRef.current = node;
        }}
        autoFocus
        required
        disabled={disabled}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown ? `${listId}-${active}` : undefined}
        className={cn(className, "pr-9")}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          show(true);
        }}
        onFocus={() => show(false)}
        onClick={() => show(false)}
        onKeyDown={onKeyDown}
        placeholder={t("Select an SSH host or enter user@host")}
        autoComplete="off"
        spellCheck={false}
      />
      {hosts.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tabIndex={-1}
          disabled={disabled}
          aria-label={t("Show SSH hosts")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (shown) setOpen(false);
            else show(false);
            input.current?.focus();
          }}
          className="absolute inset-y-0 right-0 text-foreground-subtle"
        >
          <RotatingIcon
            icon={ChevronDown}
            angle={shown ? motionGeometry.flipAngle : 0}
            className="size-4"
          />
        </Button>
      ) : null}
      <Popover
        open={shown}
        anchor={root}
        side="bottom"
        align="start"
        gap={4}
        width={root.current?.offsetWidth}
        maxHeight={260}
        layer={LAYER.popover}
        ignore={`[data-ssh-target="${ignoreId}"]`}
        onDismiss={() => setOpen(false)}
        className="flex flex-col overflow-hidden"
      >
        <div
          id={listId}
          role="listbox"
          aria-label={t("SSH hosts")}
          className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1"
        >
          {options.map((host, index) => (
            <Button
              key={host.alias}
              id={`${listId}-${index}`}
              type="button"
              variant="ghost"
              data-menu-row
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(host)}
              className={cn(
                "w-full items-baseline justify-start text-left",
                index === active
                  ? "bg-selection text-foreground"
                  : "text-foreground/80",
              )}
            >
              <span className="min-w-0 truncate leading-normal font-medium">
                {host.alias}
              </span>
              {detail(host) && detail(host) !== host.alias ? (
                <span className="min-w-0 flex-1 truncate text-right text-ui-caption leading-normal text-foreground-subtle">
                  {detail(host)}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
