/**
 * Shared context + helpers for the tree2-emitting build host.
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
import * as t2 from '../index.js';

/** A parseman source span (half-open `[start, end)` byte offsets). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/* --------------------------------------------------------------- trivia log */

/**
 * Per-node trivia log layout. parseman hands each build action the trivia its
 * rule consumed as a flat, source-ordered array of `[start, end, insertIdx, kind]`
 * quadruples (`kind` is present because the tree2 driver parses with a KINDED
 * trivia rule — the less grammar's `rw`, whose `triviaKindLabels` are
 * `['whitespace','blockComment','lineComment']`). `insertIdx` is the rawChildren
 * index before which the trivia sat. The parser is the SOLE source of this
 * structure (P0): actions read it instead of re-scanning `ctx.src` for
 * whitespace / comment tokens.
 */
const TRIVIA_STRIDE = 4;
const TRIVIA_WHITESPACE = 0;
const TRIVIA_BLOCK_COMMENT = 1;

/**
 * True when a WHITESPACE trivia run was consumed immediately before rawChildren
 * index `rawIndex` — the descendant-combinator signal inside a compound selector
 * (`.a .b`), distinct from a bare byte gap (`.a/* *​/.b` is one compound, its gap
 * carries a COMMENT, not whitespace). Mirrors the css-parser CST builder's
 * `hasWhitespaceTriviaAt`.
 */
export function hasWhitespaceTriviaBefore(triviaLog: readonly number[], rawIndex: number): boolean {
  for (let i = 0; i + TRIVIA_STRIDE - 1 < triviaLog.length; i += TRIVIA_STRIDE) {
    if (triviaLog[i + 2] === rawIndex && triviaLog[i + 3] === TRIVIA_WHITESPACE) {
      return true;
    }
  }
  return false;
}

/** A block comment's source `[start, end)` range, lifted from the trivia log. */
export interface CommentRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The BLOCK comments (`/* … *​/`) the node's rule consumed, in source order —
 * the standalone-comment candidates the comments family lifts into the body.
 * Line comments (`// …`) are omitted: Less drops them, so they are never lifted
 * (and, being source-ordered by START, dropping them shifts no other comment).
 */
export function blockCommentTrivia(triviaLog: readonly number[]): CommentRange[] {
  const out: CommentRange[] = [];
  for (let i = 0; i + TRIVIA_STRIDE - 1 < triviaLog.length; i += TRIVIA_STRIDE) {
    if (triviaLog[i + 3] === TRIVIA_BLOCK_COMMENT) {
      out.push({ start: triviaLog[i]!, end: triviaLog[i + 1]! });
    }
  }
  return out;
}

/**
 * The body window `[afterOpenBrace, beforeCloseBrace)` of a ruleset, read from
 * the `{` / `}` literal leaves the parser delivers in `rawChildren` (the first
 * `{` leaf and the last `}` leaf). This is the region standalone body comments
 * live in — bounded by the real brace tokens so a `{` / `}` inside a selector or
 * a trailing string can never mis-window it. Returns `undefined` when either
 * brace leaf is absent (e.g. a selector-only build).
 */
export function rulesetBodyWindow(rawChildren: ReadonlyArray<unknown>): { start: number; end: number } | undefined {
  let start: number | undefined;
  let end: number | undefined;
  for (const rc of rawChildren) {
    const leaf = rc as { _tag?: string; value?: unknown; span?: Span } | undefined;
    if (leaf?._tag !== 'leaf' || !leaf.span) continue;
    if (leaf.value === '{' && start === undefined) start = leaf.span.end;
    else if (leaf.value === '}') end = leaf.span.start;
  }
  return start !== undefined && end !== undefined ? { start, end } : undefined;
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

/**
 * One argument slot of a `MixinArgs` group (`( … )`), kept INTERPRETATION-NEUTRAL:
 * a mixin DEFINITION reads it as a `Param` (binding / default / rest / pattern),
 * a mixin CALL reads it as a `CallArg` (positional / named value). `text` is the
 * verbatim slot bytes (already split paren/bracket-aware by the grammar, so no
 * re-tokenizing); `value` is the built value node for the slot when one exists.
 * The shared `MixinArgs` action (mixin-def family) produces `RawArg[]`; the def
 * and call families each classify it. Branded so it is unambiguous among a build's
 * children.
 */
export interface RawArg {
  readonly __rawArg: true;
  readonly text: string;
  /** The built node for the slot when one exists (a value leaf in call/arg
   *  position); the consumer narrows to `ValueNode` as needed. */
  readonly value?: t2.Node;
}

export function isRawArgList(x: unknown): x is readonly RawArg[] {
  return Array.isArray(x) && (x.length === 0 || (!!x[0] && (x[0] as RawArg).__rawArg === true));
}

/* -------------------------------------------------------------- [extend F11] */

/**
 * A built `:extend(...)` / `&:extend(...)` marker: the tree2 `ExtendInstruction`s
 * it contributes to the enclosing Rule. It is NOT a tree2 `Node`, so it is
 * filtered out of every real body (`isStatement` is false) and never emitted as a
 * selector token — the selector / ruleset families HOIST its instructions onto the
 * carrying `Rule.extendInstructions` (where the R1 serialize-time extend engine
 * reads them). Kept in `host-context` (not `actions/extend.ts`) so the selector /
 * ruleset families recognize it without a cross-family import.
 */
export interface ExtendMarker {
  readonly __t2extend: t2.ExtendInstruction[];
}
export function extendMarker(instructions: t2.ExtendInstruction[]): ExtendMarker {
  return { __t2extend: instructions };
}
export function isExtendMarker(x: unknown): x is ExtendMarker {
  return !!x && typeof x === 'object' && '__t2extend' in (x as object);
}

/**
 * One `:extend()` target branch (a comma-separated find selector + its `all`
 * flag), built by the `ExtendTarget` action and consumed by `ExtendPseudo`. `all`
 * (`!all`) → `partial: true` (the parser's flag=0), else an exact extend.
 */
export interface ExtendTargetMarker {
  readonly __t2extendTarget: { complex: t2.Complex; partial: boolean };
}
export function extendTargetMarker(complex: t2.Complex, partial: boolean): ExtendTargetMarker {
  return { __t2extendTarget: { complex, partial } };
}
export function isExtendTargetMarker(x: unknown): x is ExtendTargetMarker {
  return !!x && typeof x === 'object' && '__t2extendTarget' in (x as object);
}

/**
 * Side table: a built selector node (`Complex` / `SelectorList`) → the `:extend()`
 * instructions authored on it (`.a:extend(.b)`). A WeakMap so the selector
 * builders never pollute the tree2 selector node with a non-selector field; the
 * Ruleset family DRAINS it onto the enclosing Rule. Keyed on unique per-parse node
 * objects, so entries can never collide across parses.
 */
const SELECTOR_EXTENDS = new WeakMap<object, t2.ExtendInstruction[]>();
export function attachSelectorExtends(sel: object, instructions: t2.ExtendInstruction[]): void {
  if (instructions.length === 0) return;
  const prev = SELECTOR_EXTENDS.get(sel);
  if (prev) prev.push(...instructions);
  else SELECTOR_EXTENDS.set(sel, instructions.slice());
}
export function takeSelectorExtends(sel: object): t2.ExtendInstruction[] | undefined {
  return SELECTOR_EXTENDS.get(sel);
}
