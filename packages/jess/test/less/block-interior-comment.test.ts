/*
 * A block comment BETWEEN or BEFORE declarations, i.e. at a statement boundary
 * inside a ruleset body.
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture, in the same
 * change that discovers it.
 *
 * Found while scoping the SCSS trivia-table fix (G27).
 *
 * IMPORTANT — the stage matters, and two earlier versions of this header got
 * it wrong by measuring through the compiler without isolating. The comment is
 * not lost by the parser, not lost by eval, and not lost for want of a
 * TriviaMap. It is lost because the block-comment trivia replay exists only on
 * the COLLAPSED-nesting emit path. One-flag bisect, same parsed document:
 *
 *   serialize(doc)                          -> comment KEPT, in place
 *   serialize(doc, {collapseNesting: true}) -> comment KEPT, in place
 *   serialize(doc, {collapseNesting: false})-> comment DROPPED
 *
 * The compiler passes `collapseNesting: … ?? false`, which is the Less v5
 * default, so every real render takes the emitter that has no replay.
 *
 * These tests therefore run through the COMPILER deliberately. A parser-level
 * test, or a serialize() call without the flag, passes today and watches
 * nothing. See G28.
 *
 * lessc 4.x keeps both forms below, so they are top-level oracle divergences.
 * dart-sass keeps them too, and jess-SCSS keeps them only because SCSS still
 * models a block comment as a statement NODE -- the model the owner ruled
 * against, and G27's blocker.
 *
 * PINNED DEFECT
 * -------------
 * Cases whose title starts with `PINNED DEFECT` assert the CURRENT, WRONG
 * behaviour. They are pins, not endorsements. When block-interior trivia
 * re-emission lands, these flip to the lessc 4.x answer and the marker drops.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const compiler = new Compiler({ compile: { plugins: [lessPlugin()] } });

const render = async (source: string) =>
  (await compiler.renderString(source, { language: 'less' })).replace(/\s+/g, ' ').trim();

describe('Less block comments at a statement boundary inside a block', () => {
  it.each([
    ['between two declarations', 'a { b: c; /* z */ d: e; }', 'a { b: c; /* z */ d: e; }'],
    ['before the first declaration', 'a { /* z */ b: c; }', 'a { /* z */ b: c; }']
  ])('PINNED DEFECT — drops a block comment %s', async (_label, source, _lessc) => {
    /*
     * lessc 4.x emits `_lessc` — the comment is retained in place. We drop it
     * entirely, so these are top-level byte divergences from the 4.x oracle
     * that no fixture was watching. SCSS keeps them (it has a Comment node) and
     * dart-sass keeps them, so we are alone in losing them.
     */
    const expected = source.replace(/\s*\/\* z \*\/\s*/, ' ').replace(/\{ /, '{ ');
    await expect(render(source)).resolves.toBe(expected.replace(/\s+/g, ' ').trim());
  });

  /* Root level DOES survive — the root trivia index covers it. */
  it('keeps a block comment at the root, before and after a ruleset', async () => {
    await expect(render('/* z */ a { b: c; }')).resolves.toBe('/* z */ a { b: c; }');
    await expect(render('a { b: c; } /* z */')).resolves.toBe('a { b: c; } /* z */');
  });

  /* Value position DOES survive — `triviaTextAtInsertIndex` covers it. Note
   * dart-sass drops this one, so the dialects legitimately differ here. */
  it('keeps a block comment inside a declaration value', async () => {
    await expect(render('a { b: c /* z */ d; }')).resolves.toBe('a { b: c /* z */ d; }');
  });
});
