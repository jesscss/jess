/*
 * Block comments at a statement boundary INSIDE a block.
 *
 * READ THIS BEFORE ADDING A CASE HERE — the shape of the test is the point.
 *
 * Every case must go through the COMPILER, and must assert BOTH values of
 * `collapseNesting`. That is not ceremony; it is the only shape that watches
 * anything. This defect survived because the obvious tests do not see it:
 *
 *   parse() + serialize()                     comment KEPT   (never broken)
 *   serialize(doc)                            comment KEPT   (flag defaults on)
 *   serialize(doc, {collapseNesting: true})   comment KEPT   (collapsed emitter)
 *   serialize(doc, {collapseNesting: false})  comment DROPPED  <- the bug
 *
 * `serialize.ts` carries two emitters. The collapsed one has always walked the
 * body span replaying block comments; the NESTED one never did. The compiler
 * passes `collapseNesting: … ?? false`, which is the Less v5 default, so every
 * real compile took the emitter with no replay — while three of the four ways
 * you would naturally test it took the emitter that works.
 *
 * So: a parser-level test passes today and watches nothing. A `serialize()`
 * call without the flag passes today and watches nothing. Only the compiler,
 * with the flag pinned both ways, watches this.
 *
 * The general rule this produced (docs/state/GRAMMAR-SIZE-FACTS.md): when a
 * defect is visible end to end, bisect by STAGE before attributing it to a
 * layer. Two wrong diagnoses were filed against this row — "the parser doesn't
 * capture it" and "eval drops the TriviaMap" — both from measuring through the
 * compiler without isolating. The bisect that settled it was one flag on one
 * already-parsed document.
 *
 * PINNED DEFECT
 * -------------
 * Cases whose title starts with `PINNED DEFECT` assert the CURRENT, WRONG
 * behaviour. They are pins, not endorsements. When the underlying defect is
 * fixed, the pin fails — flip the assertion and drop the marker.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jessPlugin from '@jesscss/plugin-jess';

const render = async (source: string, collapseNesting: boolean) =>
  (await new Compiler({
    output: { collapseNesting },
    compile: { plugins: [lessPlugin()] }
  }).renderString(source, { language: 'less' }))
    .replace(/\s+/g, ' ')
    .trim();

/** Assert the same output on BOTH emitters. Neither flag value may be skipped. */
const bothEmitters = async (source: string, expected: string) => {
  await expect(render(source, false)).resolves.toBe(expected);
  await expect(render(source, true)).resolves.toBe(expected);
};

