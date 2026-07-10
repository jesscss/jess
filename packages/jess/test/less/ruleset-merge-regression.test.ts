import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const compiler = new Compiler({
  output: {
    collapseNesting: true
  },
  compile: {
    plugins: [lessPlugin(), lessCompatPlugin()]
  }
});

describe('Less ruleset mixin merge regressions', () => {
  it('evaluates chained ruleset mixins with property merge values', async () => {
    const css = await compiler.renderString(`
.shadow-base {
  box-shadow+: rgba(0,0,0,0.12);
}
.shadow-elevated {
  .shadow-base();
  box-shadow+: rgba(0,0,0,0.1);
}
.shadow-floating {
  .shadow-elevated();
  box-shadow+: rgba(0,0,0,0.15);
}
`, {
      language: 'less',
      math: 'parens-division',
      suppressWarnings: true
    });

    expect(css).toContain('.shadow-floating');
    expect(css).toContain(
      'box-shadow: rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.15);'
    );
    expect(css).not.toContain(
      'rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.12)'
    );
  });

  // A mixin contributes one merge item; the host contributes two more. ALL
  // contributions must combine, in source order (jess anchors at the LAST
  // occurrence, which for a single host body is the host position). Neither the
  // mixin's item nor a middle item may be dropped. This is the merge-across-mixin
  // value-loss regression (comma + space forms).
  it('combines ALL merge contributions across a mixin call (comma) — none dropped', async () => {
    const css = await compiler.renderString(
      `.m() { transform+: rotate(90deg); }\n.r {\n  .m();\n  transform+: skew(30deg);\n  transform+: scale(2, 4);\n}`,
      { language: 'less', math: 'parens-division', suppressWarnings: true }
    );
    expect(css).toContain('transform: rotate(90deg), skew(30deg), scale(2, 4);');
  });

  it('combines ALL merge contributions across a mixin call (space) — no drop, no duplicate', async () => {
    const css = await compiler.renderString(
      `.m() { transform+_: rotate(90deg); }\n.r {\n  .m();\n  transform+_: skew(30deg);\n  transform+_: scale(2, 4);\n}`,
      { language: 'less', math: 'parens-division', suppressWarnings: true }
    );
    expect(css).toContain('transform: rotate(90deg) skew(30deg) scale(2, 4);');
    // The eval-time merge Reference re-emits the immediately-prior sibling; the
    // coalesce must NOT duplicate it.
    expect(css).not.toContain('skew(30deg) skew(30deg)');
  });

  // A `$prop` read of a merged property must see the FULL coalesced value (the
  // anchor's combined chain), not the last merge sibling's own truncated value.
  it('a $ref to a merged property yields the full coalesced value (space)', async () => {
    const css = await compiler.renderString(
      `.r {\n  transform+_: a;\n  transform+_: b;\n  foo: $transform;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    expect(css).toContain('transform: a b;');
    expect(css).toContain('foo: a b;');
  });

  it('a $ref to a merged property yields the full coalesced value (comma)', async () => {
    const css = await compiler.renderString(
      `.r {\n  transform+: a;\n  transform+: b;\n  foo: $transform;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    expect(css).toContain('transform: a, b;');
    expect(css).toContain('foo: a, b;');
  });
});
