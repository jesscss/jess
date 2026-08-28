/*
 * A block comment between two selector parts: adjacent, or a separator?
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture, in the same
 * change that discovers it.
 *
 * `.e` and `.f` with nothing between them are a COMPOUND selector — both
 * classes on one element. With a separator between them they are a DESCENDANT
 * pair. So `.e/*y*\/.f` asks the adjacency question with no whitespace
 * anywhere, and it is the cleanest case in the language for why adjacency, not
 * "is a separator present", is the right primitive.
 *
 * The engines disagree:
 *
 *   lessc 4.x      `.e.f`   — comments vanish at tokenisation, so ADJACENT
 *   jess (less)    `.e.f`   — matches the oracle
 *   jess (jess)    `.e .f`  — treats the comment as a separator
 *   dart-sass      `.e .f`  — treats the comment as a separator
 *   jess (scss)    parse error (pinned in the SCSS parser suite)
 *
 * css-syntax-3 §4 removes comments during tokenisation, which makes `.e.f` the
 * spec answer and dart-sass's `.e .f` a quirk we are not obliged to copy.
 * Whatever we settle on has to be a STATED policy on the selector production.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const compiler = new Compiler({ compile: { plugins: [lessPlugin()] } });

const render = async (source: string) =>
  (await compiler.renderString(source, { language: 'less' })).replace(/\s+/g, ' ').trim();

describe('Less selector adjacency across a block comment', () => {
  it('keeps two compound parts compound across a comment, matching lessc 4.x', async () => {
    await expect(render('.e/*y*/.f { g: h; }')).resolves.toBe('.e.f { g: h; }');
  });

  it('keeps a spaced comment a descendant separator', async () => {
    await expect(render('a /* x */ b { c: d; }')).resolves.toBe('a b { c: d; }');
    await expect(render('a/*x*/ b { c: d; }')).resolves.toBe('a b { c: d; }');
  });
});
