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
import { type BuildAction, declParts, isStatement, placeholder, sliceSpan } from '../host-context.js';
import { type Leaf, isLeaf, wholeValueNode } from './interp.js';
import { tryMixinCallIterable } from './control-flow.js';

/**
 * `@x: value;` — split the span into name + value bytes (drop a trailing `;`, split
 * on the first `:`), strip the name's leading `@` (the bridge / scope key is the
 * bare identifier). The value is the single whole-value built node when the parser
 * produced one (`@a` → `VarRef`, `red` → value leaf), else the verbatim value bytes
 * (a computed / multi-part / interpolated value is the value-assembly family's
 * shape, not F1's — and a `VarDeclaration` emits nothing, so it is unobservable
 * until referenced).
 */
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
    const node = wholeValueNode(args, value);
    const valueNode: t2.ValueNode = node !== null ? (node as t2.ValueNode) : t2.any(value);
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
function accessorKey(keyStr: string): { key: t2.ValueNode | number; keyIsProp: boolean } {
  if (keyStr.charCodeAt(0) === 0x40 /* @ */) {
    if (keyStr.charCodeAt(1) === 0x40) return { key: t2.varRef(keyStr.slice(2)), keyIsProp: true };
    return { key: t2.any(keyStr.slice(1)), keyIsProp: true };
  }
  if (keyStr.charCodeAt(0) === 0x24 /* $ */) {
    // `$@name` — property key INTERPOLATED from outer variable `@name`: look up the
    // member whose PROPERTY name is `@name`'s resolved value (`#ns[$@prop-name]`).
    if (keyStr.charCodeAt(1) === 0x40) return { key: t2.varRef(keyStr.slice(2)), keyIsProp: true };
    return { key: t2.any(keyStr.slice(1)), keyIsProp: true };
  }
  if (isIntLiteral(keyStr)) return { key: parseInt(keyStr, 10), keyIsProp: false };
  return { key: t2.any(keyStr), keyIsProp: true };
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
  base: t2.ValueNode,
  leaves: readonly Leaf[],
  from: number,
  bytes: string,
): t2.ValueNode | null {
  let acc = base;
  let i = from;
  while (i < leaves.length) {
    if (leaves[i]!.value !== '[') return null;
    if (leaves[i + 1]?.value === ']') {
      // Empty `@x[]` → last element (index -1), per lookupOrCall's else-branch.
      acc = t2.mapAccessor(acc, -1, false, bytes);
      i += 2;
    } else {
      const { key, keyIsProp } = accessorKey(leaves[i + 1]!.value);
      acc = t2.mapAccessor(acc, key, keyIsProp, bytes);
      i += 3; // '[', key, ']'
    }
  }
  return acc;
}

/**
 * A namespace-value accessor `#ns[key]` / `.map[key]` (grammar `NsAccessor`): a
 * SELECTOR head (`#ns` / `.map`, not a `@var`) glued to a `[key]` accessor chain.
 * The base is the literal selector fragment (an `Any` the serializer resolves to the
 * union of matching rulesets' declarations); each key folds into a `MapAccessor`
 * exactly like the `@map[key]` reference. A `(call)`-bearing form (`#ns.m()[k]`) is
 * out of scope — declined so the bytes stay verbatim.
 */
const nsAccessor: BuildAction = {
  type: 'NsAccessor',
  build: (args) => {
    const leaves: Leaf[] = args.children.filter(isLeaf);
    const head = leaves[0];
    if (!head) return placeholder(args.type);
    const bytes = sliceSpan(args.ctx, args.span);
    return walkAccessorChain(t2.any(head.value), leaves, 1, bytes) ?? placeholder(args.type);
  },
};

export const VARIABLES_ACTIONS: readonly BuildAction[] = [varDeclaration, reference, varCall, nsAccessor];
