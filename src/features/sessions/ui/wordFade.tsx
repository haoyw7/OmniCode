import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import type { Element, Root } from "hast";
import { useMotionPreference } from "../../../shared/motion/useMotionPreference";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import type { TextRevealSequence } from "./textRevealQueue";

export type TextRevealOptions = {
  initialLength?: number;
  settledLength?: number;
  sequence?: TextRevealSequence;
};

const TICK_MS = 25;
const MAX_STEP = 32;
const MIN_SPEED = 160;
const MAX_SPEED = (MAX_STEP * 1000) / TICK_MS;
const ACCELERATION = 1600;
const FIRST_STEP = (MIN_SPEED * TICK_MS) / 1000;
const FADE_MS = 200;
const FINISH_MS = 180;

const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function* graphemes(
  text: string,
): Generator<{ index: number; segment: string }> {
  if (segmenter) {
    yield* segmenter.segment(text);
    return;
  }
  let segment = "";
  let index = 0;
  for (const character of text) {
    if (
      segment &&
      !/^[\p{Mark}\uFE0E\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]$/u.test(character) &&
      !segment.endsWith("\u200D") &&
      !(
        /^\p{Regional_Indicator}$/u.test(segment) &&
        /^\p{Regional_Indicator}$/u.test(character)
      )
    ) {
      yield { index, segment };
      index += segment.length;
      segment = "";
    }
    segment += character;
  }
  if (segment) yield { index, segment };
}

export function revealBoundary(
  text: string,
  start: number,
  step = FIRST_STEP,
  holdMarkers = true,
  maxStep = MAX_STEP,
): number {
  const ceiling = Math.min(
    text.length,
    start + Math.min(maxStep, Math.max(1, Math.floor(step))),
  );
  let end = start;
  for (const part of graphemes(text.slice(start))) {
    const next = start + part.index + part.segment.length;
    if (next > ceiling) {
      // A single grapheme is indivisible, even an unusually long ZWJ sequence.
      if (end === start) end = next;
      break;
    }
    end = next;
    if (end === ceiling) break;
  }
  const line = text.lastIndexOf("\n", end - 1) + 1;
  if (
    holdMarkers &&
    /^ {0,3}(?:#{1,6}|>|[-+*]|\d+[.)]|`{1,}|~{1,})\s*$/.test(
      text.slice(line, end),
    )
  ) {
    if (line > start) return line;
    // Never scan ahead to a newline: that could release an arbitrarily long line.
    if (end === text.length) return start;
  }
  return end;
}

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
const pageVisible = () => !document.hidden;
const serverVisible = () => true;

export function usePacedText(
  text: string,
  streaming: boolean,
  options?: TextRevealOptions,
) {
  const reduced = useMotionPreference();
  const visible = useSyncExternalStore(
    subscribeVisibility,
    pageVisible,
    serverVisible,
  );
  const surfaceVisible = useSurfaceVisibility();
  const immediate = reduced || !visible || !surfaceVisible;
  const [state, setState] = useState(() => {
    const history = Math.min(text.length, options?.initialLength ?? 0);
    const length =
      immediate || !streaming
        ? text.length
        : history || revealBoundary(text, 0);
    return {
      source: text,
      length,
      prime: immediate || !streaming ? length : history,
      streaming,
      paced: streaming,
    };
  });
  let current = state;
  const settled = Math.min(text.length, options?.settledLength ?? 0);
  if (
    state.source !== text ||
    state.streaming !== streaming ||
    (immediate && state.length < text.length) ||
    settled > state.length
  ) {
    const replaced = !text.startsWith(state.source);
    const staticText = !streaming && !state.paced;
    const catchUp = immediate || staticText;
    const length = catchUp
      ? text.length
      : replaced
        ? Math.min(state.length, text.length)
        : Math.max(state.length, settled);
    current = {
      source: text,
      length,
      prime: catchUp ? length : Math.max(state.prime, settled),
      streaming,
      paced: state.paced || streaming,
    };
    setState(current);
  }
  const latest = useRef(current);
  latest.current = current;
  const wake = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (immediate) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let speed = MIN_SPEED;
    let credit = 0;
    let last = performance.now();
    let prime = latest.current.prime;
    let idle = true;
    let finishSource: string | undefined;
    let finishAt = 0;
    const schedule = () => {
      const value = latest.current;
      if (value.length >= value.source.length) { idle = true; return; }
      const now = performance.now();
      if (value.streaming) finishSource = undefined;
      else if (finishSource !== value.source) {
        finishSource = value.source;
        finishAt = now + FINISH_MS;
      }
      if (timer !== undefined) return;
      if (idle || prime !== value.prime) {
        speed = MIN_SPEED;
        credit = 0;
        prime = value.prime;
        last = now;
      }
      idle = false;
      timer = setTimeout(tick, TICK_MS);
    };
    const tick = () => {
      timer = undefined;
      const value = latest.current;
      const backlog = value.source.length - value.length;
      if (backlog <= 0 || document.hidden) return;
      const now = performance.now();
      // Include React's commit time, but bound recovery from a suspended page.
      const elapsed = Math.min(100, Math.max(0, now - last));
      const remaining = Math.max(TICK_MS, finishAt - last);
      last = now;
      const target = Math.max(MIN_SPEED, Math.min(MAX_SPEED, backlog / 0.2));
      const change = (ACCELERATION * elapsed) / 1000;
      speed += Math.max(-change, Math.min(change, target - speed));
      const maxStep = value.streaming ? Math.max(MAX_STEP, Math.ceil(MAX_SPEED * elapsed / 1000)) : backlog;
      credit = value.streaming
        ? Math.min(maxStep, credit + (speed * elapsed) / 1000)
        : now >= finishAt ? backlog : Math.ceil(backlog * elapsed / remaining);
      const length = revealBoundary(
        value.source,
        value.length,
        credit,
        value.streaming,
        maxStep,
      );
      if (length <= value.length) { idle = true; return; }
      credit = Math.max(0, credit - (length - value.length));
      setState({ ...value, length });
      // The next timeout is armed by the layout effect after this batch commits.
    };
    wake.current = schedule;
    schedule();
    return () => {
      clearTimeout(timer);
      wake.current = undefined;
    };
  }, [immediate]);
  useLayoutEffect(() => {
    wake.current?.();
  });
  const revealing = current.length < text.length && !immediate;
  const sequence = options?.sequence;
  useLayoutEffect(() => {
    sequence?.setPending(revealing);
  }, [sequence, revealing]);
  useEffect(() => () => sequence?.setPending(false), [sequence]);
  return {
    text: text.slice(0, current.length),
    revealing,
    primeLength: current.prime,
    reduced,
  };
}

