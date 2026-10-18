


// One height for the whole detail action row; `border` is inside it, so the
// outline variant lines up with the filled and ghost ones.
const ACTION = "inline-flex items-center gap-1.5 rounded-md px-3 text-[12px]";
export const ACTION_FILLED = `${ACTION} h-6.5 bg-content text-background-base hover:bg-content/80`;
export const ACTION_OUTLINE = `${ACTION} h-7 border border-content/15 text-content/80 hover:bg-content/3`;
export const ACTION_PANEL_HEADER = `${ACTION} h-6.5 text-content/70 hover:bg-content/6 hover:text-content`;
export const ACTION_GHOST = `${ACTION} h-7 text-content/70 hover:bg-content/6 hover:text-content`;
