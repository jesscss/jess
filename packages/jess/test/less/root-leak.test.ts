/**
 * Minimal reproduction of :root selector context leak.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe.todo(':root selector context leak', () => {
  const compiler = new Compiler({
    compile: {
      plugins: [lessPlugin()]
    }
  });

  it('sibling rulesets after :root should NOT inherit :root context', async () => {
    const lessCode = `
:root {
  --color: red;
}
.btn {
  color: blue;
}
    `;

    const css = await compiler.renderString(lessCode, { language: 'less' });
    console.info('CSS output:', css);
    // .btn should NOT be :root .btn
    expect(css).toContain('.btn');
    expect(css).not.toContain(':root .btn');
  });

  it('mixin definition + call inside :root should NOT leak', async () => {
    const lessCode = `
:root {
  #my-mixin() {
    --x: 1;
  }
  #my-mixin();
}
.sibling {
  color: red;
}
    `;

    const css = await compiler.renderString(lessCode, { language: 'less' });
    console.info('CSS output:', css);
    expect(css).toContain('.sibling');
    expect(css).not.toContain(':root .sibling');
  });

  it('recursive mixin inside :root should NOT leak to siblings', async () => {
    const lessCode = `
:root {
  #loop(@i: 1) when (@i =< 3) {
    --var-@{i}: @i;
    #loop((@i + 1));
  }
  #loop();
}
.after {
  color: green;
}
    `;

    const css = await compiler.renderString(lessCode, { language: 'less' });
    console.info('CSS output:', css);
    expect(css).toContain('.after');
    expect(css).not.toContain(':root .after');
  });

  it('imports after :root import should NOT inherit :root context', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-root-leak-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '_root.less'), ':root {\n  --color: red;\n}\n');
      fs.writeFileSync(path.join(tmpDir, '_sibling.less'), '.sibling {\n  color: blue;\n}\n');
      fs.writeFileSync(path.join(tmpDir, 'main.less'), '@import "_root";\n@import "_sibling";\n');

      const css = await compiler.render(path.join(tmpDir, 'main.less'));
      console.info('Import test CSS:', css);
      expect(css).toContain('.sibling');
      expect(css).not.toContain(':root .sibling');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('imports after :root+mixin import should NOT inherit :root context', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-root-leak2-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '_root.less'), [
        ':root {',
        '  #loop(@i: 1) when (@i =< 3) {',
        '    --var-@{i}: @i;',
        '    #loop((@i + 1));',
        '  }',
        '  #loop();',
        '}'
      ].join('\n'));
      fs.writeFileSync(path.join(tmpDir, '_sibling.less'), '.after-mixin {\n  color: green;\n}\n');
      fs.writeFileSync(path.join(tmpDir, 'main.less'), '@import "_root";\n@import "_sibling";\n');

      const css = await compiler.render(path.join(tmpDir, 'main.less'));
      console.info('Import+mixin test CSS:', css);
      expect(css).toContain('.after-mixin');
      expect(css).not.toContain(':root .after-mixin');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
