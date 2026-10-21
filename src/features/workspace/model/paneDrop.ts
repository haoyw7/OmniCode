/** An open dock that can receive terminals is on screen. */
export function terminalDockOpen(): boolean {
  return !!document.querySelector(
    "[data-project-terminal-dock]:not([inert] *)",
  );
}
