import type { ReactNode } from "react";
import { Check } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import {
  MOBILE_SKINS,
  MOBILE_SKIN_INFO,
  type MobileSkin,
  type MobileSkinPreference,
} from "./theme/skin";

/** A live miniature: the skin's own tokens paint a tiny thread and composer. */
function SkinScene({ skin }: { skin: MobileSkin }) {
  return (
    <span
      className="mobile-skin-scope flex h-full flex-col gap-1.5 p-2"
      data-mobile-skin={skin}
      aria-hidden="true"
    >
      <span className="h-2.5 w-3/4 rounded-full bg-m-card" />
      <span className="h-2.5 w-1/2 self-end rounded-full bg-m-bubble-user" />
      <span className="h-2.5 w-2/3 rounded-full bg-m-card" />
      <span className="mt-auto flex h-4 items-center justify-end rounded-full bg-m-composer px-0.5 ring-1 ring-m-composer-ring">
        <span className="size-3 rounded-full bg-m-accent" />
      </span>
    </span>
  );
}

function SkinOption({
  selected,
  label,
  onSelect,
  children,
  wide,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className="mobile-skin-option group flex min-h-m-hit flex-col gap-2 rounded-m-xl p-1.5 text-left transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none"
      data-wide={wide || undefined}
      onClick={onSelect}
    >
      <span
        className="relative block overflow-hidden rounded-[10px] ring-1 ring-m-hairline group-aria-checked:ring-2 group-aria-checked:ring-m-accent"
        style={{ aspectRatio: wide ? "3 / 1" : "4 / 5" }}
      >
        {children}
        {selected ? (
          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-m-accent text-m-accent-ink">
            <Check size={12} />
          </span>
        ) : null}
      </span>
      <span className="px-0.5 text-m-label font-medium text-m-ink">{label}</span>
    </button>
  );
}

export function MobileSkinPicker({
  value,
  onChange,
}: {
  value: MobileSkinPreference;
  onChange: (value: MobileSkinPreference) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mobile-skin-picker flex flex-col gap-3" role="radiogroup" aria-label={t("Skin")}>
      <SkinOption
        wide
        selected={value === "auto"}
        label={t("Automatic")}
        onSelect={() => onChange("auto")}
      >
        <span className="grid h-full grid-cols-2">
          <SkinScene skin="midnight" />
          <SkinScene skin="daylight" />
        </span>
      </SkinOption>
      <p className="px-2 text-m-meta text-m-ink-secondary">
        {t("Midnight or Daylight, following Color mode.")}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {MOBILE_SKINS.map((skin) => (
          <SkinOption
            key={skin}
            selected={value === skin}
            label={t(MOBILE_SKIN_INFO[skin].label)}
            onSelect={() => onChange(skin)}
          >
            <SkinScene skin={skin} />
          </SkinOption>
        ))}
      </div>
    </div>
  );
}
