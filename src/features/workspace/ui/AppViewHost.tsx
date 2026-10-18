import {
  createContext,
  memo,
  Suspense,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import type { AppViewKind } from "../model/layout";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { useTranslation } from "../../../shared/i18n/useTranslation";

/** App owns the view dependencies; workspace panes only know its kind. */
export type AppViewRenderer = (kind: AppViewKind, active: boolean) => ReactNode;

export const AppViewRendererContext = createContext<AppViewRenderer | null>(null);

type Props = {
  kind: AppViewKind;
  visible: boolean;
  focused: boolean;
};

/** A restored hidden view stays lazy; a visited view retains its local state. */
export function AppViewHost({ kind, visible, focused }: Props) {
  const render = useContext(AppViewRendererContext);
  const mounted = useRef(false);
  if (visible) mounted.current = true;
  if (!mounted.current || !render) return null;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <Suspense fallback={<AppViewLoading />}>
        <FrozenAppView
          kind={kind}
          visible={visible}
          focused={focused}
          render={render}
        />
      </Suspense>
    </div>
  );
}

function AppViewLoading() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-content/45"
    >
      {t("Loading…")}
    </div>
  );
}

const FrozenAppView = memo(
  function FrozenAppView({
    kind,
    visible,
    focused,
    render,
  }: Props & { render: AppViewRenderer }) {
    return (
      <SurfaceVisibilityContext.Provider value={visible}>
        {render(kind, visible && focused)}
      </SurfaceVisibilityContext.Provider>
    );
  },
  (previous, next) =>
    previous.kind === next.kind && !previous.visible && !next.visible,
);
