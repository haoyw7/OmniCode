import { MobileAppView } from "./app/MobileAppView";
import { useMobileAppController } from "./app/useMobileAppController";
import { Toaster } from "../shared/ui/primitives/Sonner";

export function MobileApp() {
  const vm = useMobileAppController();
  return (
    <>
      <MobileAppView vm={vm} />
      <Toaster />
    </>
  );
}
