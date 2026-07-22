/**
 * import-media-query.test.ts — an `@import "file" <media query>` must wrap the
 * imported rules in ONE `@media <full query>` block, not one nested `@media`
 * per query term.
 *
 * The parser captures the whole import feature-list (`screen and (max-width:
 * 600px)`) as a single `QueryCondition` (structurally a `Sequence` of the terms
 * `screen`, `and`, `(max-width: 600px)`). The import-postlude wrapper used to
 * decompose that Sequence and wrap each term in its own `@media`, emitting the
 * nonsense `@media screen { @media and { @media (max-width: 600px) { … } } }`.
 * Oracle is real less@4: a single `@media screen and (max-width: 600px)`.
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

describe('@import with a media query wraps in a single @media block', () => {
  it('emits one flat @media <full query>, not a nested @media per term', async () => {
    const result = await mkCompiler().renderToResult(path.join(fixtures, 'main.less'));
    expect(result.css.trim()).toBe(
      [
        '@media screen and (max-width: 600px) {',
        '  body {',
        '    width: 100%;',
        '  }',
        '}'
      ].join('\n')
    );
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
