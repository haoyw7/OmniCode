import { lazy, Suspense, type ComponentType } from "react";

/** Keep optional surfaces out of the composer's startup dependency graph. */
export function lazySurface<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  { suspense = true }: { suspense?: boolean } = {},
) {
  let pending: ReturnType<typeof load> | undefined;
  let loaded: ComponentType<Props> | undefined;
  let rendered: ComponentType<Props> | undefined;
  const preload = () => {
    pending ??= load().then((module) => {
      loaded = module.default;
      return module;
    }).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
  const Surface = lazy(preload);
  function LazySurface(props: Props) {
    // A warm surface can render synchronously without another Suspense fallback.
    // Pick once so a surface first opened while loading never remounts its state.
    const Content = rendered ??= loaded ?? Surface;
    // Navigation uses the app's existing boundary so a transition keeps the
    // current screen visible until the destination has loaded.
    if (!suspense) return <Content {...props} />;
    return (
      <Suspense fallback={null}>
        <Content {...props} />
      </Suspense>
    );
  }
  return Object.assign(LazySurface, { preload });
}
