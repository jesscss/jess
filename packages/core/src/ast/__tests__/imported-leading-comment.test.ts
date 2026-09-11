import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';

/**
 * [comment-order] A leading block comment (e.g. a `/*!` license banner) that begins
 * an IMPORTED document must be spliced at the import site — including a TOP-LEVEL
 * import (`e.depth === 0`). The importing document's own leading-comment pass reads
 * the importer's trivia, never the loaded file's, so a banner on the first imported
 * file was previously left unemitted at the splice and swept to the OUTPUT TAIL.
 *
 * This is the bootstrap4 shape: a one-line entry that only `@import`s a framework
 * whose entry file opens with `/*! Bootstrap … *​/` and then more `@import`s.
 */
const evaluator = buildEvaluator(makeLessRegistry());

async function render(entrySrc: string, files: Record<string, string>): Promise<string> {
  const entry = parseLess(entrySrc);
  const importDocument = ({ specifier }: { specifier: string }) => {
    const src = files[specifier];
    return src === undefined ? undefined : { document: parseLess(src), key: specifier };
  };
  return (await serialize(entry, { evaluator, importDocument, collapseNesting: true })).css ?? '';
}

describe('leading comment of an imported document', () => {
  it('splices a top-level imported banner at the head, not the tail', async () => {
    const css = await render('@import "child";\n', {
      child: '/*! nested banner */\n@import "gchild";\n',
      gchild: '.a { color: red; }\n'
    });
    expect(css.startsWith('/*! nested banner */')).toBe(true);
    // Emitted exactly once (was previously duplicated/misplaced to the tail).
    expect(css.match(/nested banner/gu)?.length).toBe(1);
    expect(css).toBe('/*! nested banner */\n.a {\n  color: red;\n}\n');
  });
});