type FadeChunk = { from: number; to: number; start: number; end: number };
type FadeRun = { text: string; plain: number; chunks: FadeChunk[] };

export class WordFadeManager {
  private runs = new Map<string, FadeRun>();
  private horizon = 0;
  private text = "";
  primeLength = 0;
  enabled = false;

  sync(
    text: string,
    enabled: boolean,
    primeLength: number,
    now = performance.now(),
  ) {
    if (!text.startsWith(this.text)) {
      this.runs.clear();
      this.horizon = now;
      this.primeLength = text.length;
    } else this.primeLength = Math.max(this.primeLength, primeLength);
    this.text = text;
    this.enabled = enabled;
  }

  reveal(
    id: string,
    text: string,
    offset: number,
    now = performance.now(),
  ): FadeRun {
    let run = this.runs.get(id);
    if (!run || !text.startsWith(run.text)) {
      run = { text: "", plain: 0, chunks: [] };
      this.runs.set(id, run);
    }
    if (!this.enabled || offset + text.length <= this.primeLength) {
      run.plain = text.length;
      run.chunks = [];
    } else if (text.length > run.text.length) {
      let from = run.text.length;
      // Small phrase groups also work for Chinese and long unbroken words.
      let size = 0;
      for (const part of graphemes(text.slice(from))) {
        size += part.segment.length;
        if (size < 16 && from + size < text.length && !/\s/.test(part.segment))
          continue;
        const to = from + size;
        if (offset + to <= this.primeLength) {
          run.plain = to;
          run.chunks = [];
        } else {
          this.horizon = Math.min(
            Math.max(now, this.horizon) + size * 2.5,
            now + 600,
          );
          run.chunks.push({
            from,
            to,
            start: this.horizon,
            end: this.horizon + FADE_MS,
          });
        }
        from = to;
        size = 0;
      }
    }
    run.text = text;
    while (run.chunks.length && run.chunks[0].end <= now) {
      run.plain = run.chunks.shift()!.to;
    }
    return run;
  }
}

export const WordFadeContext = createContext<{
  manager: WordFadeManager;
  offset: number;
} | null>(null);

export function MarkdownSpan({
  node: _node,
  children,
  ...props
}: ComponentProps<"span"> & { node?: unknown; "data-stream-text"?: number }) {
  const start = props["data-stream-text"];
  if (start !== undefined && typeof children === "string")
    return <FadingText start={Number(start)} text={children} />;
  return <span {...props}>{children}</span>;
}

function FadingText({ start, text }: { start: number; text: string }) {
  const context = useContext(WordFadeContext);
  const [, refresh] = useState(0);
  const offset = (context?.offset ?? 0) + start;
  const now = performance.now();
  const run = context?.manager.reveal(String(offset), text, offset, now);
  const end = run?.chunks.at(-1)?.end;
  useEffect(() => {
    if (end === undefined) return;
    const timer = setTimeout(
      () => refresh((n) => n + 1),
      Math.max(0, end - performance.now()) + 1,
    );
    return () => clearTimeout(timer);
  }, [end]);
  if (!run?.chunks.length) return text;
  return (
    <>
      {text.slice(0, run.plain)}
      {run.chunks.map((chunk) => (
        <FadeSpan
          key={chunk.from}
          start={chunk.start}
          text={text.slice(chunk.from, chunk.to)}
        />
      ))}
    </>
  );
}

function FadeSpan({ start, text }: { start: number; text: string }) {
  const [delay] = useState(() => start - performance.now());
  return (
    <span data-word-fade="" style={{ animationDelay: `${delay}ms` }}>
      {text}
    </span>
  );
}

const UNFADED_TAGS = new Set(["code", "pre", "svg", "math", "kbd"]);

export function rehypeWordFade() {
  return (tree: Root) => {
    const walk = (parent: Root | Element) => {
      parent.children = parent.children.map((child) => {
        if (child.type === "text" && child.value.trim()) {
          return {
            type: "element" as const,
            tagName: "span",
            properties: {
              "data-stream-text": child.position?.start.offset ?? 0,
            },
            children: [child],
          };
        }
        if (child.type === "element" && !UNFADED_TAGS.has(child.tagName))
          walk(child);
        return child;
      });
    };
    walk(tree);
  };
}
