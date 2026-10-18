import { Button } from "../shared/ui/forms/Button";
import { MobileSpinner } from "./MobileSpinner";
import { useEffect, useRef, useState } from "react";
import { CameraOff, ScanQrCode } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";

type ScannerState = "starting" | "scanning" | "denied" | "unavailable";
type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

const SCAN_INTERVAL_MS = 200;
const MAX_FRAME_SIZE = 720;

/** Prefer the platform detector; WebKit lacks it, so fall back to jsQR there. */
async function createDecoder(): Promise<(video: HTMLVideoElement) => Promise<string | undefined>> {
  const Native = (globalThis as { BarcodeDetector?: DetectorConstructor & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (Native && (await Native.getSupportedFormats?.().catch((): string[] => []))?.includes("qr_code")) {
    const detector = new Native({ formats: ["qr_code"] });
    return async (video) => (await detector.detect(video))[0]?.rawValue;
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!context || !video.videoWidth) return undefined;
    const scale = Math.min(1, MAX_FRAME_SIZE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" })?.data;
  };
}

/** Live rear-camera QR reader. The camera runs only while `active`. */
export function MobileQrScanner({ active, onDetected }: {
  active: boolean;
  onDetected: (text: string) => void;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScannerState>("starting");
  const [attempt, setAttempt] = useState(0);
  const detected = useRef(onDetected);
  detected.current = onDetected;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    setState("starting");
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (error) {
        if (stopped) return;
        const name = error instanceof DOMException ? error.name : "";
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
        return;
      }
      const element = video.current;
      if (stopped || !element) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      element.srcObject = stream;
      await element.play().catch(() => {});
      const decode = await createDecoder().catch(() => undefined);
      if (stopped) return;
      if (!decode) {
        setState("unavailable");
        return;
      }
      setState("scanning");
      const scan = async () => {
        if (stopped) return;
        const text = await decode(element).catch(() => undefined);
        if (stopped) return;
        // Report a code once while it stays in view so a rejected code does
        // not flood the caller, but allow it again after it leaves the frame.
        if (text && text !== last) detected.current(text);
        last = text ?? "";
        timer = setTimeout(() => void scan(), SCAN_INTERVAL_MS);
      };
      void scan();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, [active, attempt]);

  const blocked = state === "denied" || state === "unavailable";
  return (
    <div className="mobile-qr-scanner" data-state={state}>
      <video ref={video} muted playsInline autoPlay controls={false} aria-hidden="true" />
      {state === "scanning" && <span className="mobile-qr-frame" aria-hidden="true" />}
      {state === "starting" && (
        <span className="mobile-qr-overlay mobile-qr-loading" role="status">
          <span className="mobile-qr-loading-icon" aria-hidden="true">
            <ScanQrCode size={30} />
          </span>
          <span className="mobile-qr-loading-label">
            <MobileSpinner size={16} className="mobile-spin" aria-hidden="true" />
            <span>{t("Starting camera…")}</span>
          </span>
        </span>
      )}
      {blocked && (
        <span className="mobile-qr-overlay" role="status">
          <CameraOff size={26} />
          <span>
            {t(
              state === "denied"
                ? "Camera access is off. Allow it in system settings, or use a pairing code."
                : "The camera is not available on this device. Use a pairing code instead.",
            )}
          </span>
          {state === "denied" && (
            <Button variant="secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>
              {t("Try again")}
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
