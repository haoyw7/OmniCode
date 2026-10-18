const BACK_EVENT = "monocode:sheet-back";

/** Route native Back to the frontmost interactive sheet, including its inner page. */
export function backMobileSheet(): boolean {
  const sheets = [...document.querySelectorAll<HTMLElement>(".mobile-sheet-backdrop")]
    .filter((element) => !element.closest('[inert], [aria-hidden="true"]'))
    .sort((a, b) => (Number.parseInt(getComputedStyle(a).zIndex) || 0) -
      (Number.parseInt(getComputedStyle(b).zIndex) || 0));
  const dialog = sheets.at(-1)?.querySelector<HTMLElement>(".mobile-sheet");
  return !!dialog && !dialog.dispatchEvent(new Event(BACK_EVENT, { cancelable: true }));
}

export function listenForMobileSheetBack(dialog: HTMLElement, back: () => void) {
  const listener = (event: Event) => {
    event.preventDefault();
    back();
  };
  dialog.addEventListener(BACK_EVENT, listener);
  return () => dialog.removeEventListener(BACK_EVENT, listener);
}