describe('Less block comments at a statement boundary inside a block', () => {
  /*
   * The two cases that were live oracle divergences: lessc 4.x keeps both, we
   * dropped both. dart-sass keeps them too, and jess-SCSS kept them only
   * because SCSS is the one dialect still modelling a block comment as a
   * statement NODE — the model the owner ruled against, and G29's blocker.
   */
  it('keeps a block comment between two declarations', async () => {
    await bothEmitters('a { b: c; /* z */ d: e; }', 'a { b: c; /* z */ d: e; }');
  });

  it('keeps a block comment before the first declaration', async () => {
    await bothEmitters('a { /* z */ b: c; }', 'a { /* z */ b: c; }');
  });

  /*
   * After the LAST statement but still inside the block. The per-statement walk
   * only reaches comments that PRECEDE a statement, so this needs its own flush
   * against the body end.
   */
  it('keeps a block comment after the last declaration', async () => {
    await bothEmitters('a { b: c; /* z */ }', 'a { b: c; /* z */ }');
  });

  it('keeps several block comments interleaved with declarations', async () => {
    await bothEmitters(
      'a { b: c; /* p */ d: e; /* q */ f: g; }',
      'a { b: c; /* p */ d: e; /* q */ f: g; }'
    );
  });

  /* Unchanged by this fix, and asserted so it stays unchanged. */
  it('emits a body with no comments identically on both emitters', async () => {
    await bothEmitters('a { b: c; d: e; }', 'a { b: c; d: e; }');
  });

  /*
   * Root level and value position were never broken — the root trivia index and
   * `triviaTextAtInsertIndex` cover them. Pinned so a later change to the body
   * replay cannot regress the two paths that already worked.
   */
  it('keeps root-level block comments around a ruleset', async () => {
    await bothEmitters('/* z */ a { b: c; }', '/* z */ a { b: c; }');
    await bothEmitters('a { b: c; } /* z */', 'a { b: c; } /* z */');
  });

  it('keeps a block comment inside a declaration value', async () => {
    await bothEmitters('a { b: c /* z */ d; }', 'a { b: c /* z */ d; }');
  });

  /*
   * The Less grammar tags a ruleset with `withSourceSpan` only when it is
   * TERMINATED (`.n { d: e; }` has no statement span, `.n { d: e; };` does).
   * The body replay places a comment by the rule's selector start and steps
   * over its body span, so the comment lands in place either way.
   */
  it('keeps a comment before an UNTERMINATED nested ruleset in place', async () => {
    await expect(render('a { b: c; /* z */ .n { d: e; } }', false))
      .resolves.toBe('a { b: c; /* z */ .n { d: e; } }');
    await expect(render('a { b: c; /* z */ .n { d: e; } }', true))
      .resolves.toBe('a { b: c; /* z */ } a .n { d: e; }');
  });

  /*
   * jess#301: a detached ruleset's comments are trivia in its body span, so a
   * call writes them where the body lands, as a mixin call does.
   */
  it('keeps the comments of a called detached ruleset', async () => {
    await bothEmitters('@d: { /* keep */ v: 1; }; a { @d(); }', 'a { /* keep */ v: 1; }');
    await bothEmitters('@d: { v: 1; /* tail */ }; a { @d(); }', 'a { v: 1; /* tail */ }');
    await bothEmitters('a { @d: { /* keep */ v: 1; }; @d(); }', 'a { /* keep */ v: 1; }');
    await bothEmitters('a { @d(); @d: { /* keep */ v: 1; }; }', 'a { /* keep */ v: 1; }');
  });

  it('does not write a detached ruleset\'s comments where it is declared', async () => {
    await bothEmitters('a { b: 1; @d: { /* keep */ v: 1; }; c: 2; }', 'a { b: 1; c: 2; }');
    await bothEmitters('.m() { b: 1; @d: { /* keep */ v: 1; }; c: 2; @d(); } x { .m(); }', 'x { b: 1; c: 2; /* keep */ v: 1; }');
  });

  /*
   * Each expansion writes its own copy of the body, so it writes its own copy of
   * the body's comments: the definition HOLDS them, a call frees them for its
   * walk only, and a call made before the definition is reached writes them once.
   */
  it('keeps a callable body\'s comments on every call, not only the first', async () => {
    await bothEmitters('@d: { /* k */ v: 1; }; a { @d(); } b { @d(); }', 'a { /* k */ v: 1; } b { /* k */ v: 1; }');
    await bothEmitters('.m() { /* k */ v: 1; } a { .m(); } b { .m(); }', 'a { /* k */ v: 1; } b { /* k */ v: 1; }');
    await bothEmitters('.m() { v: 1; /* t */ } a { .m(); } b { .m(); }', 'a { v: 1; /* t */ } b { v: 1; /* t */ }');
    await bothEmitters('.r(@i) when (@i > 0) { /* c */ v: @i; .r(@i - 1); } a { .r(2); }', 'a { /* c */ v: 2; /* c */ v: 1; }');
    await bothEmitters('a { .m(); } .m() { /* c */ v: 1; }', 'a { /* c */ v: 1; }');
    await bothEmitters('.m { /* c */ v: 1; } a { .m(); }', '.m { /* c */ v: 1; } a { /* c */ v: 1; }');
  });

  it('does not write an uncalled mixin definition\'s comments where it is declared', async () => {
    await bothEmitters('a { b: 1; .m() { /* m */ w: 2; } c: 2; }', 'a { b: 1; c: 2; }');
  });

  it('keeps the comments of a ruleset passed to a function', async () => {
    await bothEmitters('@d: { /* keep */ v: 1; }; a { x: foo(@d); }', 'a { x: foo({ /* keep */ v: 1; }); }');
    await bothEmitters('@d: { /* k */ v: 1; }; a { x: foo(@d); y: foo(@d); }', 'a { x: foo({ /* k */ v: 1; }); y: foo({ /* k */ v: 1; }); }');
    await bothEmitters('a { x: foo({ /* inline */ w: 2; .n { /* inner */ q: 1; } }); }', 'a { x: foo({ /* inline */ w: 2; .n { /* inner */ q: 1; } }); }');
    await bothEmitters('a { x: foo({ @media print { /* m */ q: 1; } w: 2; }); }', 'a { x: foo({ @media print { /* m */ q: 1; } w: 2; }); }');
    await bothEmitters('.m() { /* mm */ z: 1; } a { x: foo({ .m(); /* after */ w: 2; }); }', 'a { x: foo({ /* mm */ z: 1; /* after */ w: 2; }); }');
  });

  it('keeps the comments of a detached ruleset declared in an imported file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jess-detached-comment-'));
    writeFileSync(join(dir, 'lib.less'), '@d: {\n  /* from lib */\n  v: 1;\n};\n');
    writeFileSync(join(dir, 'entry.less'), '@import "lib";\na { @d(); x: foo(@d); }\n');
    for (const collapseNesting of [false, true]) {
      const css = await new Compiler({ output: { collapseNesting }, compile: { plugins: [lessPlugin()] } })
        .render(join(dir, 'entry.less'));
      expect(css.replace(/\s+/g, ' ').trim()).toBe('a { /* from lib */ v: 1; x: foo({ /* from lib */ v: 1; }); }');
    }
  });

  it('keeps the comments of a called .jess detached ruleset (.less -> .jess equivalence)', async () => {
    for (const collapseNesting of [false, true]) {
      const css = await new Compiler({ output: { collapseNesting }, compile: { plugins: [jessPlugin()] } })
        .renderString('$d: @{ /* keep */ v: 1; };\na { $d(); }', { language: 'jess' });
      expect(css.replace(/\s+/g, ' ').trim()).toBe('a { /* keep */ v: 1; }');
    }
  });

  /*
   * A comment belongs to the body it is written in. A callable body's comments
   * are written once per expansion, where that expansion lands; a comment
   * inside a statement belongs to the statement's own writer; a comment between
   * statements of the caller stays where it was written.
   */
  it('writes a nested rule\'s comment in that rule, per expansion', async () => {
    const source = '.m() { .n { /* in */ q: 1; } } a { .m(); } b { .m(); }';
    await expect(render(source, true))
      .resolves.toBe('a .n { /* in */ q: 1; } b .n { /* in */ q: 1; }');
    await expect(render(source, false))
      .resolves.toBe('a { .n { /* in */ q: 1; } } b { .n { /* in */ q: 1; } }');
    await expect(render('a { b: 0; .n { /* in */ q: 1; } c: 2; }', true))
      .resolves.toBe('a { b: 0; } a .n { /* in */ q: 1; } a { c: 2; }');
  });

  it('writes a value\'s comment once in a callable body', async () => {
    await bothEmitters('.m() { w: 1 /* mid */ 2; } a { .m(); }', 'a { w: 1 /* mid */ 2; }');
  });

  it('keeps the comment of a declaration dropped as a duplicate', async () => {
    await expect(render('@d: { /* k */ v: 1; }; a { @d(); @d(); }', true))
      .resolves.toBe('a { /* k */ /* k */ v: 1; }');
    await expect(render('@d: { /* k */ v: 1; }; a { @d(); @d(); }', false))
      .resolves.toBe('a { /* k */ v: 1; /* k */ v: 1; }');
  });

  it('keeps a ruleset\'s comments at its own position when it is called before it is written', async () => {
    await bothEmitters('a { .m(); } .m { /* c */ v: 1; }', 'a { /* c */ v: 1; } .m { /* c */ v: 1; }');
    await bothEmitters('a { .m(); } .m { v: 1; /* t */ w: 2; }', 'a { v: 1; /* t */ w: 2; } .m { v: 1; /* t */ w: 2; }');
    await expect(render('a { .n(); .n { /* c */ x: 1; } }', true))
      .resolves.toBe('a { /* c */ x: 1; } a .n { /* c */ x: 1; }');
  });

  it('writes a root comment after a callable definition at the root', async () => {
    await bothEmitters('.m() { v: 1; } /* root */ a { .m(); }', '/* root */ a { v: 1; }');
    await bothEmitters('@d: { /* k */ v: 1; }; /* root */ a { @d(); }', '/* root */ a { /* k */ v: 1; }');
  });

  it('writes a call\'s trailing comment before the caller\'s comment after the call', async () => {
    await bothEmitters('.m() { v: 1; /* t */ } a { .m(); /* after */ }', 'a { v: 1; /* t */ /* after */ }');
    await bothEmitters('.m() { v: 1; /* t */ } a { .m(); /* after */ x: 1; }', 'a { v: 1; /* t */ /* after */ x: 1; }');
  });

  it('writes a comment before a call ahead of what the call expands to', async () => {
    await bothEmitters('.m() { v: 1; } a { b: 0; /* y */ .m(); }', 'a { b: 0; /* y */ v: 1; }');
    await bothEmitters('@d: { v: 1; }; a { b: 0; /* y */ @d(); }', 'a { b: 0; /* y */ v: 1; }');
  });

  /*
   * Every body's comments are replayed by its own walk, so a comment in a rule
   * that writes no declarations of its own still lands in that rule, and one in
   * a rule merged into its parent lands between the merged declarations.
   */
  it('keeps the comments of a rule merged into its parent (& { … })', async () => {
    await expect(render('a { w: 2; & { /* g */ q: 1; } & when (true) { q2: 1; /* h */ } r: 3; }', true))
      .resolves.toBe('a { w: 2; /* g */ q: 1; q2: 1; /* h */ r: 3; }');
    await expect(render('.m() { & { /* g */ q: 1; } } a { w: 2; .m(); }', true))
      .resolves.toBe('a { w: 2; /* g */ q: 1; }');
    await expect(render('a { w: 2; & when (true) { /* g */ q: 1; } }', false))
      .resolves.toBe('a { w: 2; & { /* g */ q: 1; } }');
  });

  it('keeps a comment in a rule whose only other content is nested rules', async () => {
    await expect(render('x { a { b { c: 1; } /* t */ } d: 1; }', true))
      .resolves.toBe('x a b { c: 1; } x a { /* t */ } x { d: 1; }');
    await expect(render('x { a { /* h */ b { c: 1; } } d: 1; }', true))
      .resolves.toBe('x a { /* h */ } x a b { c: 1; } x { d: 1; }');
    await expect(render('x { a { /* h */ b { c: 1; } } d: 1; }', false))
      .resolves.toBe('x { a { /* h */ b { c: 1; } } d: 1; }');
  });

  it('writes a ruleset argument\'s comment once per call of it', async () => {
    await bothEmitters('.m(@r) { @r(); } a { .m({ /* k */ v: 1; }); }', 'a { /* k */ v: 1; }');
    await expect(render('.m(@r) { x { @r(); } } a { .m({ /* k */ v: 1; }); }', true))
      .resolves.toBe('a x { /* k */ v: 1; }');
    await expect(render('.m(@r) { x { @r(); } } a { .m({ /* k */ v: 1; }); }', false))
      .resolves.toBe('a { x { /* k */ v: 1; } }');
    await expect(render('.m(@r) { @r(); @r(); } a { .m({ /* k */ v: 1; }); }', false))
      .resolves.toBe('a { /* k */ v: 1; /* k */ v: 1; }');
  });

  it('writes a comment in a call\'s value argument only in the value', async () => {
    await bothEmitters('.m(@a) { x: @a; } a { .m(1px /* c */ 2px); b: 3; }', 'a { x: 1px /* c */ 2px; b: 3; }');
  });

  it('writes nothing for a namespace that holds only a mixin with a comment', async () => {
    await bothEmitters('#ns { .m() { /* c */ v: 1; } }', '');
    await bothEmitters('#ns { .m() { /* c */ v: 1; } } a { #ns > .m(); }', 'a { /* c */ v: 1; }');
  });

  it('writes a bubbled at-rule\'s comment inside the at-rule', async () => {
    await expect(render('a { b: 0; @media print { /* pm */ q: 1; } }', true))
      .resolves.toBe('a { b: 0; } @media print { a { /* pm */ q: 1; } }');
    await expect(render('a { b: 0; @media print { /* pm */ q: 1; } }', false))
      .resolves.toBe('a { b: 0; @media print { /* pm */ q: 1; } }');
  });

  /*
   * A custom property is unspanned (css-parser `Declaration`): the comments in
   * its value are the value's own, written by both writers alike.
   */
  it('writes a custom property\'s value comments once, in the value', async () => {
    await bothEmitters('a { --y: a /* d */ b; z: 1; }', 'a { --y: a /* d */ b; z: 1; }');
  });

  it('reads a nested rule\'s comments from the file the rule is written in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jess-imported-mixin-comment-'));
    writeFileSync(join(dir, 'lib.less'), '/* padding padding padding */\n.m() { v: 1;\n  .n { /* lib-n */ q: 1; } }\n');
    writeFileSync(join(dir, 'entry.less'), '@import "lib";\na { /* main-a */ b: 0; .m(); /* main-tail */ }\nb { c: 1; /*x*/ d: 2; }\n');
    for (const [collapseNesting, expected] of [
      [true, '/* padding padding padding */ a { /* main-a */ b: 0; v: 1; /* main-tail */ } a .n { /* lib-n */ q: 1; } b { c: 1; /*x*/ d: 2; }'],
      [false, '/* padding padding padding */ a { /* main-a */ b: 0; v: 1; .n { /* lib-n */ q: 1; } /* main-tail */ } b { c: 1; /*x*/ d: 2; }']
    ] as const) {
      const css = await new Compiler({ output: { collapseNesting }, compile: { plugins: [lessPlugin()] } })
        .render(join(dir, 'entry.less'));
      expect(css.replace(/\s+/g, ' ').trim()).toBe(expected);
    }
  });

  it('drops a block that holds only comments the compressed output drops', async () => {
    const min = (source: string) => new Compiler({ output: { compress: true, collapseNesting: true }, compile: { plugins: [lessPlugin()] } })
      .renderString(source, { language: 'less' });
    await expect(min('x { a { b { c: 1; } /* t */ } }')).resolves.toBe('x a b{c:1}');
    await expect(min('.r { @media (hover) { /* c */ } } .s { d: 1 }')).resolves.toBe('.s{d:1}');
  });

  it('writes an each() callback\'s comments once per iteration', async () => {
    await bothEmitters(
      '@l: 1 2; a { b: 0; each(@l, .(@v) { /* c */ v: @v; /* t */ }); /* after */ }',
      'a { b: 0; /* c */ v: 1; /* t */ /* c */ v: 2; /* t */ /* after */ }'
    );
    await bothEmitters('@l: 1 2; a { each(@l, { /* c */ v: @value; }); }', 'a { /* c */ v: 1; /* c */ v: 2; }');
  });

  it('places the comment correctly when the nested ruleset IS terminated', async () => {
    await expect(render('a { b: c; /* z */ .n { d: e; }; }', false))
      .resolves.toBe('a { b: c; /* z */ .n { d: e; } }');
  });
});
