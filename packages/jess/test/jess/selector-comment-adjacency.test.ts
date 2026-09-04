/*
 * A block comment between two selector parts: adjacent, or a separator?
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture, in the same
 * change that discovers it.
 *
 * `.e` and `.f` with nothing between them are a COMPOUND selector — both
 * classes on ONE element. With a separator between them they are a DESCENDANT
 * pair — an `.f` inside an `.e`. Those select completely different things, so
 * `.e/*y*\/.f` is not a formatting question, it decides what the rule matches.
 * It also asks the adjacency question with no whitespace anywhere in the
 * source, which makes it the cleanest case in the language for why ADJACENCY,
 * and not "is a separator present", is the right primitive.
 *
 * RULED (DESIGN-DECISIONS G26, owner 2026-09-03): `.e.f` in every dialect. A
 * comment is trivia, and trivia does not split a compound selector —
 * css-syntax-3 §4 removes comments during tokenisation, so by the time selector
 * structure is decided there is nothing between `.e` and `.f` at all. lessc 4.x,
 * the CSS dialect and the Less dialect already agreed; jess now joins them, and
 * dart-sass's `.e .f` is a quirk we are not obliged to copy (reference
 * behaviour is not intent). The SCSS dialect's compound is fixed separately —
 * it folds into the SCSS block-comment trivia lane (G29) and is still pinned in
 * the SCSS parser suite.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

const render = async (source: string) =>
  (await new Compiler().renderString(source, {
    filePath: 'entry.jess',
    extension: '.jess'
  })).replace(/\s+/g, ' ').trim();

describe('Jess selector adjacency across a block comment', () => {
  it('keeps two compound parts compound across a comment', async () => {
    /*
     * `.e.f` — one element carrying both classes. A comment is trivia; trivia
     * must not promote a compound to a descendant (DESIGN-DECISIONS G26). This
     * now matches lessc 4.x, the CSS dialect and the Less dialect, all of which
     * give `.e.f` for the same bytes.
     */
    await expect(render('.e/*y*/.f { g: h; }')).resolves.toBe('.e.f { g: h; }');
  });

  it('keeps a spaced comment a descendant separator', async () => {
    /* Not in dispute: there is real whitespace here, so the descendant
     * combinator is authored, not manufactured by the comment. */
    await expect(render('a /* x */ b { c: d; }')).resolves.toBe('a b { c: d; }');
  });
});
