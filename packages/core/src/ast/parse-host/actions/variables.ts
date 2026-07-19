/**
 * Variables family: Less variable declarations + references.
 *
 * `VarDeclaration` (`@x: value`) → tree2 `VarDeclaration` (emits nothing; binds a
 * name in the scope frame). A bare variable `Reference` (`@name`) that appears as a
 * value → tree2 `VarRef`, so the value resolves against the scope frame at
 * serialize time.
 *
 * P0 — the parser already isolated the reference (a `Reference` node) and bounded
 * the declaration value, so this family CONSUMES those built children; it does not
 * regex-hunt `ctx.src` for `@name` tokens the parser already found:
 *   - the `Reference` action reads its single bare-`@name` leaf child (declines an
 *     accessor / call / `$property` chain, which carry extra children);
 *   - `VarDeclaration` consumes the single WHOLE-value built node (a `Reference`
 *     → `VarRef`, or a value leaf) via the shared `wholeValueNode`; a multi-token /
 *     interpolated value keeps its verbatim bytes (value-assembly is out of F1's
 *     scope — a `VarDeclaration` emits nothing, so this is only observable once the
 *     variable is referenced, and multi-part references are not F1's shape).
 *
 * A map / namespace accessor (`@map[key]`), a `$property` reference, or a
 * detached-ruleset call (`@rs(...)`) is NOT a plain variable value — those are the
 * value / mixin families' shapes, so this family declines them (an inert
 * placeholder) rather than mis-modelling them. Every action is TOTAL (never
 * throws) so parseman's speculative / backtracked branches are safe.
 */
import * as t2 from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  type KindedCommentRange,
  allCommentTrivia,
  declParts,
  hasCommentTrivia,
  isStatement,
  placeholder,
  sliceSpan,
} from '../host-context.js';
import { type Leaf, isLeaf, wholeValueNode } from './interp.js';
import { buildValueList } from './custom-props.js';
import { tryMixinCallIterable } from './control-flow.js';
import { isCombinator, slotToCallArg } from './mixin-call.js';
import { type ArgSlot, isArgSlotList } from './mixins-def.js';

/**
 * Strip the comment trivia a Less variable value discards. Two distinct rules,
 * both verified against less.js `alpha`:
 *   - EVERY `// …` LINE comment is removed (interior included) — Less lexes line
 *     comments out entirely, so `@items: // Fruit\n apple, …` binds the bare list.
 *   - Only LEADING / TRAILING block comments detach (`@c: yes /* c *​/` → `yes`,
 *     `@e: /* c *​/ blue` → `blue`); an INTERIOR block comment stays part of the
 *     value (`@f: red /* a *​/ green /* t *​/` → `red /* a *​/ green`).
 * Comment ranges come from the parser trivia log (P0 — not a byte re-scan), so a
 * `*​/` inside a string is never mistaken for a comment. `[valueStart, valueEnd)` is
 * the value's byte range in source coordinates.
 */
function stripValueComments(args: BuildArgs, valueStart: number, valueEnd: number): string {
  const src = args.ctx.src;
  if (!hasCommentTrivia(args.triviaLog)) return src.slice(valueStart, valueEnd).trim();
  const comments: KindedCommentRange[] = allCommentTrivia(args.triviaLog)
    .filter((c) => c.start >= valueStart && c.end <= valueEnd)
    .sort((a, b) => a.start - b.start);
  if (comments.length === 0) return src.slice(valueStart, valueEnd).trim();
  const isWs = (i: number): boolean => {
    const c = src.charCodeAt(i);
    return c === 32 || c === 9 || c === 10 || c === 13;
  };
  // Ranges to excise: every line comment, plus each boundary block comment
  // (separated from the value edge by only whitespace and already-excised ranges).
  const drop = new Set<KindedCommentRange>(comments.filter((c) => c.line));
  // Peel leading comments: walk left→right while the gap to the next comment is
  // only whitespace / already-dropped bytes (a boundary run); stop at real content.
  let lo = valueStart;
  for (const c of comments) {
    let p = lo;
    while (p < c.start && (isWs(p) || inDropped(p, drop))) p++;
    if (p !== c.start) break; // real content precedes → not leading trivia
    drop.add(c);
    lo = c.end;
  }
  // Peel trailing comments: walk right→left symmetrically.
  let hi = valueEnd;
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i]!;
    if (c.start >= hi) continue; // already inside the peeled trailing run
    let p = hi;
    while (p > c.end && (isWs(p - 1) || inDropped(p - 1, drop))) p--;
    if (p !== c.end) break; // real content follows → not trailing trivia
    drop.add(c);
    hi = c.start;
  }
  // Rebuild the value with every dropped range excised, in source order.
  const kept = [...drop].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = valueStart;
  for (const d of kept) {
    if (d.start > cursor) out += src.slice(cursor, d.start);
    cursor = Math.max(cursor, d.end);
  }
  out += src.slice(cursor, valueEnd);
  return out.trim();
}

