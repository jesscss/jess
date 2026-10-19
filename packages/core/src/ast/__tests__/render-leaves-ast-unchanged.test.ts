import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { serialize } from '../serialize.js';
import type { Stylesheet } from '../nodes.js';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';

/*
 * Evaluation never writes the parsed document: a parsed sheet renders again with other
 * values (a language service or watcher reusing the AST, a sheet placed twice). The
 * extend pre-pass resolved interpolated selectors in place, so a second render kept
 * the first render's `.c-1`.
 */
describe('a render leaves the parsed document as parsed', () => {
  const evaluator = buildEvaluator(makeLessRegistry());

  it('resolves an interpolated selector again in a second render', async () => {
    const root = parseLess('@import "vars.less";\n.c-@{v} { m: 1; }\n.x:extend(.c-1 all) {}\n.y:extend(.c-2 all) {}\n');
    const render = async (v: string): Promise<string> => {
      const vars = parseLess(`@v: ${v};`);
      const importDocument = (): { document: Stylesheet; key: string } => ({ document: vars, key: `vars-${v}` });
      const out = await serialize(root, { evaluator, collapseNesting: true, importDocument });
      return out.css ?? '';
    };
    expect(await render('1')).toBe('.c-1,\n.x {\n  m: 1;\n}\n');
    expect(await render('2')).toBe('.c-2,\n.y {\n  m: 1;\n}\n');
  });

  it('extends a resolved interpolated selector from a mixin-placed extender', () => {
    for (const source of ['@v: 1; .c-@{v} { m: 1 } .mx() { .x:extend(.c-1 all) {} } .mx();', '@v: 1; .c-@{v} { m: 1 } .mx() { .x { &:extend(.c-1); } } .mx();']) {
      expect(serialize(parseLess(source), { evaluator, collapseNesting: true }).css, source).toBe('.c-1,\n.x {\n  m: 1;\n}\n');
    }

    // The resolved rule is the open rule a mixin-placed extender composes under.
    expect(serialize(parseLess('@v: 1; .t { m: 1 } .mx() { .x { &:extend(.t); } } .c-@{v} { .mx(); }'), { evaluator, collapseNesting: true }).css)
      .toBe('.t,\n.c-1 .x {\n  m: 1;\n}\n');
  });

  it('keeps an interpolated selector and an inline extend subject as parsed', () => {
    /* The serializer's lazy memos (`_hasInterp`, `_canon`, `_hasAmp`) are caches, not the document. */
    const parsed = (document: Stylesheet): string => JSON.stringify(document, (key, value: unknown) => (/^_(hasInterp|canon|hasAmp)$/u.test(key) ? undefined : value));
    const root = parseLess('@v: 1; .c-@{v} { m: 1; } @s: ~".q"; @{s}:extend(.c-1) {}');
    const before = parsed(root);
    expect(serialize(root, { evaluator, collapseNesting: true }).css).toBe('.c-1,\n.q {\n  m: 1;\n}\n');
    expect(parsed(root)).toBe(before);
  });
});
