import type { Plugin } from "postcss";

export function scaleFontSize(value: string): string;
declare function fontScale(): Plugin;
declare namespace fontScale {
  const postcss: true;
}
export default fontScale;