/** Whether byte offset `i` lies inside any already-dropped comment range. */
function inDropped(i: number, drop: ReadonlySet<KindedCommentRange>): boolean {
  for (const d of drop) if (i >= d.start && i < d.end) return true;
  return false;
}

/**
 * `@x: value;` — split the span into name + value bytes (drop a trailing `;`, split
 * on the first `:`), strip the name's leading `@` (the bridge / scope key is the
 * bare identifier). The value is the single whole-value built node when the parser
 * produced one (`@a` → `VarRef`, `red` → value leaf), else the verbatim value bytes
 * (a computed / multi-part / interpolated value is the value-assembly family's
 * shape, not F1's — and a `VarDeclaration` emits nothing, so it is unobservable
 * until referenced).
 */
/**
 * Structure a top-level SPACE-separated variable value (`@v: a b c`, `@v: @a @b @c`,
 * `@v: 1px solid @c`) into a `SpacedValue` whose parts are the per-item value nodes.
 * The parser hands each top-level space item as ONE child (a built value node — a
 * pre-folded `Operation` / slash `SpacedValue` / `Paren` / `VarRef` — or a bare
 * ident leaf), so this CONSUMES those children (no `ctx.src` re-tokenizing, P0):
 * every non-separator child after the `:` is one item. Returns `null` (leave the
 * caller's verbatim-`Any` fallback in place) when the value is a single item — that
 * whole-value case is already handled — or when a top-level `,` appears (a comma
 * list is `buildValueList`'s shape). A trailing `!important` (`!` / `important`
 * leaves) is importance, not a value item, so it terminates the item run.
 */
function buildSpaceList(args: BuildArgs): t2.ValueNode | null {
  const colonIdx = args.children.findIndex((c) => isLeaf(c) && c.value === ':');
  if (colonIdx < 0) return null;
  const items: t2.ValueNode[] = [];
  for (let i = colonIdx + 1; i < args.children.length; i++) {
    const c = args.children[i];
    if (t2.isNode(c)) {
      items.push(c as t2.ValueNode);
      continue;
    }
    if (!isLeaf(c)) continue;
    const v = c.value;
    if (v === ';') break;
    if (v === '!' || v.toLowerCase() === 'important') break;
    if (v === ',') return null; // a comma list is buildValueList's shape
    if (v === '') continue; // zero-width structural leaf
    items.push(t2.any(v));
  }
  return items.length >= 2 ? t2.spaced(items) : null;
}

