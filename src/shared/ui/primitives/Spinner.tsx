import { cn } from "../../lib/cn";
import { Loader as LoaderIcon } from "../icons";
import { useTranslation } from "../../i18n/useTranslation";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useTranslation();
  return (
    <LoaderIcon
      role="status"
      aria-label={t("Loading…")}
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Spinner };
