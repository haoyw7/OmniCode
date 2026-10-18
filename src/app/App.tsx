import { Suspense } from "react";
import { AppView } from "./AppView";
import { useWorkspaceController } from "./controller/useWorkspaceController";
import type { AppProps } from "./controller/workspaceTypes";

export default function App(props: AppProps) {
  return (
    <Suspense fallback={null}>
      <Workspace {...props} />
    </Suspense>
  );
}

function Workspace(props: AppProps) {
  const vm = useWorkspaceController(props);
  return <AppView vm={vm} />;
}