const varDeclaration: BuildAction = {
  type: 'VarDeclaration',
  build: (args) => {
    const { name, value } = declParts(args.ctx.src, args.span.start, args.span.end);
    const bare = name.charCodeAt(0) === 0x40 /* @ */ ? name.slice(1) : name;
    // A detached-ruleset value `@x: { … }` — the parser bounds the block with a
    // `{`/`}` leaf pair and hands the block's built statements as children between
    // them. Consume that structure into a `DetachedRuleset` value (callable via a
    // `VarCall`); no re-parse of the value bytes (P0).
    if (args.children.some((c) => isLeaf(c) && c.value === '{')) {
      const body = args.children.filter(isStatement);
      return t2.varDecl(bare, t2.detachedRuleset(body));
    }
    // A mixin-CALL value `@p: .mk-map();` — the parser hands the call as selector
    // leaf(s) + a `Paren` arg group (identical to the `each(.mixin(), …)` iterable
    // shape). Reconstruct the `MixinCall` STRUCTURALLY (no byte re-tokenizing, P0)
    // so the binding is dispatched lazily when read (`@p[text]`, `@p()`).
    const valLo = args.children.findIndex((c) => isLeaf(c) && c.value === ':') + 1;
    if (valLo > 0) {
      const mixinCall = tryMixinCallIterable(args.children, valLo, args.children.length);
      if (mixinCall) return t2.varDecl(bare, mixinCall);
    }
    // A trailing `!important` on a variable value is IMPORTANCE, not value bytes
    // (Less `importantScope`): strip it, structure the inner value so its refs
    // resolve, and wrap in an `Important` node so referencing the variable hoists a
    // single `!important` onto the enclosing declaration. `!`/`important` are LEAF
    // children (never value nodes), so the inner value structures exactly as if the
    // `!important` were absent — a single-ref inner (`@c`) still whole-value-matches.
    const impMatch = /\s*!\s*important$/iu.exec(value);
    const innerValue = impMatch ? value.slice(0, impMatch.index) : value;
    const wrapImportant = (v: t2.ValueNode): t2.ValueNode => impMatch ? t2.important(v) : v;
    const node = wholeValueNode(args, innerValue);
    let valueNode: t2.ValueNode;
    if (node !== null) {
      valueNode = wrapImportant(node as t2.ValueNode);
    } else {
      // Verbatim value bytes — but a boundary comment binds to the source, not the
      // value, so peel leading/trailing comment trivia (`@c: yes /* c */` → `yes`).
      const src = args.ctx.src;
      const declText = src.slice(args.span.start, args.span.end);
      const colonRel = declText.indexOf(':');
      let valEndAbs = args.span.end;
      while (valEndAbs > args.span.start && /[;\s]/.test(src[valEndAbs - 1]!)) valEndAbs--;
      // Exclude a trailing `!important` from the verbatim value range too (its
      // importance rides on the `Important` wrapper, never the emitted bytes).
      if (impMatch) {
        const inRange = src.slice(args.span.start, valEndAbs);
        const m = /\s*!\s*important$/iu.exec(inRange);
        if (m) {
          valEndAbs = args.span.start + m.index;
          while (valEndAbs > args.span.start && /\s/u.test(src[valEndAbs - 1]!)) valEndAbs--;
        }
      }
      const valStartAbs = args.span.start + colonRel + 1;
      // A top-level comma list binds STRUCTURED (P0 — the parser owns the comma
      // boundaries), so `@v: @a, @b, @c` / `@cols: 1, 2` keep indexable items instead
      // of collapsing to an opaque `Any` the value layer would re-split (`buildValueList`
      // trims each segment itself, so the raw colon+1 start is fine). Only when the
      // value has no comment trivia in-range (a boundary comment needs the peel below).
      const commentFree = !hasCommentTrivia(args.triviaLog)
        || allCommentTrivia(args.triviaLog).every((c) => c.end <= valStartAbs || c.start >= valEndAbs);
      const list = colonRel >= 0 && commentFree
        ? buildValueList(args, valStartAbs, src.slice(valStartAbs, valEndAbs))
        : null;
      // A top-level SPACE list binds STRUCTURED too (`@v: a b c` / `@v: @a @b @c` /
      // `@v: 1px solid @c`). The grammar pre-folds each top-level space item into a
      // single value child (operations / slash groups / parens are already one node),
      // so each non-separator child IS one list item — no byte re-scan (P0). This
      // keeps the value indexable by `extract` / `length`, resolves item refs, and
      // normalizes the inter-item spacing (double space → single) on emit.
      const spaceList = list === null && colonRel >= 0 && commentFree
        ? buildSpaceList(args)
        : null;
      if (list !== null) {
        valueNode = wrapImportant(list);
      } else if (spaceList !== null) {
        valueNode = wrapImportant(spaceList);
      } else {
        const stripped = colonRel >= 0 ? stripValueComments(args, valStartAbs, valEndAbs) : innerValue;
        valueNode = wrapImportant(t2.any(stripped));
      }
    }
    return t2.varDecl(bare, valueNode);
  },
};

/**
 * A detached-ruleset CALL statement `@x();` → tree2 `DetachedCall`. The parser
 * emits a `VarCall` rule whose first child is the bare `@name` variable leaf; the
 * serializer (`serialize.ts:854`, `expandDetachedCall`) resolves it to the bound
 * `DetachedRuleset` and splices its body. A detached call carries no args (Less
 * detached rulesets are argument-less), so the trailing `MixinArgs` slot is not
 * read. A non-variable head declines to an inert placeholder.
 */
const varCall: BuildAction = {
  type: 'VarCall',
  build: (args) => {
    const first = args.children[0];
    if (isLeaf(first) && first.value.charCodeAt(0) === 0x40 /* @ */) {
      return t2.detachedCall(first.value.slice(1));
    }
    return placeholder(args.type);
  },
};

/** True when every char of `s` is an ASCII digit (optionally a leading `-`); an
 *  all-digit accessor key is a 1-based list index, not a property name. */
function isIntLiteral(s: string): boolean {
  let i = 0;
  if (s.charCodeAt(0) === 0x2d /* - */) i = 1;
  if (i >= s.length) return false;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return false;
  }
  return true;
}

