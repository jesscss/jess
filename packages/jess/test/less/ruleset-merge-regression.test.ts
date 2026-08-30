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

  // `!important` on ANY member of a merge chain propagates to the whole combined
  // value (Less oracle), even though jess anchors the combined value at the LAST
  // occurrence. A first- or middle-member `!important` must NOT be dropped just
  // because the anchor (last member) carries none.
  it('propagates !important from a MIDDLE merge member to the whole value (comma)', async () => {
    const css = await compiler.renderString(
      `.r {\n  background+: a;\n  background+: b !important;\n  background+: c;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    expect(css).toContain('background: a, b, c !important;');
  });

  it('propagates !important from the FIRST merge member to the whole value (comma)', async () => {
    const css = await compiler.renderString(
      `.r {\n  background+: a !important;\n  background+: b;\n  background+: c;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    expect(css).toContain('background: a, b, c !important;');
  });

  it('propagates !important from a MIDDLE merge member to the whole value (space)', async () => {
    const css = await compiler.renderString(
      `.r {\n  transform+_: a;\n  transform+_: b !important;\n  transform+_: c;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    expect(css).toContain('transform: a b c !important;');
  });

  it('does not add !important to a merge chain when no member carries it', async () => {
    const css = await compiler.renderString(
      `.r {\n  background+: a;\n  background+: b;\n  background+: c;\n}`,
      { language: 'less', suppressWarnings: true }
    );
    expect(css).toContain('background: a, b, c;');
    expect(css).not.toContain('!important');
  });

  // A mixin called with `!important` must not leak that `!important` into a LATER
  // call of the same nested mixin (the makeImportant copy-on-recurse fix).
  it('does not leak !important from an important mixin call into a later plain call', async () => {
    const css = await compiler.renderString(
      `.m() {\n  .n() { margin: 5px; }\n  .n();\n}\n.a { .m() !important; }\n.b { .m(); }`,
      { language: 'less', suppressWarnings: true }
    );
    expect(css).toContain('.a {\n  margin: 5px !important;\n}');
    expect(css).toContain('.b {\n  margin: 5px;\n}');
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
