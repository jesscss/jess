/*
 * A block comment BETWEEN or BEFORE declarations, i.e. at a statement boundary
 * inside a ruleset body.
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture, in the same
 * change that discovers it.
 *
 * Found while scoping the SCSS trivia-table fix (G27), and it is the reason
 * that fix cannot be done yet. The four dialects split on WHERE a block comment
 * survives, and the split follows the representation, not any decision:
 *
 *                                   lessc 4.x  jess-less  dart-sass  jess-scss
 *   a { b: c; /* z *\/ d: e }          kept      DROPPED     kept       kept
 *   a { /* z *\/ b: c }                kept      DROPPED     kept       kept
 *   a { b: c /* z *\/ d }  (in value)  kept      kept        dropped    kept
 *
 * Less and CSS have NO `Comment` node at all — every comment rides the trivia
 * channel. SCSS is the only dialect that makes a comment a statement-level
 * NODE, which is exactly why it is the only one that keeps the first two rows.
 *
 * So the trivia channel as currently wired carries root-level comments (via the
 * root trivia index) and value-level comments (via `triviaTextAtInsertIndex`),
 * but NOTHING re-emits trivia that lands at a statement boundary INSIDE a block.
 * That gap is invisible in Less until you look, because no test covered it.
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
