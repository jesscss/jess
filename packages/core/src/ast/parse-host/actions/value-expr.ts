/**
 * Value-expressions family (F6 operations + F7 function calls,
 * together because they share the declaration whole-value guard).
 *
 * Grammar `type`s constructed:
 *   • `Operation`     — a math expression whose slash DIVIDES (paren / calc body):
 *                       every operator folds to a computed `t2.Operation`.
 *   • `OperationTop`  — the declaration-level math variant. Default Less math treats
 *                       a top-level `/` as a LIST separator, not division (the
 *                       grammar encodes the math mode by tagging this run `Top`), so
 *                       a `/` step folds to a slash `SpacedValue` (`12px / 16px` —
 *                       operands resolve but never divide) while `* + - %` fold to a
 *                       computed `Operation`. Both fold the flat `operand op operand
 *                       …` children left-associatively; the grammar carries
 *                       precedence by nesting product inside sum, so one build folds
 *                       a single precedence level. (`collapse:true` means a lone
 *                       operand never reaches here — a plain value builds no node.)
 *   • `Paren`         — `( expr )`: a transparent wrapper around one inner value.
 *   • `Call`          — `name( args )` / `calc( … )`: a STRUCTURED `FunctionCall`
 *                       whose args keep their full shape — comma args, space
 *                       lists, AND the modern `/` separator (`rgb(0 128 255 / 50%)`
 *                       → `[space-list 0 128 (255 / 50%)]`). We do NOT flatten the
 *                       space group (the bridge's `flattenSpaceGroup` DROPS the
 *                       `/` — a bug); the direct path preserves it so the call is
 *                       reconstructable.
 *
 * Oracle: the bridge, EXCEPT where it is provably buggy. Clean shapes are gated
 * byte-identical against `bridgeToAst`. Two shapes diverge on purpose (the
 * bridge is wrong, the direct path matches real Less 4.x):
 *   • modern `/` in a call (`rgb(0 128 255 / 50%)`, `hsl(… / .5)`) — bridge drops
 *     the `/`; direct keeps it.
 *   • a space-list call arg (`foo(1px solid red)`) — bridge re-slices with a
 *     leading-space defect (`1px  solid`); direct emits single spaces.
 *
 * The `Declaration` action (in `custom-props.ts`) consumes a whole-value
 * `Paren`/`FunctionCall` directly, and ASSEMBLES multi-part values — interleaving
 * these built `Operation` / slash-list / call nodes with the verbatim bytes between
 * them. A top-level operation therefore STRUCTURES and evaluates at serialize
 * (`@a * .5 + @b * .5` → a color; `12px/16px` → a `12px / 16px` slash list), unlike
 * the bridge, which defers it as a raw declaration `Any` for a later eval pass.
 *
 * TOTALITY: parseman builds backtracked branches, so every action returns a valid
 * node (never throws) even on a doomed shape.
 */
import * as t2 from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  type CommentRange,
  type Span,
  blockCommentTrivia,
  hasCommentTrivia,
  sliceSpan,
} from '../host-context.js';

/** A parseman child leaf `{ _tag:'leaf', value, span }` (operators / separators). */
interface Leaf {
  readonly _tag: 'leaf';
  readonly value: string;
  readonly span?: Span;
}

function isLeaf(x: unknown): x is Leaf {
  return !!x && typeof x === 'object' && (x as { _tag?: string })._tag === 'leaf';
}

function isValueNode(x: unknown): x is t2.ValueNode {
  return t2.isNode(x);
}

/** A built `GuardNode` child (`{ g: … }`) — the structured condition a `CondArg…`
 *  grammar arm folds to. It is NOT a value node, so `buildCall` wraps it. */
function isGuardNode(x: unknown): x is t2.GuardNode {
  return !!x && typeof x === 'object' && !t2.isNode(x) && 'g' in (x as object);
}

/** Raw leaf text of a child (operator / separator / bare ident). */
function leafText(x: unknown): string {
  return isLeaf(x) ? x.value : '';
}

/**
 * A zero-content structural leaf: an empty-text child that carries no source bytes —
 * either no span at all, or a zero-width span the grammar emits as an anchor between
 * tokens (e.g. the epsilon right after a `(`). Skipped when assembling paren/call
 * items so it never becomes a spurious empty `Any` operand (which would serialize as
 * a leading space, e.g. `( #ffffff)`).
 */
