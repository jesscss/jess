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
 * Measured, four engines, three answers:
 *
 *   lessc 4.x       `.e.f`         oracle
 *   jess (css)      `.e.f`
 *   jess (less)     `.e.f`
 *   jess (jess)     `.e .f`        <- pinned below
 *   dart-sass       `.e .f`
 *   jess (scss)     parse error    <- pinned in the SCSS parser suite
 *
 * EXPECTED ANSWER, NOT YET RULED ON: `.e.f` in all four dialects. A comment is
 * trivia, and trivia does not split a compound selector — css-syntax-3 §4
 * removes comments during tokenisation, so by the time selector structure is
 * decided there is nothing between `.e` and `.f` at all. That makes `.e.f` the
 * spec answer, lessc 4.x already agrees, and dart-sass's `.e .f` is a quirk we
 * are not obliged to copy (reference behaviour is not intent).
 *
 * This is a SEMANTICS ruling and the owner has not made it, so this file pins
 * the current behaviour and states the expectation. It does not change it.
 *
 * PINNED DEFECT
 * -------------
 * Cases whose title starts with `PINNED DEFECT` assert the CURRENT, WRONG
 * behaviour. They are pins, not endorsements. When the ruling lands, flip the
 * assertion and drop the marker.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

const render = async (source: string) =>
  (await new Compiler().renderString(source, {
    filePath: 'entry.jess',
    extension: '.jess'
  })).replace(/\s+/g, ' ').trim();

describe('Jess selector adjacency across a block comment', () => {
  it('PINNED DEFECT — splits a compound selector on a comment', async () => {
    /*
     * Expected `.e.f` (one element carrying both classes). We emit `.e .f`,
     * which matches dart-sass and contradicts lessc 4.x, the CSS dialect and
     * the Less dialect — all three of which give `.e.f` for the same bytes.
     * A comment is trivia; trivia must not promote a compound to a descendant.
     */
    await expect(render('.e/*y*/.f { g: h; }')).resolves.toBe('.e .f { g: h; }');
  });

  it('keeps a spaced comment a descendant separator', async () => {
    /* Not in dispute: there is real whitespace here, so the descendant
     * combinator is authored, not manufactured by the comment. */
    await expect(render('a /* x */ b { c: d; }')).resolves.toBe('a b { c: d; }');
  });
});
