import { MobileAppView } from "./app/MobileAppView";
import { useMobileAppController } from "./app/useMobileAppController";
import { IconArtworkContext } from "../shared/ui/icons";
import { mobileIconArtwork } from "./icons";

export function MobileApp() {
  const vm = useMobileAppController();
  return (
    <IconArtworkContext.Provider value={mobileIconArtwork}>
      <MobileAppView vm={vm} />
    </IconArtworkContext.Provider>
  );
}
