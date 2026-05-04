import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin()
    ]
  }
});

async function render(less: string): Promise<string> {
  return compiler.renderString(less, { extension: '.less' });
}

function t(s: string): string {
  return s.trim().split('\n').map(l => l.trimEnd()).join('\n');
}

describe.todo('Debug bubbling', () => {
  it.only('bug6: & ref through multiple nested at-rules', async () => {
    const css = await render(`
@supports (property: value) {
  .outOfMedia & {
    @media (max-size: 2px) {
      @supports (whatever: something) {
        property: value;
      }
    }
  }
}
    `);
    console.log('Bug6 output:', JSON.stringify(css));
    expect(t(css)).toBe(t(`
@supports (property: value) {
  @media (max-size: 2px) {
    @supports (whatever: something) {
      .outOfMedia {
        property: value;
      }
    }
  }
}
    `));
  });
});
