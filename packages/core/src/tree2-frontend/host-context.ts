/**
 * [tree2-native] Shared context + helpers for the tree2-emitting build host.
 *
 * The tree2-native Less parser drives the SAME parseman grammar as the legacy
 * parser, but supplies a different `build(type, …)` host that constructs tree2
 * nodes DIRECTLY (no legacy `../tree` AST, no bridge walk). Each node FAMILY is a
 * module of `BuildAction`s (see `actions/`); this file holds the pieces every
 * family shares: the per-parse `BuildContext`, the `BuildAction`/`BuildArgs`
 * contract, and the source-slice / declaration / selector helpers ported from
 * the POC host (which mirror the bridge's `slice` / `rawDeclValue` derivations).
 *
 * Boundary: like the bridge, this front-end file may touch the parser layer and
 * `../tree2`; it does NOT import the legacy `../tree`.
 */
import * as t2 from '../tree2/index.js';

/** A parseman source span (half-open `[start, end)` byte offsets). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * Per-parse state threaded to every build action. Kept intentionally small (the
 * source string is all the current families need); grows additively as families
 * require more (e.g. a warnings sink for the deprecation families).
 */
export interface BuildContext {
  /** The full source text being parsed (for verbatim byte capture). */
  readonly src: string;
}

/** The arguments a build action receives — the parseman `build(...)` tuple plus
 *  the shared per-parse `BuildContext`. */
export interface BuildArgs {
  readonly type: string;
  readonly children: ReadonlyArray<unknown>;
  readonly fields: unknown;
  readonly span: Span;
  readonly rawChildren: ReadonlyArray<unknown>;
  readonly triviaLog: readonly number[];
  readonly ctx: BuildContext;
}

/** A family's construction action for ONE grammar rule type. */
export type BuildFn = (args: BuildArgs) => unknown;

/**
 * One `(grammar type → tree2 constructor)` binding. A family module exports an
 * array of these; `actions/index.ts` concatenates them into `ACTION_LIST`. The
 * dispatch host indexes the list by `type` once, so `build(...)` is a single
 * monomorphic map lookup.
 */
export interface BuildAction {
  readonly type: string;
  readonly build: BuildFn;
}

/**
 * Inert placeholder for a grammar type no registered family models. It only ever
 * reaches the tree on speculative/backtracked branches (which are discarded) or
 * as a value/selector child a parent action re-derives from source, so it is
 * filtered out of every real body (see `isStatement`). Carrying the type name
 * keeps it debuggable.
 */
export interface Placeholder {
  readonly __t2ph: string;
}

export function placeholder(type: string): Placeholder {
  return { __t2ph: type };
}

export function isPlaceholder(x: unknown): x is Placeholder {
  return !!x && typeof x === 'object' && '__t2ph' in (x as object);
}

/** Verbatim source bytes of a span. */
export function sliceSpan(ctx: BuildContext, span: Span): string {
  return ctx.src.slice(span.start, span.end);
}

/**
 * Split a `name: value` declaration's source span into its trimmed name + value
 * bytes — identical derivation to the bridge's `rawDeclValue` (drop a trailing
 * `;`, split on the first `:`). `!important`, when present, rides along in the
 * value bytes (tree2 has no separate important field on the static path).
 */
export function declParts(src: string, start: number, end: number): { name: string; value: string } {
  const declText = src.slice(start, end);
  const body = declText.replace(/;\s*$/, '');
  const colon = body.indexOf(':');
  const name = body.slice(0, colon).trim();
  const value = body.slice(colon + 1).trim();
  return { name, value };
}

/**
 * Selector bytes of a ruleset head. The grammar hands the selector as the first
 * child — a bare string for a simple selector, or a built tree2 selector node
 * once the selector family is registered. This helper recovers the raw string
 * form for the string / raw-leaf path; a built `Complex`/`SelectorList` child is
 * handled by the caller before falling through here.
 */
export function selectorText(
  src: string,
  children: readonly unknown[],
  rawChildren: readonly unknown[],
): string {
  const first = children[0];
  if (typeof first === 'string') return first.trim();
  const raw = rawChildren[0] as { span?: Span } | undefined;
  if (raw?.span) return src.slice(raw.span.start, raw.span.end).trim();
  throw new Error('tree2-host: unrecognized selector shape');
}

/** Only real tree2 nodes count as body statements (placeholders/leaves excluded). */
export function isStatement(x: unknown): x is t2.Statement {
  return x instanceof t2.Node;
}
