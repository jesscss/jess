/**
 * import-media-query.test.ts — a media/layer/supports postlude on a COMPILE-TIME
 * `@import` is a PARSE ERROR (§12.3b, owner ruling 2026-08-07).
 *
 * This file used to pin the shape of the `@media` wrapper such an import
 * produced: `@import "file" screen and (max-width: 600px)` loaded the file and
 * wrapped its rules in ONE `@media <full query>` block (the bug it guarded was a
 * wrapper decomposed per query term). That whole construct is gone. A postlude
 * describes a LINKED CSS resource, and a loaded document is spliced into this
 * one instead — so once the parser has decided an import is compile-time, the
 * postlude has nothing left to describe and is rejected outright.
 *
 * This DIVERGES deliberately from lessc 4.x, which accepts the source and emits
 * the `@media` wrapper. A postlude remains valid on a plain CSS `@import`, where
 * it stays in the at-rule prelude and is emitted verbatim.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const fixtures = path.join(__dirname, 'fixtures', 'import-media-query');

const mkCompiler = () =>
  new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin()] }
  });

describe('a media query on a compile-time @import is rejected', () => {
  it('reports a parse error instead of wrapping the loaded document in @media', async () => {
    const result = await mkCompiler().renderToResult(path.join(fixtures, 'main.less'));

    expect(result.css.trim()).toBe('');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/syntax-error',
      phase: 'parse',
      message: 'A compile-time @import cannot carry a media query.'
    });
  });

  /* A postlude on a plain CSS `@import` is still valid, and still emitted. */
  it('keeps a media query on a CSS @import in the at-rule prelude', async () => {
    const result = await mkCompiler().renderToResult(path.join(fixtures, 'css-postlude.less'));

    expect(result.errors).toHaveLength(0);
    expect(result.css.trim()).toBe('@import "linked.css" screen and (max-width: 600px);');
  });

  it('parses and renders an imported Less file whose media header has interpolated terms', async () => {
    const result = await mkCompiler().renderToResult(path.join(fixtures, 'interpolated-main.less'));
    expect(result.css.trim()).toBe(
      [
        '@media all and (tv) {',
        '  .all-and-tv-variables {',
        '    value: passed;',
        '  }',
        '}'
      ].join('\n')
    );
  });
});
