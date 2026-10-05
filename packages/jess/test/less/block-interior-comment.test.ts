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
   * The one remaining gap, and it is a SPAN gap rather than an emitter gap.
   * The replay anchors on `sourceStartOf(statement)`, and the Less grammar tags
   * a ruleset with `withSourceSpan` only when it is TERMINATED:
   *
   *   parse('a { b: c; /* z *\/ .n { d: e; } }')   .n sourceStart === -1 (NO_SPAN)
   *   parse('a { b: c; /* z *\/ .n { d: e; }; }')  .n sourceStart === 18
   *
   * and with the span present the comment lands correctly, as the case below
   * asserts. So this is the same prerequisite that blocks G29 on the SCSS side
   * (SCSS has 4 `withSourceSpan` call sites against Less's 41): statement
   * source spans must exist before a comment can be placed relative to the
   * statement. Handed to the spans lane.
   */
  it('PINNED DEFECT — moves a comment past an UNTERMINATED nested ruleset', async () => {
    await expect(render('a { b: c; /* z */ .n { d: e; } }', false))
      .resolves.toBe('a { b: c; .n { d: e; } /* z */ }');
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

  it('keeps the comments of a ruleset passed to a function', async () => {
    await bothEmitters('@d: { /* keep */ v: 1; }; a { x: foo(@d); }', 'a { x: foo({ /* keep */ v: 1; }); }');
    await bothEmitters('a { x: foo({ /* inline */ w: 2; .n { /* inner */ q: 1; } }); }', 'a { x: foo({ /* inline */ w: 2; .n { /* inner */ q: 1; } }); }');
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

  it('places the comment correctly when the nested ruleset IS terminated', async () => {
    await expect(render('a { b: c; /* z */ .n { d: e; }; }', false))
      .resolves.toBe('a { b: c; /* z */ .n { d: e; } }');
  });
});
