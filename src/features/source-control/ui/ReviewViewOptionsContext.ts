import { createContext } from "react";
import {
  REVIEW_VIEW_DEFAULTS,
  type ReviewViewOptions,
} from "../model/reviewViewOptions";

/** The review pane's rendering choices, read by each memoized diff viewer. */
export const ReviewViewOptionsContext =
  createContext<ReviewViewOptions>(REVIEW_VIEW_DEFAULTS);
