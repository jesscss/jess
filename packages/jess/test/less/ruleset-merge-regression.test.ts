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
});
