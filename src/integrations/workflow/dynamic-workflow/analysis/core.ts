import type { ScriptLoc } from "../compiler/compile.js";
import type { TaintOcc } from "./domain.js";
import type { OrderTrace } from "./causality-order.js";
import type { NamePattern } from "./types.js";

/**
 * The analysis core: the single, self-contained artifact one interpretation of a
 * workflow script produces. It carries the
 * data-dependency half (the taint facts) AND the temporal half (the ordering trace) in
 * one value, and every graph the analyzer serves — site graph, causality graph, actor
 * graph — is a pure projection of it.
 *
 * The design principle is **no position dependence**: anything that needs raw source
 * offsets or the TypeScript checker is resolved when the core is minted
 * (interpret.ts), never by a projection. That is what "projections never look at the
 * code again" means mechanically, and it is checkable: a projection module must not
 * import `typescript`.
 *
 *  - `within` containment (site lexically inside a promoted fan-out body) is resolved
 *    onto each site entry here — the projection reads a string, not a span;
 *  - fan-out ids are FINAL (`fan-out#N`); the taint pass's provisional `fan-out@order`
 *    vocabulary dies at minting, including inside every occurrence and type key;
 *  - artifact types are materialized strings (the checker's answers), keyed by final id.
 *
 * `ScriptLoc` (line:column) fields remain — they are rendering data, not AST access.
 */

/** An `ask` site, AST-free. `within` is the enclosing promoted fan-out, when any. */
export interface CoreAskSite {
  id: string;
  order: number;
  label: string;
  labelPattern?: NamePattern;
  loc: ScriptLoc;
  within?: string;
}

/** A world-read or join site, AST-free. */
export interface CoreSimpleSite {
  id: string;
  order: number;
  label: string;
  loc: ScriptLoc;
  within?: string;
}

/** An `agent()` site, AST-free. */
export interface CoreActorSite {
  id: string;
  order: number;
  loc: ScriptLoc;
  name?: string;
  namePattern?: NamePattern;
  within?: string;
}

/**
 * A PROMOTED fan-out, under its final `fan-out#N` id (source order). Non-promoted
 * iteration candidates are not part of the core — they are graph nodes in nothing.
 */
export interface CoreFanoutSite {
  id: string;
  order: number;
  label: string;
  loc: ScriptLoc;
  within?: string;
  /**
   * 字面量基数：被迭代的是无展开的数组字面量
   * 或从未被写入的 `const` 字面量绑定时的元素个数；其余缺席。铸造期算好，投影只读。
   */
  cardinality?: number;
}

export interface CoreSites {
  asks: CoreAskSite[];
  worldReads: CoreSimpleSite[];
  joins: CoreSimpleSite[];
  actors: CoreActorSite[];
  fanouts: CoreFanoutSite[];
}

/**
 * The edge-bearing taint facts, exactly {@link TaintFacts} minus `promoted` (folded
 * into {@link CoreSites.fanouts}) — with every occurrence site and every `fanoutIn`
 * key already renamed to final ids.
 */
export interface CoreFacts {
  askData: Map<string, TaintOcc[]>;
  askActor: Map<string, TaintOcc[]>;
  worldReadData: Map<string, TaintOcc[]>;
  joinIn: Map<string, TaintOcc[]>;
  fanoutIn: Map<string, TaintOcc[]>;
  returnData: TaintOcc[];
}

/** The checker's answers, materialized. Keys are final site ids. */
export interface CoreTypes {
  /** Whole-value artifact type per producer site. */
  siteType: Map<string, string>;
  /** Per-element awaited types of a join over a static array literal. */
  joinPortTypes: Map<string, (string | undefined)[]>;
}

export interface AnalysisCore {
  sites: CoreSites;
  facts: CoreFacts;
  /** The raw temporal trace — issue/settle/spawn events, regions, controls, phases. */
  trace: OrderTrace;
  types: CoreTypes;
}

/** Site-id vocabulary: is this label an actor site? (Actor labels never make data edges.) */
export function isActorSite(site: string): boolean {
  return site.startsWith("actor#");
}

