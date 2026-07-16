/**
 * [tree2-native] Static declaration family: `name: value` where the value is
 * captured as opaque bytes.
 *
 * Value strategy (additive with the value family): consume a built tree2 value
 * node ONLY when it represents the WHOLE value — a single leaf `Word` whose
 * verbatim text equals the source value bytes (the value-leaf family, F5).
 * Otherwise the value bytes are re-derived verbatim from the declaration's source
 * span — identical to the bridge's `rawDeclValue` fallback and byte-faithful for
 * any static value. The whole-value guard is essential: a multi-part value where
 * only ONE part builds a leaf node (`1px solid red` → only `red` builds a
 * `NamedColor`) must NOT collapse to that fragment; it falls back to the full
 * source bytes. So this family works standalone (F0 seed) AND transparently
 * upgrades single-leaf values to typed leaves once F5 is registered.
 *
 * F6/F7 follow-up: when the operation / call families land, extend the guard to
 * also consume a whole-value `Operation`/`FunctionCall` node (which carries no
 * simple `.text` to compare) — e.g. by span coverage.
 */
import * as t2 from '../../tree2/index.js';
import { type BuildAction, declParts } from '../host-context.js';

const declaration: BuildAction = {
  type: 'Declaration',
  build: (args) => {
    const { name, value } = declParts(args.ctx.src, args.span.start, args.span.end);
    const built = args.children.filter((c): c is t2.ValueNode => c instanceof t2.Node);
    let valueNode: t2.ValueNode = t2.word(value);
    if (built.length === 1) {
      const only = built[0]!;
      // Whole-value guard: only a single leaf Word that spans the entire value.
      if (only.kind === t2.Kind.Word && only.text === value) valueNode = only;
    }
    return new t2.Declaration(name, valueNode);
  },
};

export const DECLARATION_STATIC_ACTIONS: readonly BuildAction[] = [declaration];