function isEmptyStructuralLeaf(child: unknown, raw: unknown): boolean {
  if (isValueNode(child) || leafText(child) !== '') return false;
  const span = (raw as { span?: Span } | undefined)?.span;
  return !span || span.start === span.end;
}

/**
 * A value operand from child slot `i`: a built value node as-is, else the child's
 * verbatim source bytes as an `Any` (a bare ident like `solid`, or an
 * unmodelled/placeholder shape — kept byte-faithful so the action stays total).
 */
function operandAt(args: BuildArgs, i: number): t2.ValueNode {
  const c = args.children[i];
  if (isValueNode(c)) return c;
  const raw = args.rawChildren[i] as { span?: Span } | undefined;
  const text = raw?.span ? sliceSpan(args.ctx, raw.span) : leafText(c);
  return t2.any(text.trim());
}

/**
 * Fold a flat `operand (op operand)*` child run into left-associative `Operation`
 * nodes. Operators sit at odd indices (raw leaves), operands at even indices.
 */
function foldOperation(args: BuildArgs): t2.ValueNode {
  const n = args.children.length;
  let left = operandAt(args, 0);
  for (let i = 1; i + 1 < n; i += 2) {
    const op = leafText(args.children[i]).trim();
    const right = operandAt(args, i + 1);
    left = t2.operation(op, left, right);
  }
  return left;
}

/**
 * Declaration-level fold. Identical to `foldOperation` EXCEPT the slash: at the top
 * level (outside parens/calc) Less default math treats `/` as a LIST separator, not
 * division (the grammar encodes the math mode by tagging this run `OperationTop`
 * rather than `Operation`). A `/` step therefore builds a slash-separated
 * `SpacedValue` (`left / right`) whose operands still resolve (`@a / @b`) but are
 * NEVER divided — matching the legacy oracle (`font: 12px/16px` → `12px / 16px`).
 * `*` / `+` / `-` / `%` still fold to a computed `Operation`.
 */
function foldOperationTop(args: BuildArgs): t2.ValueNode {
  const n = args.children.length;
  let left = operandAt(args, 0);
  for (let i = 1; i + 1 < n; i += 2) {
    const op = leafText(args.children[i]).trim();
    const right = operandAt(args, i + 1);
    left = op === '/' ? t2.spaced([left, t2.any('/'), right]) : t2.operation(op, left, right);
  }
  return left;
}

const operation: BuildAction = { type: 'Operation', build: foldOperation };
const operationTop: BuildAction = { type: 'OperationTop', build: foldOperationTop };

/* --------------------------------------------------------------- Negative */

/**
 * Value node types a unary minus can negate arithmetically. Per Less 4.x a leading
 * `-` is unary negation ONLY for a number/dimension, a parenthesized expression, or
 * a variable (and the numeric `Operation` those compose into). It is NOT negation
 * when the operand STARTS WITH AN IDENTIFIER — a `FunctionCall` like
 * `-webkit-gradient(…)` / `-moz-…` keeps its verbatim `-` prefix (4.x renders
 * `-webkit-gradient(…)`, not `-1 * webkit-gradient(…)`) — nor for a `Color`
 * (`-#111` → `- #111`, not a negated color). A `Keyword`/`Any` bare ident is
 * likewise kept verbatim rather than folded into an arithmetic negation.
 */
const NEGATABLE = new Set([
  'Dimension', 'VarRef', 'PropRef', 'Paren', 'Operation',
  'VarIndirect', 'MapAccessor',
]);

/**
 * Leading unary minus (`-@var`, `-(@a + @b)`, `-fn()`). The grammar isolates it as a
 * `Negative` node — a `-` leaf followed by one value operand. Per less.js, a unary
 * minus lowers to `Operation('*', [Dimension(-1), operand])`, so it reuses the
 * ordinary math path: `-@var` = `-1 * @var` = `0 - @var` for a single-unit operand
 * (`@var: 4px` → `-4px`), and it composes through products/sums (`-(2 + 2) * -@var`
 * → `16px`). An operand that is not numerically negatable (a bare ident) keeps its
 * verbatim source bytes so `-webkit-box` and friends are untouched.
 */
