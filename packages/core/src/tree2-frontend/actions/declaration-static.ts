/**
 * [tree2-native] Static declaration family: `name: value` where the value is
 * captured as opaque bytes.
 *
 * Value strategy (additive with the value family): if a SINGLE built tree2 value
 * node was produced for the value expression (i.e. the value family is
 * registered), that structured node is used; otherwise the value bytes are
 * re-derived verbatim from the declaration's source span — identical to the
 * bridge's `rawDeclValue` fallback and byte-faithful for any static value. So
 * this family works standalone (F0 seed) AND transparently upgrades to structured
 * values once the value family is registered, with no edit here.
 */
import * as t2 from '../../tree2/index.js';
import { type BuildAction, declParts } from '../host-context.js';

const declaration: BuildAction = {
  type: 'Declaration',
  build: (args) => {
    const { name, value } = declParts(args.ctx.src, args.span.start, args.span.end);
    // Prefer a structured value node when exactly one was built for the value
    // expression (the value family's leaf/call/operation actions). A non-collapsing
    // multi-part value (0 or >1 built nodes) falls back to verbatim source bytes.
    const built = args.children.filter((c): c is t2.ValueNode => c instanceof t2.Node);
    const valueNode = built.length === 1 ? built[0]! : t2.word(value);
    return new t2.Declaration(name, valueNode);
  },
};

export const DECLARATION_STATIC_ACTIONS: readonly BuildAction[] = [declaration];
