import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/*
 * A `@plugin` inside a ruleset body registers its functions for that body in
 * BOTH output modes. The nested emitter used to skip the body's plugin
 * preparation, so `local()` rendered verbatim under the Less default and
 * resolved only under collapseNesting.
 */
const PLUGIN = 'functions.add(\'local\', function () { return new tree.Anonymous(\'local\'); });';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function render(source: string, collapseNesting: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-scope-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'p.js'), PLUGIN, 'utf8');
  const entry = path.join(dir, 'main.less');
  fs.writeFileSync(entry, source, 'utf8');
  const compiler = new Compiler({
    output: { collapseNesting },
    compile: { plugins: [lessPlugin(), jsPlugin({ jsReadRoot: dir, runtimeApi: 'less' }), lessCompatPlugin()] }
  });
  return compiler.renderToResult(entry, { suppressWarnings: true });
}

const cases: [string, string][] = [
  ['top-level rule', '.a {\n  @plugin "./p";\n  x: local();\n}\n'],
  ['nested rule', '.a {\n  .b {\n    @plugin "./p";\n    x: local();\n  }\n}\n'],
  ['namespace mixin', '#ns {\n  @plugin "./p";\n  .m() {\n    x: local();\n  }\n}\n.a {\n  #ns > .m();\n}\n'],
  ['ruleset mixin through an & shell', '.m {\n  @plugin "./p";\n  x: local();\n}\n.a {\n  & {\n    .m();\n  }\n}\n'],
  ['each() body', '.a {\n  each(1 2, {\n    @plugin "./p";\n    x: local();\n  });\n}\n']
];

describe('a body-scoped @plugin resolves identically nested and collapsed', () => {
  for (const [name, source] of cases) {
    it(name, async () => {
      const nested = await render(source, false);
      const flat = await render(source, true);
      expect(nested.errors, `${name} nested`).toHaveLength(0);
      expect(flat.errors, `${name} collapsed`).toHaveLength(0);
      expect(nested.css, `${name} nested`).toMatch(/x: local;/);
      expect(flat.css, `${name} collapsed`).toMatch(/x: local;/);
    }, 30000);
  }
});