function buildNegative(args: BuildArgs): t2.ValueNode {
  let operand: t2.ValueNode | null = null;
  for (let i = 0; i < args.children.length; i++) {
    const c = args.children[i];
    if (isValueNode(c)) { operand = c; break; }
  }
  if (operand === null || !NEGATABLE.has(operand.type)) {
    return t2.any(sliceSpan(args.ctx, args.span).trim());
  }
  return t2.operation('*', t2.dimension(-1), operand);
}

const negative: BuildAction = { type: 'Negative', build: buildNegative };

/* ------------------------------------------------------------------ Paren */

/** Source bytes strictly between the outer `(` … `)` of a paren/call child run. */
function betweenBytes(args: BuildArgs, openIdx: number, closeIdx: number): string {
  const openRaw = args.rawChildren[openIdx] as { span?: Span } | undefined;
  const closeRaw = args.rawChildren[closeIdx] as { span?: Span } | undefined;
  if (openRaw?.span && closeRaw?.span) {
    return args.ctx.src.slice(openRaw.span.end, closeRaw.span.start).trim();
  }
  return '';
}

/** Index of the first `(` leaf, and the last `)` leaf, in a child run. */
function parenBounds(children: ReadonlyArray<unknown>): { open: number; close: number } {
  let open = -1;
  let close = -1;
  for (let i = 0; i < children.length; i++) {
    const v = leafText(children[i]);
    if (open < 0 && v === '(') open = i;
    if (v === ')') close = i;
  }
  return { open, close };
}

/**
 * `( expr )` — a transparent wrapper around ONE inner value. A single inner value
 * node wraps directly; a space list wraps as a `SpacedValue`; a comma list (rare
 * in value position) keeps its inner source bytes verbatim (the fallback for a
 * non-computable paren body).
 */
const paren: BuildAction = {
  type: 'Paren',
  build: (args) => {
    const { open, close } = parenBounds(args.children);
    const lo = open < 0 ? 0 : open + 1;
    const hi = close < 0 ? args.children.length : close;
    let hasComma = false;
    const items: t2.ValueNode[] = [];
    for (let i = lo; i < hi; i++) {
      const c = args.children[i];
      if (isValueNode(c)) {
        items.push(c);
        continue;
      }
      const v = leafText(c);
      if (v === ',' || v === ';') {
        hasComma = true;
        continue;
      }
      if (v === '' && isEmptyStructuralLeaf(c, args.rawChildren[i])) continue;
      items.push(operandAt(args, i));
    }
    if (hasComma && open >= 0 && close >= 0) {
      return t2.paren(t2.any(betweenBytes(args, open, close)));
    }
    if (items.length === 0) return t2.paren(t2.any(''));
    const inner = items.length === 1 ? items[0]! : t2.spaced(items);
    return t2.paren(inner);
  },
};

/* ------------------------------------------------------------------ Call */

/**
 * Assemble ONE argument value from the run of children in a comma segment: a lone
 * item passes through; multiple space-separated items become a `SpacedValue` (this
 * is what preserves the modern `/` — the `/` folds into an `Operation` operand
 * inside the space list, so the group serializes with the slash intact).
 */
function assembleSegment(items: t2.ValueNode[]): t2.ValueNode | null {
  if (items.length === 0) return null;
  return items.length === 1 ? items[0]! : t2.spaced(items);
}

/**
 * `name( args )` / `calc( … )` → a structured `FunctionCall`. Args are split on
 * top-level `,` (a `;` group separator is treated the same for value assembly —
 * a semicolon-in-args call is a rare mixin-ish shape flagged separately). Each
 * segment's items (built value nodes + bare-ident leaves) assemble to one arg.
 * `modern` stays false: the space/slash structure is preserved in the arg nodes
 * themselves, so the serializer needs no modern flag to reproduce the spelling.
 */
function commentInRange(comments: readonly CommentRange[], start: number, end: number): boolean {
  for (const c of comments) if (c.start >= start && c.end <= end) return true;
  return false;
}