/**
 * One `[key]` accessor key → `{ node, keyIsProp }` (mirrors the legacy
 * `_applyReferenceAccessor` key typing). A Less lookup key names a member of the
 * BASE map by LITERAL name — it is NOT evaluated in the outer scope:
 *   • `@name` / `$name` / bare `name` → the literal member name `name` (an `Any`);
 *     resolved by NAME against the base's members (`keyIsProp`).
 *   • `@@name` → the member name is INTERPOLATED from outer variable `@name`: the
 *     key is a bare `VarRef` to `@name`, which the accessor evaluates in the outer
 *     scope to the member name to look up (a SINGLE indirection — `@name`'s value
 *     IS the member name; wrapping it in `VarIndirect` would over-resolve to
 *     `@@name`'s value).
 *   • an all-digit token → a 1-based numeric list index (not a name).
 */
export function accessorKey(keyStr: string): { key: t2.ValueNode | number; keyKind: 'var' | 'prop' | 'index' } {
  if (keyStr.charCodeAt(0) === 0x40 /* @ */) {
    // `@name` reads a VARIABLE member; `@@name` interpolates the member name from
    // outer variable `@name` (still a variable-namespace lookup).
    if (keyStr.charCodeAt(1) === 0x40) return { key: t2.varRef(keyStr.slice(2)), keyKind: 'var' };
    return { key: t2.any(keyStr.slice(1)), keyKind: 'var' };
  }
  if (keyStr.charCodeAt(0) === 0x24 /* $ */) {
    // `$name` reads a PROPERTY member; `$@name` — property key INTERPOLATED from
    // outer variable `@name`: look up the member whose PROPERTY name is `@name`'s
    // resolved value (`#ns[$@prop-name]`).
    if (keyStr.charCodeAt(1) === 0x40) return { key: t2.varRef(keyStr.slice(2)), keyKind: 'prop' };
    return { key: t2.any(keyStr.slice(1)), keyKind: 'prop' };
  }
  if (isIntLiteral(keyStr)) return { key: parseInt(keyStr, 10), keyKind: 'index' };
  // A bare key (`[foo]`) reads a PROPERTY member (Less: bare == `$`-headed).
  return { key: t2.any(keyStr), keyKind: 'prop' };
}

/**
 * A value-position reference → `VarRef` (`@name`), `PropRef` (`$prop` property
 * accessor), or a `MapAccessor` chain (`@map[key]` / `@list[1]` / `@m[@k]`). The
 * parser bounds the reference as a `Reference` node: a head leaf (`@name` / `$prop`)
 * glued to a chain of `[key]` / `(call)` accessors, each delivered as bracket-leaf
 * runs (`[`, optional key, `]`). This consumes those leaves (P0 — no re-tokenizing
 * of `ctx.src`) and builds the accessor value. A CALL accessor (`(…)`) in the chain
 * is a namespace / detached-call shape this family does not model — declined with
 * an inert placeholder so the declaration keeps its verbatim bytes (unchanged).
 */
const reference: BuildAction = {
  type: 'Reference',
  build: (args) => {
    const leaves: Leaf[] = args.children.filter(isLeaf);
    const head = leaves[0];
    if (!head) return placeholder(args.type);
    const sigil = head.value.charCodeAt(0);
    let base: t2.ValueNode;
    if (sigil === 0x40 /* @ */) {
      // `@@name` — indirect variable: read `@name`, then read the variable it NAMES.
      base = head.value.charCodeAt(1) === 0x40
        ? t2.varIndirect(t2.varRef(head.value.slice(2)))
        : t2.varRef(head.value.slice(1));
    } else if (sigil === 0x24 /* $ */) {
      base = t2.propRef(head.value.slice(1), head.value);
    } else return placeholder(args.type);

    const bytes = sliceSpan(args.ctx, args.span);
    return walkAccessorChain(base, leaves, 1, bytes) ?? placeholder(args.type);
  },
};

/**
 * Fold a `[key]` accessor chain onto `base` (a `MapAccessor` per key), starting at
 * leaf index `from`. Returns `null` when a non-`[` accessor (a `(call)`) appears —
 * that shape is out of this family's scope, so the caller keeps the verbatim bytes.
 */
function walkAccessorChain(
  base: t2.ValueNode | t2.MixinCall,
  leaves: readonly Leaf[],
  from: number,
  bytes: string,
): t2.ValueNode | null {
  let acc: t2.ValueNode | t2.MixinCall = base;
  let i = from;
  while (i < leaves.length) {
    if (leaves[i]!.value !== '[') return null;
    if (leaves[i + 1]?.value === ']') {
      // Empty `@x[]` → last element (index -1), per lookupOrCall's else-branch.
      acc = t2.mapAccessor(acc, -1, 'index', bytes);
      i += 2;
    } else {
      const { key, keyKind } = accessorKey(leaves[i + 1]!.value);
      acc = t2.mapAccessor(acc, key, keyKind, bytes);
      i += 3; // '[', key, ']'
    }
  }
  // A bare `MixinCall` base with no folded accessor is not a value node — decline
  // (the grammar always glues at least one `[key]`, so this is defensive).
  if (acc.type === 'MixinCall') return null;
  return acc;
}

