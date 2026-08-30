import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('public merge-alongside-mixin contract', () => {
  it('renders the important merge-alongside-mixin case through the public route', async () => {
    const [
      { Compiler },
      { default: lessPlugin },
      { lessCompatPlugin }
    ] = await Promise.all([
      import('../../src/index.js'),
      import('../../../syntax/less/jess-plugin-less/src/index.js'),
      import('../../../syntax/less/jess-plugin-less-compat/src/index.js')
    ]);
    const fixture = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      'fixtures/merge-fallback-important.less'
    );
    const expected = readFileSync(fixture.replace(/\.less$/, '.css'), 'utf8');
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
    });

    const result = await compiler.renderToResult(fixture, {});

    expect(result.css).toBe(expected);
  });
});
