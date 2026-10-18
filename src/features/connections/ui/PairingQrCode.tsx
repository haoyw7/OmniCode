import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A scannable QR code drawn as one SVG path; always dark-on-light for cameras. */
export function PairingQrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++)
      for (let col = 0; col < count; col++)
        if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
    return { size: count + 8, path: d };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-lg bg-white"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
