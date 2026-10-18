/*!
 * BM25 scoring and English stemming adapted from Pi:
 * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/extensions/tool-search/tool.ts
 *
 * MIT License
 *
 * Copyright (c) 2025 Mario Zechner
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const STOPWORDS = new Set(
  (
    "a an and are as at be by for from in is it of on or that the this to with " +
    "was were what when where which who how why did does have has had you your " +
    "our not but can will into about there their them then than just any all " +
    "its i me my we us he she they his her s t " +
    "的 了 是 在 和 与 及 或 我 你 您 他 她 它 我们 你们 他们 这个 那个 这些 那些 " +
    "这 那 什么 怎么 怎样 如何 为什么 哪个 哪些 哪里 谁 吗 呢 吧 啊 请 一下 一个 " +
    "有没有 是否 就 都 也 又 还 很 把 被 对 于 从 到 给 得 着 我的 你的 他的 她的 它的"
  ).split(" "),
);
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

/** Pi's simple singular forms: issues → issue, searches → search. */
function stem(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && /(ches|shes|sses|xes|zes)$/.test(term))
    return term.slice(0, -2);
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss"))
    return term.slice(0, -1);
  return term;
}

/** Shared query/document tokens; repeated occurrences retain their frequency. */
export function tokenizeMemorySearch(input: string): string[] {
  const text = input.normalize("NFKC");
  const tokens: string[] = [];
  const seen = new Set<string>();
  const add = (term: string, index: number) => {
    const lower = term.toLowerCase();
    if (STOPWORDS.has(lower)) return;
    const token = /^[a-z]+$/.test(lower) ? stem(lower) : lower;
    const key = `${index}:${term.length}:${token}`;
    // A two-character Chinese word is also a bigram; do not count it twice.
    if (seen.has(key)) return;
    seen.add(key);
    tokens.push(token);
  };

  for (const run of text.matchAll(/\p{Script=Han}+|[^\p{Script=Han}]+/gu)) {
    if (/^\p{Script=Han}/u.test(run[0])) {
      let previous: { character: string; index: number } | undefined;
      for (const part of segmenter.segment(run[0])) {
        if (STOPWORDS.has(part.segment)) {
          previous = undefined;
          continue;
        }
        const characters = Array.from(part.segment);
        let index = run.index + part.index;
        if (characters.length >= 2) add(part.segment, index);
        // Unknown names can be segmented into single characters. Adjacent
        // pairs recover them without matching unrelated isolated characters.
        for (const character of characters) {
          if (previous) add(previous.character + character, previous.index);
          previous = { character, index };
          index += character.length;
        }
      }
      continue;
    }

    for (const identifier of run[0].matchAll(
      /[\p{L}\p{N}\p{M}]+(?:[_.\/-][\p{L}\p{N}\p{M}]+)*/gu,
    )) {
      const start = run.index + identifier.index;
      // Keep SQLite, piFamily.ts and paths searchable as complete identifiers,
      // as well as by their components (splitting SQLite alone loses sqlite).
      add(identifier[0], start);
      for (const component of identifier[0].matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
        const words = component[0]
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
          .split(" ");
        let index = start + component.index;
        for (const word of words) {
          add(word, index);
          index += word.length;
        }
      }
    }
  }
  return tokens;
}

/** Pi's Okapi BM25, returning scores in document order for caller-owned ties. */
export function bm25Scores(
  query: readonly string[],
  documents: readonly string[],
): number[] {
  const terms = [...new Set(query)];
  if (!terms.length || !documents.length) return documents.map(() => 0);
  const k1 = 1.2;
  const b = 0.75;
  const termCounts = documents.map((document) => {
    const counts = new Map<string, number>();
    for (const term of tokenizeMemorySearch(document))
      counts.set(term, (counts.get(term) ?? 0) + 1);
    return counts;
  });
  const lengths = termCounts.map((counts) =>
    [...counts.values()].reduce((sum, count) => sum + count, 0),
  );
  const averageLength =
    lengths.reduce((sum, length) => sum + length, 0) / documents.length || 1;
  const idf = new Map(
    terms.map((term) => {
      const frequency = termCounts.filter((counts) => counts.has(term)).length;
      return [
        term,
        Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5)),
      ] as const;
    }),
  );
  return termCounts.map((counts, index) => {
    let score = 0;
    const norm = k1 * (1 - b + (b * lengths[index]) / averageLength);
    for (const term of terms) {
      const count = counts.get(term);
      if (count)
        score += (idf.get(term) ?? 0) * ((count * (k1 + 1)) / (count + norm));
    }
    return score;
  });
}