/**
 * A namespace-value accessor `#ns.options[key]` / `.map[key]` /
 * `#library.add-one(1px)[@return]` (grammar `NsAccessor`): a mixin-call PATH head
 * (`#ns.options`, `.alias`, `#library.add-one` + optional `(args)`) glued to a
 * `[key]` accessor chain. The base is built as a {@link t2.MixinCall} — the same
 * node a statement mixin call produces — so `resolveBaseDeclMap` dispatches it and
 * reads its emitted members. Each key then folds into a `MapAccessor` exactly like
 * the `@map[key]` reference. A `(call)` inside the `[…]` chain (`#ns.m()[k](x)`) is
 * out of scope — declined so the bytes stay verbatim.
 */
const nsAccessor: BuildAction = {
  type: 'NsAccessor',
  build: (args) => {
    const bytes = sliceSpan(args.ctx, args.span);
    const segs: Array<{ comb: t2.Combinator; sel: string }> = [];
    let pendingComb: t2.Combinator = ' ';
    let slots: readonly ArgSlot[] = [];
    const chain: Leaf[] = [];
    let chainStarted = false;
    for (const c of args.children) {
      if (chainStarted) {
        if (isLeaf(c)) chain.push(c);
        continue;
      }
      if (isArgSlotList(c)) { slots = c; continue; }
      if (!isLeaf(c)) continue;
      const v = c.value;
      if (v === '') continue;
      if (v === '[') { chainStarted = true; chain.push(c); continue; }
      if (isCombinator(v)) { pendingComb = v; continue; }
      segs.push({ comb: pendingComb, sel: v });
      pendingComb = ' ';
    }
    if (segs.length === 0 || chain.length === 0) return placeholder(args.type);
    const name = segs[segs.length - 1]!.sel;
    const path: t2.PathSeg[] = segs.slice(0, -1).map((s) => ({ comb: s.comb, sel: s.sel }));
    const base: t2.MixinCall = {
      type: 'MixinCall', name, args: slots.map(slotToCallArg), path, important: false,
    };
    return walkAccessorChain(base, chain, 0, bytes) ?? placeholder(args.type);
  },
};

/**
 * `LessInterp` (`@{name}` / `@{map[key]}`) — the grammar STRUCTURES the
 * interpolation body into a `LessInterp` node whose children are the `@{` / `}`
 * delimiter leaves, the bare-name head leaf, and each `[` / key / `]` accessor leaf.
 * This builds the SAME structured value-reference the value-position `@map[key]`
 * path produces (`reference` above): a `VarRef` for the head, then a `MapAccessor`
 * folded per `[key]` accessor. Consuming the grammar's child leaves directly (P0 —
 * no re-scan of the `@{…}` body bytes) makes `@{map[key]}` RESOLVE through the same
 * `evalMapAccessor` seam value-position accessors use; `@{name}` (zero accessors) is
 * a plain `VarRef`, byte-identical to the former flat-leaf interpolation. The head
 * is a BARE name (the `@{` opener is the sigil), so unlike `reference` there is no
 * `@`/`$` head leaf to strip.
 */
const lessInterp: BuildAction = {
  type: 'LessInterp',
  build: (args) => {
    // children: `@{` leaf, head leaf, ( `[` leaf, key leaf, `]` leaf )*, `}` leaf.
    const leaves: Leaf[] = args.children.filter(isLeaf);
    const head = leaves[1];
    if (!head) return placeholder(args.type);
    let acc: t2.ValueNode = t2.varRef(head.value);
    const bytes = sliceSpan(args.ctx, args.span);
    // Fold `[key]` accessors, skipping the leading `@{`/head (0,1) and trailing `}`.
    for (let i = 2; i + 2 < leaves.length && leaves[i]!.value === '['; i += 3) {
      const { key, keyKind } = accessorKey(leaves[i + 1]!.value);
      acc = t2.mapAccessor(acc, key, keyKind, bytes);
    }
    return acc;
  },
};

export const VARIABLES_ACTIONS: readonly BuildAction[] = [varDeclaration, reference, varCall, nsAccessor, lessInterp];
