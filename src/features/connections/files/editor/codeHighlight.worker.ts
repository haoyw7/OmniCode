import {
  createCodeTokenizer,
  type CodeTokenizeRequest,
  type CodeTokenizeResponse,
} from "./codeTokenizer";

// Shiki's JavaScript regex engine compiles and runs grammars synchronously;
// a few code blocks could hold the window for seconds on the main thread.
const tokenize = createCodeTokenizer();

self.onmessage = (event: MessageEvent<CodeTokenizeRequest>) => {
  const { id, code, lang, themes } = event.data;
  tokenize(code, lang, themes).then(
    (result) => self.postMessage({ id, result } satisfies CodeTokenizeResponse),
    (error: unknown) =>
      self.postMessage({
        id,
        error: String(error),
      } satisfies CodeTokenizeResponse),
  );
};