function buildCall(args: BuildArgs): t2.ValueNode {
    const children = args.children;
    const name = leafText(children[0]).trim() || sliceSpan(args.ctx, { start: args.span.start, end: args.span.start });
    const { open, close } = parenBounds(children);
    if (open < 0) {
      // No `(` — a bare keyword collapsed here; keep it byte-faithful.
      return t2.any(sliceSpan(args.ctx, args.span).trim());
    }
    const hi = close < 0 ? children.length : close;
    // [comment] An arg carrying a block comment (`#333 /*{c}*/`) prints its source
    // bytes verbatim: comments are parser trivia (never a value token), so the
    // structured assembly drops them; a comment-bearing segment keeps its raw bytes.
    // A comment-free call (the common case) tracks NO byte bounds — zero extra work.
    const comments = hasCommentTrivia(args.triviaLog) ? blockCommentTrivia(args.triviaLog) : null;
    const openSpan = (args.rawChildren[open] as { span?: Span } | undefined)?.span;
    const closeSpan = close >= 0 ? (args.rawChildren[close] as { span?: Span } | undefined)?.span : undefined;
    const segments: t2.ValueNode[][] = [[]];
    // Byte start of the current segment (after the `(` or the last `,`/`;`).
    let segByteStart = openSpan ? openSpan.end : args.span.start;
    const segBounds: Array<{ start: number; end: number }> | null = comments ? [] : null;
    const closeSegment = (endByte: number): void => {
      if (segBounds) segBounds.push({ start: segByteStart, end: endByte });
    };
    for (let i = open + 1; i < hi; i++) {
      const c = children[i];
      if (isValueNode(c)) {
        segments[segments.length - 1]!.push(c);
        continue;
      }
      // [condition-grammar] A structured condition arg (`if(@a > 0, …)`) folds to a
      // `GuardNode`; wrap it in a `Condition` value node carrying its verbatim src so
      // it lives in `FunctionCall.args` like any other arg (the logical fns read its
      // `guard`; a non-eval pass emits the `src`).
      if (isGuardNode(c)) {
        const raw = args.rawChildren[i] as { span?: Span } | undefined;
        const src = raw?.span ? sliceSpan(args.ctx, raw.span).trim() : '';
        segments[segments.length - 1]!.push(t2.condition(c, src));
        continue;
      }
      const v = leafText(c);
      if (v === ',' || v === ';') {
        const sep = (args.rawChildren[i] as { span?: Span } | undefined)?.span;
        closeSegment(sep ? sep.start : segByteStart);
        segByteStart = sep ? sep.end : segByteStart;
        segments.push([]);
        continue;
      }
      // A bare value leaf (ident like `solid`, or an unmodelled shape): keep its
      // verbatim bytes. Skip a zero-width structural leaf (a built node's wrapper).
      if (v === '' && isEmptyStructuralLeaf(c, args.rawChildren[i])) continue;
      segments[segments.length - 1]!.push(operandAt(args, i));
    }
    closeSegment(closeSpan ? closeSpan.start : args.span.end);
    const argList: t2.ValueNode[] = [];
    for (let s = 0; s < segments.length; s++) {
      const bounds = segBounds?.[s];
      if (bounds && comments && comments.length > 0 && commentInRange(comments, bounds.start, bounds.end)) {
        argList.push(t2.any(args.ctx.src.slice(bounds.start, bounds.end).trim()));
        continue;
      }
      const a = assembleSegment(segments[s]!);
      if (a !== null) argList.push(a);
    }
    return t2.funcCall(name, argList, false);
}

const call: BuildAction = { type: 'Call', build: buildCall };

/**
 * `%( template, args… )` — the Less `%()` string-format call. The grammar tags it a
 * distinct `FormatCall` (so the bare `%` mod operator is unaffected), but its child
 * run is a normal `name( args )` shape whose name leaf is `%`. We lower it to a
 * PLAIN function call to the public `string-format` fn (`@jesscss/fns`; owner:
 * whole-word name, not Sass's `str-` abbreviation) — no parse-time interpolation
 * lowering; the fn substitutes `%s`/`%d`/`%a` at eval and re-wraps/unwraps the quote
 * exactly as Less 4.x does, so the serialized bytes match the legacy oracle.
 */
const formatCall: BuildAction = {
  type: 'FormatCall',
  build: (args) => {
    const built = buildCall(args);
    // The name leaf is `%`; lower to the whole-word public fn `string-format`.
    return built.type === 'FunctionCall' ? t2.funcCall('string-format', built.args, built.modern) : built;
  },
};

export const VALUE_EXPR_ACTIONS: readonly BuildAction[] = [operation, operationTop, paren, call, formatCall, negative];
