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
    const node = wholeValueNode(args, value);
    const valueNode: t2.ValueNode = node !== null ? (node as t2.ValueNode) : t2.word(value);
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
 *   • `@name` / `$name` / bare `name` → the literal member name `name` (a `Word`);
 *     resolved by NAME against the base's members (`keyIsProp`).
 *   • `@@name` → the name is INTERPOLATED from outer variable `@name` (`VarIndirect`
 *     resolves in the outer scope to the member name to look up).
 *   • an all-digit token → a 1-based numeric list index (not a name).
 */
function accessorKey(keyStr: string): { key: t2.ValueNode | number; keyIsProp: boolean } {
  if (keyStr.charCodeAt(0) === 0x40 /* @ */) {
    if (keyStr.charCodeAt(1) === 0x40) return { key: t2.varIndirect(t2.varRef(keyStr.slice(2))), keyIsProp: true };
    return { key: t2.word(keyStr.slice(1)), keyIsProp: true };
  }
  if (keyStr.charCodeAt(0) === 0x24 /* $ */) return { key: t2.word(keyStr.slice(1)), keyIsProp: true };
  if (isIntLiteral(keyStr)) return { key: parseInt(keyStr, 10), keyIsProp: false };
  return { key: t2.word(keyStr), keyIsProp: true };
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
    if (sigil === 0x40 /* @ */) base = t2.varRef(head.value.slice(1));
    else if (sigil === 0x24 /* $ */) base = t2.propRef(head.value.slice(1), head.value);
    else return placeholder(args.type);

    const bytes = sliceSpan(args.ctx, args.span);
    // Walk the `[key]` accessor chain. A `(call)` accessor is out of this family's
    // scope — decline the whole reference so its bytes stay verbatim (prior behavior).
    let i = 1;
    while (i < leaves.length) {
      const tok = leaves[i]!.value;
      if (tok !== '[') return placeholder(args.type);
      if (leaves[i + 1]?.value === ']') {
        // Empty `@x[]` → last element (index -1), per lookupOrCall's else-branch.
        base = t2.mapAccessor(base, -1, false, bytes);
        i += 2;
      } else {
        const { key, keyIsProp } = accessorKey(leaves[i + 1]!.value);
        base = t2.mapAccessor(base, key, keyIsProp, bytes);
        i += 3; // '[', key, ']'
      }
    }
    return base;
  },
};

export const VARIABLES_ACTIONS: readonly BuildAction[] = [varDeclaration, reference, varCall];
