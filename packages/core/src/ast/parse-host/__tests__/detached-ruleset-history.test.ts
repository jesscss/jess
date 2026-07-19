import { describe, expect, it } from 'vitest';
import { lessGrammar } from '@jesscss/less-parser';
import { parseToAst } from '../dispatch-host.js';
import { serialize } from '../../serialize.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

const grammar = lessGrammar as Record<string, unknown>;
const evaluator = buildEvaluator(makeBuiltinRegistry());

function parseOnce(source: string) {
  const result = parseToAst(source, grammar['Stylesheet'], undefined, { trivia: grammar['rw'] });
  expect(result.errors).toEqual([]);
  expect(result.root).not.toBeNull();
  return result.root!;
}

async function render(root: ReturnType<typeof parseOnce>): Promise<string> {
  const result = await serialize(root, { evaluator, collapseNesting: true });
  return result.css;
}

function source(first: 'red' | 'blue', second: 'red' | 'blue'): string {
  return [
    '.m() {',
    '  @detached: { color: @tone; };',
    '  @detached();',
    '}',
    `.first { @tone: ${first}; .m(); }`,
    `.second { @tone: ${second}; .m(); }`,
  ].join('\n');
}

describe('detached-ruleset placement state', () => {
  it.each([
    ['red', 'blue'],
    ['blue', 'red'],
  ] as const)('captures each mixin placement independently (%s then %s)', async (first, second) => {
    const root = parseOnce(source(first, second));
    const expected = `.first {\n  color: ${first};\n}\n.second {\n  color: ${second};\n}\n`;

    // The same parsed tree is rendered twice: a capture stored on a source node
    // must neither make the second placement inherit the first's scope nor make
    // the second render depend on the first render.
    await expect(render(root)).resolves.toBe(expected);
    await expect(render(root)).resolves.toBe(expected);
  });
});
