/**
 * Control-flow family: the Less `each(<iterable>, <callback>)` loop and the two
 * callback-body shapes it consumes.
 *
 * The grammar lowers `each(...)` to a `For` grammar node (never a value-position
 * `Call`) and the callback to either a `DetachedRuleset` (`{ … }`) or an
 * `AnonymousMixinDefinition` (`.(@v, @k, @i) { … }` / `#(…) { … }`, whose params
 * name the loop variables). Neither callback shape has an action elsewhere (a
 * `@x: { … }` detached-ruleset VALUE is consumed inline by the VarDeclaration
 * family), so this family builds all three:
 *
 *   - `DetachedRuleset`          → tree2 `DetachedRuleset` (its statement body).
 *   - `AnonymousMixinDefinition` → tree2 `MixinDef` (empty name), so its params
 *     (the loop-variable names) and body survive to the `For` builder.
 *   - `For`                      → tree2 `For`: the iterable value node + the
 *     callback body + the resolved loop-variable names.
 *
 * The `For` serializer (`serialize.ts` `expandFor`) emits the body once per
 * iterable item, binding the loop variables per iteration — the statement-emitting
 * counterpart to a mixin call.
 */
import * as t2 from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  type Span,
  isStatement,
} from '../host-context.js';
import { isArgSlotList } from './mixins-def.js';

/** A parseman child leaf `{ _tag:'leaf', value, span }`. */
function leafText(x: unknown): string | undefined {
  return !!x && typeof x === 'object' && (x as { _tag?: string })._tag === 'leaf'
    ? (x as { value: string }).value
    : undefined;
}

/** Verbatim source bytes of a raw child's span. */
function rawSpan(x: unknown): Span | undefined {
  return (x as { span?: Span } | undefined)?.span;
}

/* --------------------------------------------------------- callback shapes */

/** `{ … }` detached-ruleset callback → its statement body (no loop-var params). */
const detachedRuleset: BuildAction = {
  type: 'DetachedRuleset',
  build: (args) => t2.detachedRuleset(args.children.filter(isStatement) as t2.Statement[]),
};

/**
 * `.(@v, @k, @i) { … }` / `#(…) { … }` anonymous-mixin callback → a nameless
 * `MixinDef`. Only the loop-variable NAMES matter (a bare `@v` positional param),
 * so each `MixinArgs` slot that built a `VarRef` contributes its name; the body is
 * the statement children.
 */
const anonymousMixin: BuildAction = {
  type: 'AnonymousMixinDefinition',
  build: (args) => {
    const slots = args.children.find(isArgSlotList) ?? [];
    const params: t2.Param[] = [];
    for (const slot of slots) {
      const built = slot.built;
      if (t2.isNode(built) && built.type === 'VarRef') params.push({ name: built.name });
      else params.push({ name: '' });
    }
    const body = args.children.filter(isStatement) as t2.Statement[];
    return t2.mixinDef('', params, body);
  },
};

/* ------------------------------------------------------------------- each */

/** The default loop-variable names when the callback is a plain detached ruleset. */
const DEFAULT_NAMES = ['value', 'key', 'index'] as const;

/**
 * `each(<iterable>, <callback>)` → tree2 `For`. Children are the flattened
 * `functionCallArgs` run: `each ( <iterable tokens> <sep> <callback> ) ;`. The
 * callback is the last built `DetachedRuleset` / `MixinDef` child; everything
 * between the opening `(` and the separator before it is the iterable.
 */
function buildFor(args: BuildArgs): t2.For {
  const children = args.children;
  // The callback: the last DetachedRuleset (from the `{ … }` shape) or MixinDef
  // (from the anonymous-mixin shape) child.
  let cbIdx = -1;
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i];
    if (t2.isNode(c) && (c.type === 'DetachedRuleset' || c.type === 'MixinDef')) {
      cbIdx = i;
      break;
    }
  }
  const callback = cbIdx >= 0 ? (children[cbIdx] as t2.DetachedRuleset | t2.MixinDef) : undefined;
  const rules = callback ? callback.body : [];
  // An anonymous-mixin callback names the loop variables by its params, in
  // (value, key, index) order; an omitted trailing param leaves that binding out.
  // A plain detached-ruleset callback uses the default `@value`/`@key`/`@index`.
  const names: Array<string | null> =
    callback && callback.type === 'MixinDef'
      ? callback.params.map((p) => p.name || null)
      : [...DEFAULT_NAMES];
  const valueName = names[0] ?? null;
  const keyName = names[1] ?? null;
  const indexName = names[2] ?? null;

  const open = children.findIndex((c) => leafText(c) === '(');
  const iterable = buildIterable(args, open, cbIdx);
  return t2.forNode(iterable, rules, valueName, keyName, indexName);
}

