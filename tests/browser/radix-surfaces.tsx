import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../../src/shared/ui/Modal";
import { Popover } from "../../src/shared/ui/Popover";
import { Button } from "../../src/shared/ui/forms/Button";
import { Input } from "../../src/shared/ui/forms/Input";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { NativePopupHost } from "../../src/shared/ui/NativePopupHost";
import { PresenceBoundary } from "../../src/shared/ui/PresenceBoundary";
import { ImageLightbox } from "../../src/shared/ui/ImageLightbox";
import "../../src/styles/index.css";

document.documentElement.dataset.skin = "ripple";
document.documentElement.dataset.desktopMode = "code";

function Fixture() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [value, setValue] = useState("one");
  const [flyout, setFlyout] = useState(false);
  const [right, setRight] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const native = new URLSearchParams(location.search).has("native");
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Button
        onClick={() => {
          setFlyout(false);
          setRight(true);
          requestAnimationFrame(() => setFlyout(true));
        }}
      >
        Move anchor
      </Button>
      <Button
        ref={anchor}
        style={{
          position: "fixed",
          top: 160,
          left: right ? "calc(100vw - 70px)" : 120,
        }}
        onClick={() => setFlyout(!flyout)}
      >
        Flyout
      </Button>
      <Popover
        open={flyout}
        anchor={anchor}
        side="right"
        width={240}
        gap={4}
        onDismiss={() => setFlyout(false)}
      >
        <div data-flyout className="p-4">
          Anchored content
        </div>
      </Popover>
      {native && (
        <div
          ref={setHost}
          data-native-host
          style={{ position: "absolute", top: 100, left: 50, width: 480 }}
        />
      )}
      <NativePopupHost.Provider value={native ? host : null}>
        <PresenceBoundary>
          {open && (
            <Modal title="Surface regression" onClose={() => setOpen(false)}>
              <div className="flex flex-col gap-4 p-4">
                <Input aria-label="Draft" defaultValue="Keep this draft" />
                <Button onClick={() => setPreview(true)}>Preview image</Button>
                <PresenceBoundary>
                  {preview && <ImageLightbox src="/favicon.svg" alt="Sample" onClose={() => setPreview(false)} />}
                </PresenceBoundary>
                <SearchableSelect
                  label="Choice"
                  value={value}
                  options={[
                    { value: "one", label: "One" },
                    { value: "two", label: "Two" },
                    { value: "more", label: "More", renderSubmenu: (handlers) => (
                      <SearchableSelect label="Nested choice" value={value} menuAnchor={handlers.anchor}
                        onOpenChange={handlers.onOpenChange} options={[{ value: "three", label: "Three" }]}
                        onChange={(next) => { setValue(next); handlers.onFinish(); }} />
                    ) },
                  ]}
                  onChange={setValue}
                />
              </div>
            </Modal>
          )}
        </PresenceBoundary>
      </NativePopupHost.Provider>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
