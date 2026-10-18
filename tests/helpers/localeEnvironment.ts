// Tests describe the English UI unless they choose a language themselves.
// Node exposes the host locale as navigator.language, which would otherwise
// make translated messages and formatted dates depend on the machine.
if (typeof navigator !== "undefined" && !navigator.language?.startsWith("en")) {
  Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-US"] });
}
