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
 * IMPORTANT — the stage matters, and an earlier version of this header got it
 * wrong. The comment is NOT lost by the parser and NOT lost by the serializer.
 * `parse()` + `serialize()` on this exact input reproduces it in position:
 *
 *   parse+serialize  'a { b: c; /* z *\/ d: e; }'  ->  comment kept, in place
 *   full compiler    same input                    ->  comment DROPPED
 *
 * So the loss is in EVALUATION. The parser tags a `TriviaMap` on the root, and
 * `withDocumentTrivia` (core `serialize.ts`) reads it back with
 * `triviaMapOf(document)` — but eval returns a NEW `Stylesheet` without the
 * tag, so serialization runs with no trivia at all. The documented fallback
 * `context.opts.trivia` is dead too: nothing in the repo assigns it. See G28.
 *
 * These tests therefore run through the COMPILER deliberately. A parser-level
 * test would pass today and watch nothing.
 *
 * lessc 4.x keeps both forms below, so they are top-level oracle divergences.
 * dart-sass keeps them as well, and jess-SCSS keeps them only because SCSS is
 * the one dialect that still models a block comment as a statement NODE — the
 * model the owner ruled against, and G27's blocker.
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
