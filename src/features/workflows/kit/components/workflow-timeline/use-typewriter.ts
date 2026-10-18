export interface TypewriterState { visible: number; shown: readonly number[]; idle: boolean; }
const SILENT: TypewriterState = { idle: false, shown: [], visible: 0 };
export function useTypewriter(names: readonly string[] | undefined): TypewriterState {
  return names === undefined ? SILENT : { visible: names.length, shown: names.map(name => name.length), idle: names.length > 0 };
}
