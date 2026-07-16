/**
 * [tree2-native] Static declaration family: `name: value` where the value is
 * captured as opaque bytes.
 *
 * Value strategy (additive with the value family): consume a built tree2 value
 * node ONLY when it represents the WHOLE value — the shared `wholeValueNode` guard
 * (a single built child whose SPAN covers the entire value; an F5 value leaf `red`
 * or an F1 ref `@c`). Otherwise the value bytes are re-derived verbatim from the
 * declaration's source span — identical to the bridge's `rawDeclValue` fallback and
 * byte-faithful for any static value. The span-coverage guard is essential: a
 * multi-part value where only ONE part builds a node (`1px solid red` → only `red`
 * builds a `NamedColor`) must NOT collapse to that fragment; it falls back to the
 * full source bytes. So this family works standalone (F0 seed) AND transparently
 * upgrades single-node whole values to typed nodes once the value families register.
 */
import * as t2 from '../../tree2/index.js';
import { type BuildAction, declParts } from '../host-context.js';
import { wholeValueNode } from './interp.js';

const declaration: BuildAction = {
  type: 'Declaration',
  build: (args) => {
    const { name, value } = declParts(args.ctx.src, args.span.start, args.span.end);
    // Whole-value guard (STRUCTURAL, P0): consume the single built value node only
    // when its span covers the ENTIRE value (an F5 leaf `red` / F1 ref `@c`). A
    // fragment (`1px solid @c` → only `@c` builds) has no whole-value node, so the
    // value stays verbatim source bytes — no reconstructed-string round-trip.
    const node = wholeValueNode(args, value);
    const valueNode: t2.ValueNode = node !== null ? (node as t2.ValueNode) : t2.word(value);
    return new t2.Declaration(name, valueNode);
  },
};

export const DECLARATION_STATIC_ACTIONS: readonly BuildAction[] = [declaration];
