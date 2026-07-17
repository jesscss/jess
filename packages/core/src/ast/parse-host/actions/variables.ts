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
import { type BuildAction, declParts, placeholder } from '../host-context.js';
import { isLeaf, wholeValueNode } from './interp.js';

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
    const node = wholeValueNode(args, value);
    const valueNode: t2.ValueNode = node !== null ? (node as t2.ValueNode) : t2.word(value);
    return t2.varDecl(bare, valueNode);
  },
};

/**
 * A value-position `@name` reference → `VarRef`. The parser bounds the reference as
 * a `Reference` node with a single bare-`@name` leaf child; consume it. A
 * non-variable `Reference` shape (a `$property` ref, or an accessor / call chain,
 * which carry extra `[…]` / `(…)` children) is declined with an inert placeholder,
 * so a family that models it can and a speculative branch is never broken.
 */
const reference: BuildAction = {
  type: 'Reference',
  build: (args) => {
    const only = args.children.length === 1 ? args.children[0] : undefined;
    if (isLeaf(only) && only.value.charCodeAt(0) === 0x40 /* @ */) {
      return t2.varRef(only.value.slice(1));
    }
    return placeholder(args.type);
  },
};

export const VARIABLES_ACTIONS: readonly BuildAction[] = [varDeclaration, reference];
