import { describe, it, expect } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { serialize, Root } from '../../../index.js';
import { bridgeToAst } from '../../__tests__/bridge.js';
import { parseToAst } from '../../dispatch-host.js';
import { buildEvaluator } from '../../../evaluator.js';
import { makeBuiltinRegistry } from '../../__tests__/make-builtin-registry.js';

/**
 * F4 byte-identity: interpolated selectors carry a structured
 * `Interp` (not verbatim bytes), so the serializer RESOLVES the variable at
 * ruleset-enter — `.@{n}` with `@n: a` → `.a` — exactly as the parse→legacy-tree
 * →bridge path does. Each case defines the referenced variable so resolution
 * actually fires (an unresolved `@{n}` would emit verbatim on BOTH paths and hide
 * a divergence). Covers `.`/`#`/bare interp, mixed literal+interp, interp inside
 * a multi-simple compound, descendant/combinator context, `&`+interp, and lists.
 */
const g = lessGrammar as Record<string, unknown>;

function direct(src: string): Root {
  const { root } = parseToAst(src, g['Stylesheet'], undefined, { trivia: g['rw'] });
  if (!root) throw new Error('f4: no root produced');
  return root;
}
function viaBridge(src: string): Root {
  return bridgeToAst(parseLessFn(src).tree, src) as unknown as Root;
}
async function css(root: Root): Promise<string> {
  return (await serialize(root, { evaluator: buildEvaluator(makeBuiltinRegistry()), collapseNesting: true })).css;
}

// [head, source] — the source defines the referenced variable(s) so the interp resolves.
const cases: Array<[string, string]> = [
  ['.@{n}', '@n: a;\n.@{n} { x: 1 }\n'],
  ['#@{id}', '@id: main;\n#@{id} { x: 1 }\n'],
  ['@{parent}', '@parent: body;\n@{parent} { x: 1 }\n'],
  ['foo-@{x}-bar', '@x: mid;\nfoo-@{x}-bar { x: 1 }\n'],
  ['.foo-@{x}', '@x: mid;\n.foo-@{x} { x: 1 }\n'],
  ['#id-@{x}', '@x: 7;\n#id-@{x} { x: 1 }\n'],
  ['.icon-@{type}', '@type: 5_large;\n.icon-@{type} { background: red }\n'],
  ['.@{a}-@{b}', '@a: one; @b: two;\n.@{a}-@{b} { x: 1 }\n'],
  ['div@{n}', '@n: -x;\ndiv@{n} { x: 1 }\n'],
  ['.a.@{n}', '@n: on;\n.a.@{n} { x: 1 }\n'],
  ['.@{n}.b', '@n: on;\n.@{n}.b { x: 1 }\n'],
  ['.a-@{x}.b', '@x: m;\n.a-@{x}.b { x: 1 }\n'],
  ['.a .@{n}', '@n: on;\n.a .@{n} { x: 1 }\n'],
  ['.a > .@{n}', '@n: on;\n.a > .@{n} { x: 1 }\n'],
  ['.@{a} > .b', '@a: on;\n.@{a} > .b { x: 1 }\n'],
  ['.@{a}, .@{b}', '@a: on; @b: off;\n.@{a}, .@{b} { x: 1 }\n'],
  ['.@{a}, .b', '@a: on;\n.@{a}, .b { x: 1 }\n'],
  ['.a:hover.@{n}', '@n: on;\n.a:hover.@{n} { x: 1 }\n'],
];
const nesting: Array<[string, string]> = [
  ['& .@{n}', '@n: on;\n.a { & .@{n} { x: 1 } }\n'],
  ['&.@{mod}', '@mod: on;\n.a { &.@{mod} { x: 1 } }\n'],
  ['.@{n} &', '@n: on;\n.a { .@{n} & { x: 1 } }\n'],
  ['> .@{n}', '@n: on;\n.a { > .@{n} { x: 1 } }\n'],
];

describe('selector-interp host byte-identity vs bridge', () => {
  for (const [label, src] of [...cases, ...nesting]) {
    it(label, async () => {
      const d = await css(direct(src));
      const b = await css(viaBridge(src));
      if (d !== b) console.log(`\n--- ${label} ---\nDIRECT: ${JSON.stringify(d)}\nBRIDGE: ${JSON.stringify(b)}`);
      expect(d).toBe(b);
    });
  }
});