/**
 * Assemble the iterable value node from the children between `(` and the
 * callback. A single built value node (`@list`, `range(4)`, `@map[k]`) passes
 * through so it evaluates structurally; a mixin-call shape (`.mixin()`,
 * `#ns > .m()` — selector leaf(s) + a `Paren` arg group) rebuilds as a
 * `MixinCall` so the serializer dispatches it and iterates its OUTPUT; anything
 * else (a literal list `1 2 3`, `a, b`, `10px 15px, 20px 25px`) keeps its verbatim
 * source bytes as a `Word` — the serializer byte-splits it into items (top-level
 * comma, else space).
 */
function buildIterable(args: BuildArgs, open: number, cbIdx: number): t2.ValueNode | t2.MixinCall {
  const children = args.children;
  const lo = open + 1;
  const hi = cbIdx >= 0 ? cbIdx : children.length;
  const valueNodes: t2.ValueNode[] = [];
  let sawBareLeaf = false;
  let firstSpan: Span | undefined;
  let lastSpan: Span | undefined;
  for (let i = lo; i < hi; i++) {
    const c = children[i];
    const v = leafText(c);
    if (v === ',' || v === ';') continue; // top-level arg separators
    if (t2.isNode(c)) valueNodes.push(c as t2.ValueNode);
    else if (v !== undefined && v !== '') sawBareLeaf = true; // a bare ident / number leaf
    else continue; // a zero-width structural leaf
    const span = rawSpan(args.rawChildren[i]);
    if (span) {
      firstSpan ??= span;
      lastSpan = span;
    }
  }
  if (valueNodes.length === 1 && !sawBareLeaf) return valueNodes[0]!;
  // [each mixin-call iterable] `.mixin()` / `#ns > .m()` used as the each iterable:
  // its OUTPUT (the mixin's emitted declarations) is iterated. The each-arg grammar
  // hands the call as selector leaf(s) + a `Paren` (the arg group) rather than a
  // `MixinArgs` slot list, so reconstruct the `MixinCall` node here — structurally,
  // from the already-parsed children (no byte re-tokenization) — for the serializer
  // to dispatch and iterate (`forItems` mixin-call branch).
  const mixinCall = tryMixinCallIterable(children, lo, hi);
  if (mixinCall) return mixinCall;
  // Fallback: the verbatim source bytes spanning the iterable region — the
  // serializer byte-splits this into list items (top-level comma, else space).
  const from = firstSpan?.start ?? args.span.start;
  const to = lastSpan?.end ?? args.span.end;
  return t2.word(args.ctx.src.slice(from, to).trim());
}

/** Combinator leaves that separate namespace-path segments in a mixin call. */
function isCombinator(v: string): v is t2.Combinator {
  return v === '>' || v === '+' || v === '~';
}

/**
 * Recognize a mixin-call iterable shape — leading selector token(s)
 * (`.set-2`, `#ns > .m`) followed by a single `Paren` arg group — and build the
 * `MixinCall` node from those structured children. Returns `undefined` for any
 * other child shape (a real list/value iterable), which keeps the byte fallback.
 */
function tryMixinCallIterable(
  children: readonly unknown[],
  lo: number,
  hi: number,
): t2.MixinCall | undefined {
  const segs: Array<{ comb: t2.Combinator; sel: string }> = [];
  let pendingComb: t2.Combinator = ' ';
  let paren: t2.Paren | undefined;
  for (let i = lo; i < hi; i++) {
    const c = children[i];
    const v = leafText(c);
    if (v === ',' || v === ';' || v === '') continue; // separators / zero-width
    if (t2.isNode(c)) {
      if (c.type === 'Paren' && paren === undefined) { paren = c; continue; }
      return undefined; // any other node → not a plain mixin call
    }
    if (v === undefined) continue;
    if (isCombinator(v)) { pendingComb = v; continue; }
    if (paren !== undefined) return undefined; // a token after the args → not a call
    segs.push({ comb: pendingComb, sel: v });
    pendingComb = ' ';
  }
  if (paren === undefined || segs.length === 0) return undefined;
  // A mixin name is a class/id selector token (`.foo` / `#foo`).
  const first = segs[0]!.sel;
  if (!(first.startsWith('.') || first.startsWith('#'))) return undefined;
  const name = segs[segs.length - 1]!.sel;
  const path: t2.PathSeg[] = segs.slice(0, -1).map((s) => ({ comb: s.comb, sel: s.sel }));
  // Empty `()` → zero-arg call; otherwise the paren's inner value is one positional
  // argument (the common each-over-mixin-output shape passes no or one argument).
  const inner = paren.inner;
  const callArgs: t2.CallArg[] =
    inner.type === 'Word' && inner.text === '' ? [] : [{ value: inner }];
  return { type: 'MixinCall', name, args: callArgs, path, important: false };
}

export const CONTROL_FLOW_ACTIONS: readonly BuildAction[] = [
  detachedRuleset,
  anonymousMixin,
  { type: 'For', build: buildFor },
];
