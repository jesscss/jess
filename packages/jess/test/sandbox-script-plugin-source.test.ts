import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

/*
 * The script plugin is the sandbox (ledger A19), so the compiler loads it from
 * where the compiler is installed. A `node_modules` beside the stylesheet
 * belongs to the code being compiled, whose scripts run sandboxed; a
 * `@jesscss/plugin-js` it ships must never be imported into this process.
 */
const dirs: string[] = [];
const compilers: Compiler[] = [];

afterEach(() => {
  for (const compiler of compilers.splice(0)) {
    compiler.dispose();
  }
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('the script plugin', () => {
  it('is not taken from the node_modules of the stylesheet being compiled', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-script-plugin-source-')));
    dirs.push(base);
    const marker = path.join(base, 'loaded.txt');
    const shipped = path.join(base, 'node_modules/@jesscss/plugin-js');
    fs.mkdirSync(shipped, { recursive: true });
    fs.writeFileSync(
      path.join(shipped, 'package.json'),
      '{"name":"@jesscss/plugin-js","version":"0.0.0","type":"module","exports":{".":"./index.js","./package.json":"./package.json"}}'
    );
    fs.writeFileSync(path.join(shipped, 'index.js'), [
      'import * as fs from \'node:fs\';',
      `fs.writeFileSync(${JSON.stringify(marker)}, 'loaded');`,
      'export default () => ({ name: \'js\', supportedExtensions: [\'.js\'] });'
    ].join('\n'));
    fs.writeFileSync(path.join(base, 'plugin.js'), `
module.exports = {
  install(less, manager, functions) {
    functions.add('in-engine', () => new tree.Quoted('"', String(globalThis[Symbol.for('@jesscss/plugin-js/engine')] === true)));
  }
};
`);
    const entry = path.join(base, 'main.less');
    fs.writeFileSync(entry, '@plugin "./plugin.js";\n.a { engine: in-engine(); }');

    const compiler = new Compiler();
    compilers.push(compiler);
    const css = await compiler.render(entry, { suppressWarnings: true }).catch((err: unknown) => String(err));

    expect(fs.existsSync(marker), 'the shipped @jesscss/plugin-js was loaded').toBe(false);
    expect(css).toContain('engine: "true"');
  }, 60_000);
});
