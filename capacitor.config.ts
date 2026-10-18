import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.monocode.mobile",
  appName: "OmniCode",
  loggingBehavior: "none",
  webDir: "dist-mobile",
  android: { path: "mobile/android" },
  ios: { path: "mobile/ios", contentInset: "never" },
  plugins: {
    Keyboard: { resize: "native" },
    SystemBars: {
      // MainActivity handles insets so older WebViews also draw behind the bars.
      insetsHandling: "disable",
    },
    StatusBar: { style: "DARK" },
  },
};
export default config;
